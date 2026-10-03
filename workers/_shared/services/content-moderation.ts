import { isCompleteHangulSyllable } from "../../../shared/puzzle/hangul";
import type { PublicPuzzleGrid } from "../../../shared/puzzle/types";
import { z } from "zod";

export type ModerationScope = "answer" | "comment" | "name";
export type ModerationRuleScope = ModerationScope | "all";
export type ModerationMatchMode = "contains" | "exact";

export interface ReservedNameRule {
  enabled: boolean;
  id: string;
  normalizedValue: string;
}

export interface ModerationRule {
  enabled: boolean;
  id: string;
  matchMode: ModerationMatchMode;
  normalizedPattern: string;
  scope: ModerationRuleScope;
}

export interface ModerationException {
  enabled: boolean;
  id: string;
  normalizedValue: string;
  scope: ModerationScope;
}

export interface ModerationPolicy {
  exceptions: readonly ModerationException[];
  reservedNames: readonly ReservedNameRule[];
  rules: readonly ModerationRule[];
}

export type PublicModerationError =
  | { code: "CONTENT_BLOCKED"; field: "cells" | "comment" | "name" }
  | { code: "INVALID_COMMENT"; field: "comment" }
  | { code: "INVALID_NAME"; field: "name" }
  | { code: "NAME_RESERVED"; field: "name" };

export type SubmissionModerationResult =
  | { ok: true; value: { comment: string | null; name: string } }
  | { ok: false; error: PublicModerationError };

export interface ModerationInspection {
  blocked: boolean;
  matchedRuleId?: string;
  normalizedValue: string;
}

export class InvalidModerationPolicy extends Error {
  constructor() {
    super("INVALID_MODERATION_POLICY");
  }
}

export class InvalidModerationSource extends Error {
  constructor() {
    super("INVALID_MODERATION_SOURCE");
  }
}

const graphemeSegmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });
const invisibleOrControlPattern = /[\p{Cc}\p{Cf}]/u;
const namePattern = /^[가-힣A-Za-z0-9]+(?: [가-힣A-Za-z0-9]+)*$/u;
const commentPattern = /^[가-힣A-Za-z0-9 .,!?"'():;~…-]*$/u;
const contactPattern = /(?:https?:\/\/|www\.|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}|(?:^|[^0-9])(?:0[0-9]{1,2}[- .]?)?[0-9]{3,4}[- .]?[0-9]{4}(?:$|[^0-9]))/iu;
const excessiveRepeatPattern = /(.)\1{7,}/u;
const moderationPolicySchema = z.strictObject({
  exceptions: z.array(z.strictObject({
    enabled: z.boolean(),
    id: z.string().min(1).max(128),
    normalizedValue: z.string().min(1).max(512),
    scope: z.enum(["answer", "comment", "name"]),
  })).max(10_000),
  reservedNames: z.array(z.strictObject({
    enabled: z.boolean(),
    id: z.string().min(1).max(128),
    normalizedValue: z.string().min(1).max(512),
  })).max(10_000),
  rules: z.array(z.strictObject({
    enabled: z.boolean(),
    id: z.string().min(1).max(128),
    matchMode: z.enum(["contains", "exact"]),
    normalizedPattern: z.string().min(1).max(512),
    scope: z.enum(["all", "answer", "comment", "name"]),
  })).max(10_000),
});

const baselineReservedNames = [
  "다사랑교회",
  "관리자",
  "운영자",
  "admin",
  "official",
  "목사",
  "목사님",
  "담임목사",
  "전도사",
  "교역자",
].map((value) => ({
  enabled: true,
  id: `baseline:${value}`,
  normalizedValue: normalizeReservedName(value),
})) satisfies ReservedNameRule[];

function graphemeCount(value: string): number {
  return Array.from(graphemeSegmenter.segment(value)).length;
}

export function normalizeReservedName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function normalizeModerationValue(value: string): string {
  return normalizeReservedName(value).replace(/([\p{L}\p{N}])\1{2,}/gu, "$1");
}

export function assertModerationPolicy(policy: ModerationPolicy): void {
  if (!moderationPolicySchema.safeParse(policy).success) throw new InvalidModerationPolicy();
  const ids = new Set<string>();
  const addId = (id: string) => {
    if (id.length === 0 || id.length > 128 || ids.has(id)) throw new InvalidModerationPolicy();
    ids.add(id);
  };

  for (const item of [...policy.reservedNames, ...policy.rules, ...policy.exceptions]) {
    addId(item.id);
  }
  for (const reserved of policy.reservedNames) {
    if (
      reserved.normalizedValue.length === 0 ||
      reserved.normalizedValue !== normalizeReservedName(reserved.normalizedValue)
    ) throw new InvalidModerationPolicy();
  }
  for (const rule of policy.rules) {
    if (
      !["answer", "comment", "name", "all"].includes(rule.scope) ||
      !["contains", "exact"].includes(rule.matchMode) ||
      rule.normalizedPattern.length === 0 ||
      rule.normalizedPattern !== normalizeModerationValue(rule.normalizedPattern)
    ) throw new InvalidModerationPolicy();
  }
  for (const exception of policy.exceptions) {
    if (
      !["answer", "comment", "name"].includes(exception.scope) ||
      exception.normalizedValue.length === 0 ||
      exception.normalizedValue !== normalizeModerationValue(exception.normalizedValue)
    ) throw new InvalidModerationPolicy();
  }
}

export function inspectModerationValue(
  scope: ModerationScope,
  value: string,
  policy: ModerationPolicy,
): ModerationInspection {
  assertModerationPolicy(policy);
  const normalizedValue = normalizeModerationValue(value);
  const isException = policy.exceptions.some((exception) =>
    exception.enabled &&
    exception.scope === scope &&
    exception.normalizedValue === normalizedValue
  );
  if (isException) return { blocked: false, normalizedValue };

  const matched = policy.rules.find((rule) => {
    if (!rule.enabled || (rule.scope !== scope && rule.scope !== "all")) return false;
    return rule.matchMode === "exact"
      ? normalizedValue === rule.normalizedPattern
      : normalizedValue.includes(rule.normalizedPattern);
  });
  return matched === undefined
    ? { blocked: false, normalizedValue }
    : { blocked: true, matchedRuleId: matched.id, normalizedValue };
}

export function inspectReservedName(
  value: string,
  policy: ModerationPolicy,
): ModerationInspection {
  assertModerationPolicy(policy);
  const normalizedValue = normalizeReservedName(value);
  const matched = [...baselineReservedNames, ...policy.reservedNames].find(
    (rule) => rule.enabled && rule.normalizedValue === normalizedValue,
  );
  return matched === undefined
    ? { blocked: false, normalizedValue }
    : { blocked: true, matchedRuleId: matched.id, normalizedValue };
}

function normalizeName(value: string): string | undefined {
  if (invisibleOrControlPattern.test(value)) return undefined;
  const normalized = value.normalize("NFC").trim();
  if (
    graphemeCount(normalized) < 2 ||
    graphemeCount(normalized) > 12 ||
    !namePattern.test(normalized)
  ) return undefined;
  return normalized;
}

function normalizeComment(value: string): string | null | undefined {
  if (invisibleOrControlPattern.test(value)) return undefined;
  const normalized = value.normalize("NFC").trim();
  if (normalized.length === 0) return null;
  if (graphemeCount(normalized) > 80) return undefined;
  return normalized;
}

/** Administrator-only evidence uses the same field checks as public submission. */
export function inspectSubmissionField(scope: "name" | "comment" | "answer", value: string, policy: ModerationPolicy): ModerationInspection {
  assertModerationPolicy(policy);
  const reject = (id: string): ModerationInspection => ({ blocked: true, matchedRuleId: id, normalizedValue: normalizeModerationValue(value) });
  if (scope === "name") {
    const name = normalizeName(value);
    if (name === undefined) return reject("input:INVALID_NAME");
    const reserved = inspectReservedName(name, policy);
    return reserved.blocked ? reserved : inspectModerationValue(scope, name, policy);
  }
  if (scope === "comment") {
    const comment = normalizeComment(value);
    if (comment === undefined) return reject("input:INVALID_COMMENT");
    if (comment !== null) {
      if (contactPattern.test(comment) || excessiveRepeatPattern.test(comment.replace(/\s/gu, ""))) return reject("input:CONTENT_BLOCKED");
      if (!commentPattern.test(comment)) return reject("input:INVALID_COMMENT");
    }
    return inspectModerationValue(scope, comment ?? "", policy);
  }
  return inspectModerationValue(scope, value, policy);
}

function splitWrittenSegments(values: readonly (string | undefined)[]): string[] {
  const segments: string[] = [];
  let current = "";
  for (const value of [...values, undefined]) {
    if (value === undefined) {
      if (current.length > 0) segments.push(current);
      current = "";
    } else {
      current += value;
    }
  }
  return segments;
}

function entryCellIds(entry: PublicPuzzleGrid["entries"][number]): string[] {
  return Array.from({ length: entry.length }, (_, offset) => {
    const row = entry.start.row + (entry.direction === "down" ? offset : 0);
    const column = entry.start.column + (entry.direction === "across" ? offset : 0);
    return `r${row}c${column}`;
  });
}

export function collectSubmittedAnswerStrings(
  grid: PublicPuzzleGrid,
  cells: Readonly<Record<string, string>>,
): readonly string[] {
  const activeCells = new Map(grid.cells.map((cell) => [cell.id, cell]));
  if (
    !Number.isInteger(grid.gridSize) ||
    grid.gridSize < 5 ||
    grid.gridSize > 10 ||
    activeCells.size !== grid.cells.length ||
    grid.entries.length === 0 ||
    new Set(grid.entries.map((entry) => entry.id)).size !== grid.entries.length ||
    grid.cells.some((cell) =>
      !Number.isInteger(cell.row) ||
      !Number.isInteger(cell.column) ||
      cell.row < 0 ||
      cell.column < 0 ||
      cell.row >= grid.gridSize ||
      cell.column >= grid.gridSize ||
      cell.id !== `r${cell.row}c${cell.column}`
    ) ||
    grid.entries.some((entry) =>
      (entry.direction !== "across" && entry.direction !== "down") ||
      !Number.isInteger(entry.length) ||
      !Number.isInteger(entry.start.row) ||
      !Number.isInteger(entry.start.column) ||
      entry.length < 2 ||
      entry.length > grid.gridSize ||
      entry.start.row < 0 ||
      entry.start.column < 0 ||
      entry.start.row >= grid.gridSize ||
      entry.start.column >= grid.gridSize
    )
  ) throw new InvalidModerationSource();

  const normalizedCells = new Map<string, string>();
  for (const [id, value] of Object.entries(cells)) {
    if (typeof value !== "string") throw new InvalidModerationSource();
    const normalized = value.normalize("NFC");
    if (!activeCells.has(id) || !isCompleteHangulSyllable(normalized)) {
      throw new InvalidModerationSource();
    }
    normalizedCells.set(id, normalized);
  }

  const segments = new Set<string>();
  for (const entry of grid.entries) {
    const ids = entryCellIds(entry);
    if (ids.some((id) => !activeCells.has(id))) throw new InvalidModerationSource();
    for (const segment of splitWrittenSegments(ids.map((id) => normalizedCells.get(id)))) {
      segments.add(segment);
    }
  }
  for (let row = 0; row < grid.gridSize; row += 1) {
    for (const segment of splitWrittenSegments(Array.from(
      { length: grid.gridSize },
      (_, column) => normalizedCells.get(`r${row}c${column}`),
    ))) segments.add(segment);
  }
  for (let column = 0; column < grid.gridSize; column += 1) {
    for (const segment of splitWrittenSegments(Array.from(
      { length: grid.gridSize },
      (_, row) => normalizedCells.get(`r${row}c${column}`),
    ))) segments.add(segment);
  }
  return [...segments];
}

export function moderateSubmissionContent(
  input: {
    cells: Readonly<Record<string, string>>;
    comment: string;
    grid: PublicPuzzleGrid;
    name: string;
  },
  policy: ModerationPolicy,
): SubmissionModerationResult {
  assertModerationPolicy(policy);
  const name = normalizeName(input.name);
  if (name === undefined) return { ok: false, error: { code: "INVALID_NAME", field: "name" } };
  if (inspectReservedName(name, policy).blocked) {
    return { ok: false, error: { code: "NAME_RESERVED", field: "name" } };
  }
  if (inspectModerationValue("name", name, policy).blocked) {
    return { ok: false, error: { code: "CONTENT_BLOCKED", field: "name" } };
  }

  const comment = normalizeComment(input.comment);
  if (comment === undefined) {
    return { ok: false, error: { code: "INVALID_COMMENT", field: "comment" } };
  }
  if (comment !== null) {
    if (
      contactPattern.test(comment) ||
      excessiveRepeatPattern.test(comment.replace(/\s/gu, ""))
    ) {
      return { ok: false, error: { code: "CONTENT_BLOCKED", field: "comment" } };
    }
    if (!commentPattern.test(comment)) {
      return { ok: false, error: { code: "INVALID_COMMENT", field: "comment" } };
    }
    if (inspectModerationValue("comment", comment, policy).blocked) {
      return { ok: false, error: { code: "CONTENT_BLOCKED", field: "comment" } };
    }
  }

  for (const answer of collectSubmittedAnswerStrings(input.grid, input.cells)) {
    if (inspectModerationValue("answer", answer, policy).blocked) {
      return { ok: false, error: { code: "CONTENT_BLOCKED", field: "cells" } };
    }
  }
  return { ok: true, value: { comment, name } };
}
