import type {
  AnswerValidationIssue,
  AnswerValidationResult,
  NormalizedPuzzleCandidate,
  PuzzleCandidateInput,
} from "./types";

const COMPLETE_HANGUL_SYLLABLE = /^[\uAC00-\uD7A3]$/u;
const WHITESPACE = /\s/gu;
const WHITESPACE_RUN = /\s+/gu;

export function isCompleteHangulSyllable(value: string): boolean {
  return COMPLETE_HANGUL_SYLLABLE.test(value);
}

export function normalizeDisplayAnswer(value: string): string {
  return value.normalize("NFC").trim().replace(WHITESPACE_RUN, " ");
}

export function toGridAnswer(displayAnswer: string): string {
  return normalizeDisplayAnswer(displayAnswer).replace(WHITESPACE, "");
}

export function validateAndNormalizeAnswer(
  candidate: PuzzleCandidateInput,
  gridSize: number,
): AnswerValidationResult {
  const displayAnswer = normalizeDisplayAnswer(candidate.displayAnswer);
  const derivedGridAnswer = toGridAnswer(displayAnswer);
  const suppliedGridAnswer = candidate.gridAnswer?.normalize("NFC");
  const gridAnswer = suppliedGridAnswer ?? derivedGridAnswer;
  const issues: AnswerValidationIssue[] = [];

  if (displayAnswer.length === 0 || gridAnswer.length === 0) {
    issues.push({
      code: "EMPTY_ANSWER",
      field: displayAnswer.length === 0 ? "displayAnswer" : "gridAnswer",
      message: "정답은 비어 있을 수 없습니다.",
      value: displayAnswer.length === 0 ? displayAnswer : gridAnswer,
    });
  }

  if (suppliedGridAnswer !== undefined && suppliedGridAnswer !== derivedGridAnswer) {
    issues.push({
      code: "GRID_ANSWER_MISMATCH",
      field: "gridAnswer",
      message: "격자형 정답은 표시형 정답에서 공백만 제거한 값이어야 합니다.",
      value: suppliedGridAnswer,
    });
  }

  const syllables = Array.from(gridAnswer);
  for (const [index, syllable] of syllables.entries()) {
    if (!isCompleteHangulSyllable(syllable)) {
      issues.push({
        code: "INVALID_HANGUL_SYLLABLE",
        field: "gridAnswer",
        index,
        message: "격자형 정답에는 NFC 완성형 한글 음절만 사용할 수 있습니다.",
        value: syllable,
      });
    }
  }

  if (syllables.length < 2) {
    issues.push({
      code: "WORD_TOO_SHORT",
      field: "gridAnswer",
      message: "격자형 정답은 두 음절 이상이어야 합니다.",
      minimum: 2,
      value: gridAnswer,
    });
  }

  if (syllables.length > gridSize) {
    issues.push({
      code: "WORD_TOO_LONG",
      field: "gridAnswer",
      maximum: gridSize,
      message: `격자형 정답은 ${gridSize}음절을 넘을 수 없습니다.`,
      value: gridAnswer,
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const value: NormalizedPuzzleCandidate = {
    id: candidate.id,
    displayAnswer,
    gridAnswer,
    syllables,
  };
  if (candidate.clue !== undefined) {
    value.clue = candidate.clue;
  }

  return { ok: true, value };
}
