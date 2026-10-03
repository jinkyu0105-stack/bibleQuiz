import { describe, expect, it } from "vitest";
import { resolveGeneratedClaimReferences } from "../_shared/services/generated-claim-references";
import { intentFields, type IntentAnalysis } from "../_shared/services/sermon-intent-contract";
import { openAiDraftBody } from "../_shared/services/openai-draft-transport";

function intent(): IntentAnalysis {
  return { ...Object.fromEntries(intentFields.map(f => [f, []])), warnings: [
    { id: "warning-1", text: "합성 주장", origin: "transcript", evidence: [] },
    { id: "warning-2", text: "합성 관리자 메모", origin: "admin_context", evidence: [] },
  ] } as IntentAnalysis;
}
describe("generated claim references", () => {
  it("repairs only the observed spelling with a transcript claim; keeps prose and quotes intact", () => {
    const input = intent(), draft = { paragraphs: [{ text: "warnings-1 원문 유지", evidence: [{ quote: "인용 유지" }],
      intentClaimIds: ["warnings-1", "warnings-2", "warnings-3", "purpose-1"] }] }, before = structuredClone(draft);
    expect(resolveGeneratedClaimReferences(input, draft)).toEqual({ content: { paragraphs: [{ ...draft.paragraphs[0],
      intentClaimIds: ["warning-1", "warnings-2", "warnings-3", "purpose-1"] }] }, repairs: [{ from: "warnings-1", to: "warning-1" }], omittedUnresolved: [] });
    expect(draft).toEqual(before);
  });
  it("preserves an exact existing ID instead of guessing between similarly named claims", () => {
    const input = intent(); input.purpose.push({ id: "warnings-1", text: "다른 주장", origin: "transcript", evidence: [] });
    expect(resolveGeneratedClaimReferences(input, { intentClaimIds: ["warnings-1"] }))
      .toEqual({ content: { intentClaimIds: ["warnings-1"] }, repairs: [], omittedUnresolved: [] });
  });
  it("omits an unresolved link only when supported claims remain, without changing the archived content", () => {
    const input = intent(); input.uncertainties.push({ id: "uncertain-1", text: "미확정 해석", origin: "unresolved", evidence: [] });
    const draft = { text: "보존할 문장", intentClaimIds: ["warnings-1", "uncertain-1", "unknown", "warning-2"] };
    expect(resolveGeneratedClaimReferences(input, draft)).toMatchObject({ content: { ...draft,
      intentClaimIds: ["warning-1", "unknown", "warning-2"] }, omittedUnresolved: ["uncertain-1"] });
    expect(draft.intentClaimIds).toContain("uncertain-1");
    expect(resolveGeneratedClaimReferences(input, { intentClaimIds: ["uncertain-1"] }))
      .toMatchObject({ content: { intentClaimIds: ["uncertain-1"] }, omittedUnresolved: [] });
  });
  it.each(["summary", "child_candidates", "adult_candidates"] as const)("limits %s references to the supplied transcript IDs in the provider schema", task => {
    const result = openAiDraftBody({ task, input: { transcript: { format: "plain_text", text: "합성 자료" }, intent: intent() } });
    const found: unknown[] = [];
    function visit(value: unknown) {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (key === "intentClaimIds") found.push(child);
        visit(child);
      }
    }
    visit(result.text.format.schema);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ items: { type: "string", enum: ["warning-1"] } });
    expect(result.text.format.name).toBe(`${task}_v4`);
  });
});
