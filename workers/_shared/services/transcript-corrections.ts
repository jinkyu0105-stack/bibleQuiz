import type { CorrectionItem, CorrectionProposal } from "./transcript-correction-contract";
import type { DeepReadonly, TranscriptContent, TranscriptState } from "./transcript-revision-contract";

type State = DeepReadonly<TranscriptState>;
type Proposal = DeepReadonly<CorrectionProposal>;
type Reject = () => never;
function validFragment(text: string) {
  // eslint-disable-next-line no-control-regex -- Same lossless text boundary as working revisions; empty fragments allow insert/delete.
  return !/[\uD800-\uDFFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text);
}
function target(content: State["revisions"][number]["content"], item: DeepReadonly<CorrectionItem>, reject: Reject) {
  if (content.format === "plain_text") {
    if (item.segmentId !== null || item.start !== null || item.duration !== null) reject();
    return content.text;
  }
  const segment = content.segments.find((s) => s.segmentId === item.segmentId);
  if (!segment || segment.start !== item.start || segment.duration !== item.duration) return reject();
  return segment.text;
}

export function verifyCorrectionProposal(state: State, proposal: Proposal, reject: Reject) {
  const source = state.sources.find((s) => s.id === proposal.sourceId);
  const base = state.revisions.find((r) => r.id === proposal.baseRevisionId);
  if (!source || !base || base.sourceId !== source.id || base.transcriptSha256 !== proposal.baseTranscriptSha256) return reject();
  const checksum = source.payload.sourceMode === "public_unofficial"
    ? source.payload.sourceSha256 : source.payload.rawTranscriptSha256;
  if (checksum !== proposal.sourceSha256) reject();
  verifyCorrectionItems(base.content, proposal.items, reject);
}

/** Validate the selected base only; also supports an unedited original document. */
export function verifyCorrectionItems(content: DeepReadonly<TranscriptContent>, items: Proposal["items"], reject: Reject) {
  const ids = new Set<string>();
  const ranges = new Map<string | null, DeepReadonly<CorrectionItem>[]>();
  for (const item of items) {
    if (ids.has(item.id)) reject();
    ids.add(item.id);
    const text = target(content, item, reject);
    if (item.from > item.to || item.to > text.length || item.originalText !== text.slice(item.from, item.to) ||
      item.originalText === item.proposedText || !validFragment(item.originalText) || !validFragment(item.proposedText) ||
      !validFragment(text.slice(0, item.from)) || !validFragment(text.slice(item.to)) ||
      item.contextBefore !== text.slice(Math.max(0, item.from - 120), item.from) ||
      item.contextAfter !== text.slice(item.to, item.to + 120) ||
      new Set(item.riskFlags).size !== item.riskFlags.length ||
      (item.proposedText.length < item.originalText.length && !item.riskFlags.includes("deletion"))) reject();
    const group = ranges.get(item.segmentId) ?? [];
    group.push(item);
    ranges.set(item.segmentId, group);
  }
  // Reject overlapping or ambiguous same-position edits, even before decisions.
  for (const group of ranges.values()) {
    group.sort((a, b) => a.from - b.from);
    for (let i = 1; i < group.length; i++) {
      if (group[i]!.from < group[i - 1]!.to || group[i]!.from === group[i - 1]!.from) reject();
    }
  }
}

/** Absence of an immutable human decision means pending. Private view only. */
export function correctionItemDecisions(state: State, proposal: Proposal) {
  const decisions = new Map<string, "accepted" | "rejected">();
  for (const record of state.correctionDecisions) {
    if (record.proposalId === proposal.id) {
      for (const item of record.decisions) decisions.set(item.itemId, item.decision);
    }
  }
  return proposal.items.map((item) => ({ itemId: item.id, decision: decisions.get(item.id) ?? "pending" as const }));
}

export function mergeCorrectionContent(state: State, proposal: Proposal, reject: Reject): TranscriptContent {
  const base = state.revisions.find((r) => r.id === proposal.baseRevisionId);
  if (!base) return reject();
  const accepted = new Set(correctionItemDecisions(state, proposal).filter((d) => d.decision === "accepted").map((d) => d.itemId));
  return mergeAcceptedCorrections(base.content, proposal.items, accepted, reject);
}

export function mergeAcceptedCorrections(base: DeepReadonly<TranscriptContent>, items: Proposal["items"], accepted: ReadonlySet<string>, reject: Reject): TranscriptContent {
  if (accepted.size === 0) reject();
  const content = structuredClone(base) as TranscriptContent;
  const replace = (text: string, segmentId: string | null) => {
    // Descending base offsets prevent length-changing edits from shifting later targets.
    const selected = items.filter((i) => i.segmentId === segmentId && accepted.has(i.id)).sort((a, b) => b.from - a.from);
    for (const item of selected) text = text.slice(0, item.from) + item.proposedText + text.slice(item.to);
    return text;
  };
  if (content.format === "plain_text") content.text = replace(content.text, null);
  else for (const segment of content.segments) segment.text = replace(segment.text, segment.segmentId);
  return content;
}

export function verifyCorrectionHistory(state: State, reject: Reject) {
  const eventVersions = new Set<number>();
  for (const proposal of state.correctionProposals) {
    if (proposal.registeredVersion <= 1 || proposal.registeredVersion > state.version || eventVersions.has(proposal.registeredVersion)) reject();
    eventVersions.add(proposal.registeredVersion);
    verifyCorrectionProposal(state, proposal, reject);
  }
  const decided = new Map<string, Set<string>>();
  for (const record of state.correctionDecisions) {
    const proposal = state.correctionProposals.find((p) => p.id === record.proposalId);
    if (!proposal || record.version <= proposal.registeredVersion || record.version > state.version || eventVersions.has(record.version)) return reject();
    eventVersions.add(record.version);
    const seen = decided.get(proposal.id) ?? new Set<string>();
    for (const decision of record.decisions) {
      if (seen.has(decision.itemId) || !proposal.items.some((i) => i.id === decision.itemId)) reject();
      seen.add(decision.itemId);
    }
    decided.set(proposal.id, seen);
  }
  const merged = new Set<string>();
  for (const revision of state.revisions) {
    const link = revision.mergedCorrection;
    if (revision.kind !== "merged") {
      if (link !== null) reject();
      continue;
    }
    if (!link) return reject();
    const proposal = state.correctionProposals.find((p) => p.id === link.proposalId);
    if (!proposal || merged.has(proposal.id) || revision.parentRevisionId !== proposal.baseRevisionId ||
      revision.sourceId !== proposal.sourceId || link.decisionVersion <= proposal.registeredVersion ||
      link.decisionVersion >= state.version || state.correctionDecisions.some((d) => d.proposalId === proposal.id && d.version > link.decisionVersion)) return reject();
    if (JSON.stringify(revision.content) !== JSON.stringify(mergeCorrectionContent(state, proposal, reject))) reject();
    merged.add(proposal.id);
  }
}
