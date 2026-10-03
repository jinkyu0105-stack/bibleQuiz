import type { AdminSermonInputCurrent } from "../../../shared/api/admin-sermon-input";

export type TextDiffPart = { kind: "equal" | "added" | "removed"; text: string };

type InputContent = AdminSermonInputCurrent["content"];

export function inputContentText(content: InputContent): string {
  return content.format === "plain_text" ? content.text : content.segments.map((segment) => segment.text).join("\n");
}

function tokens(text: string): string[] {
  return text.match(/[^\s]+|\s+/gu) ?? [];
}

function append(parts: TextDiffPart[], kind: TextDiffPart["kind"], text: string) {
  if (text.length === 0) return;
  const previous = parts.at(-1);
  if (previous?.kind === kind) previous.text += text;
  else parts.push({ kind, text });
}

/** Bounded browser-only diff. Large changed middles stay as one removed/added pair. */
export function createTextDiff(left: string, right: string): TextDiffPart[] {
  if (left === right) return [{ kind: "equal", text: left }];
  const before = tokens(left);
  const after = tokens(right);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;

  const leftMiddle = before.slice(prefix, before.length - suffix);
  const rightMiddle = after.slice(prefix, after.length - suffix);
  const result: TextDiffPart[] = [];
  append(result, "equal", before.slice(0, prefix).join(""));

  if (leftMiddle.length * rightMiddle.length > 40_000) {
    append(result, "removed", leftMiddle.join(""));
    append(result, "added", rightMiddle.join(""));
  } else {
    const rows = Array.from({ length: leftMiddle.length + 1 }, () => new Uint16Array(rightMiddle.length + 1));
    for (let i = leftMiddle.length - 1; i >= 0; i--) {
      for (let j = rightMiddle.length - 1; j >= 0; j--) {
        rows[i]![j] = leftMiddle[i] === rightMiddle[j]
          ? rows[i + 1]![j + 1]! + 1
          : Math.max(rows[i + 1]![j]!, rows[i]![j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < leftMiddle.length || j < rightMiddle.length) {
      if (i < leftMiddle.length && j < rightMiddle.length && leftMiddle[i] === rightMiddle[j]) {
        append(result, "equal", leftMiddle[i++]!);
        j++;
      } else if (j < rightMiddle.length && (i === leftMiddle.length || rows[i]![j + 1]! >= rows[i + 1]![j]!)) {
        append(result, "added", rightMiddle[j++]!);
      } else {
        append(result, "removed", leftMiddle[i++]!);
      }
    }
  }
  append(result, "equal", before.slice(before.length - suffix).join(""));
  return result;
}
