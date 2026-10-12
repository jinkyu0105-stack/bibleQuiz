/** Explicit P9-15 synthetic data. Does not execute SQL or call any network API. */
import { parseBibleReference } from "../shared/bible-reference";
import { generatePuzzle } from "../shared/puzzle/generator";
import { serializePublicPuzzle } from "../shared/puzzle/serialization";
import { scoreSubmission } from "../workers/_shared/services/submission-scoring";
import { prepareManualTranscriptSource } from "../workers/_shared/services/manual-transcript-source";
import { sha256Bytes } from "../workers/_shared/storage/sha256";

const enc = new TextEncoder();
const hash = (value: string) => sha256Bytes(enc.encode(value));
const json = (value: unknown) => JSON.stringify(value);
const quote = (value: string | number | null) => value === null ? "NULL" : typeof value === "number" ? String(value) : "'" + value.replaceAll("'", "''") + "'";
export const demoMarker = "P9-15-SYNTHETIC";
export const demoNow = "2026-10-12T07:00:00.000Z";
const sets = [
  { key: "draft", date: "2026-10-18", title: "편집 연습 — 사랑을 나누는 하루", status: "draft", opens: null, closes: null },
  { key: "open", date: "2026-10-12", title: "함께 나누는 감사", status: "published", opens: "2026-10-12T00:00:00.000Z", closes: "2026-10-26T14:59:59.000Z" },
  { key: "archive-one", date: "2026-10-04", title: "이웃과 함께 걷는 길", status: "archived", opens: "2026-10-04T00:00:00.000Z", closes: "2026-10-10T14:59:59.000Z" },
  { key: "archive-two", date: "2026-09-27", title: "마음에 자라는 평화", status: "archived", opens: "2026-09-27T00:00:00.000Z", closes: "2026-10-03T14:59:59.000Z" },
] as const;
const pools: Record<string, [string, string][]> = {
  "open-child": [["감사해요", "고마운 마음을 전할 때 하는 네 글자 말이에요."], ["요리사", "음식을 만드는 일을 하는 사람이에요."], ["사과나무", "사과가 열리는 나무예요."], ["무지개", "비가 그친 뒤 하늘에서 볼 수 있는 여러 색의 띠예요."], ["개나리", "봄에 노란 꽃이 피는 나무예요."]],
  "open-adult": [["감사기도", "고마운 마음을 하나님께 전하는 기도입니다."], ["기도생활", "일상에서 꾸준히 기도하며 살아가는 태도입니다."], ["생활습관", "일상에서 반복하여 익숙해진 행동 방식입니다."], ["관심거리", "마음을 두고 살펴보게 되는 일이나 대상입니다."], ["거리청소", "길이나 도로의 쓰레기를 치우고 깨끗하게 하는 일입니다."]],
  "archive-one-child": [["해바라기", "크고 노란 꽃이 피며 이름에 해가 들어가는 식물이에요."], ["기차역", "기차를 타고 내리는 곳이에요."], ["역무원", "기차역에서 안내와 역의 일을 맡는 사람이에요."], ["원숭이", "손발로 나무를 잘 타는 동물이에요."], ["종이배", "종이를 접어서 만든 작은 배예요."]],
  "archive-one-adult": [["사랑나눔", "아끼는 마음을 이웃과 함께 나누는 활동을 뜻합니다."], ["나눔행사", "물품이나 마음을 서로 나누기 위해 여는 모임입니다."], ["행복한마음", "기쁘고 만족스러운 내면의 상태를 다섯 글자로 표현한 말입니다."], ["마음가짐", "어떤 일을 대할 때 품는 태도나 자세입니다."], ["짐수레", "짐을 싣고 옮기는 데 쓰는 수레입니다."]],
  "archive-two-child": [["기도문", "기도할 내용을 글로 적어 놓은 것이에요."], ["문방구", "연필이나 공책 같은 학용품을 파는 가게예요."], ["구급차", "아픈 사람을 급히 병원으로 옮기는 차예요."], ["자동차", "도로에서 사람이나 짐을 싣고 달리는 탈것이에요."], ["자전거", "두 바퀴와 페달로 움직이는 탈것이에요."]],
  "archive-two-adult": [["평화로운마음", "다툼이나 불안 없이 고요한 내면을 여섯 글자로 표현한 말입니다."], ["마음가짐", "일을 대하는 정신적인 자세나 태도입니다."], ["짐수레", "무거운 물건을 싣고 옮기는 수레입니다."], ["레몬나무", "신맛이 나는 노란 열매가 열리는 나무입니다."], ["무지개", "햇빛이 공기 중 물방울을 지나며 나타나는 여러 색의 띠입니다."]],
};
export async function buildPreviewDemo() {
  const statements: string[] = [];
  const rows: { table: string; values: Record<string, string | number | null> }[] = [];
  const insert = (table: string, values: Record<string, string | number | null>) => {
    rows.push({ table, values });
    statements.push(`INSERT INTO ${table} (${Object.keys(values).join(",")}) VALUES (${Object.values(values).map(quote).join(",")});`);
  };
  const uuid = async (key: string, version = "4") => { const h = await hash(`${demoMarker}/${key}`); return `${h.slice(0,8)}-${h.slice(8,12)}-${version}${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`; };
  const actor = await hash(demoMarker);
  const reference = parseBibleReference("요한복음 3:16");
  if (!reference.ok) throw new Error("fixture reference");
  const translation = "p915-reference-only";
  insert("bible_translations", { id: translation, display_name: "개역개정", edition: "reference-only", publisher_or_rightsholder: "대한성서공회", mode: "reference_only", created_at: demoNow, updated_at: demoNow });
  const manifest = [];
  const puzzles = [];
  for (const [setIndex, set] of sets.entries()) {
    const sermonId = await uuid(`${set.key}/sermon`), quizSetId = await uuid(`${set.key}/quiz`);
    const suffix = ["p915ed", "p915op", "p915a1", "p915a2"][setIndex]!;
    const slug = `${set.date}-${suffix}`, title = `[테스트] ${set.title}`;
    manifest.push({ ...set, sermonId, quizSetId, slug: set.status === "draft" ? null : slug, title });
    insert("sermons", { id: sermonId, slug: set.status === "draft" ? null : slug, slug_suffix: suffix, church_name: "기능 확인용 가상 교회", youtube_url: `https://www.youtube.com/watch?v=P915DEMO00${setIndex}`, youtube_video_id: `P915DEMO00${setIndex}`, sermon_title: title, sermon_date: set.date, bible_translation_id: translation, bible_reference_json: json([{ book: "요한복음", chapter: 3, verseStart: 16, verseEnd: 16 }]), bible_reference_label: "요한복음 3:16 (장절 표시 시험)", bible_text_snapshot: null, ai_summary: null, ai_summary_disclosure: null, created_at: set.opens ?? demoNow, updated_at: demoNow });
    insert("quiz_sets", { id: quizSetId, sermon_id: sermonId, status: set.status, submission_state: "open", published_at: set.opens, opens_at: set.opens, closes_at: set.closes, archived_at: set.status === "archived" ? set.closes : null, created_by: actor, created_at: set.opens ?? demoNow, updated_at: demoNow });
    if (set.status === "draft") {
      insert("sermon_metadata_drafts", { sermon_id: sermonId, contract_version: 1, metadata_revision: 1, title, sermon_date: set.date, bible_reference_json: json(reference.value) });
      const text = "[테스트용 편집 자료]\n실제 설교나 성경 본문이 아닙니다. 입력과 저장을 연습하기 위해 작성한 가상 문서입니다.\n우리는 이웃에게 고마운 마음을 전하고 도움이 필요한 친구에게 먼저 손을 내밀 수 있습니다. 오늘 실천하고 싶은 작은 친절 한 가지를 생각해 봅시다.\n이 문장의 표현을 바꾸거나 마지막에 실천 계획을 덧붙여 저장해 보세요. AI 생성은 실행하지 않습니다.";
      const prepared = await prepareManualTranscriptSource({ sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript", sourceCoverage: "full_transcript", rawTranscriptText: text });
      if (prepared.outcome !== "validated") throw new Error("fixture input");
      const eventId = await uuid("draft/source"), payload = json(prepared.source);
      insert("sermon_input_events", { sermon_id: sermonId, version: 1, id: eventId, kind: "source", source_type: "caption_plain", source_id: eventId, document_id: eventId, confirmation_id: null, parent_document_id: null, related_id: null, document_sha256: prepared.source.rawTranscriptSha256, payload_sha256: await hash(payload), chunk_count: 1, byte_length: enc.encode(payload).length, actor_id: actor, created_at: demoNow, state: "pending", required_state: "sealed" });
      insert("sermon_input_chunks", { sermon_id: sermonId, event_id: eventId, position: 0, body: payload });
      insert("sermon_input_heads", { sermon_id: sermonId, version: 1 });
      statements.push(`UPDATE sermon_input_events SET state='sealed' WHERE sermon_id=${quote(sermonId)} AND id=${quote(eventId)} AND state='pending';`);
      continue;
    }
    for (const difficulty of ["child", "adult"] as const) {
      const variantId = await uuid(`${set.key}/${difficulty}`), candidates = pools[`${set.key}-${difficulty}`]!.map(([displayAnswer, clue], i) => ({ id: `${variantId}-entry-${i+1}`, displayAnswer, clue }));
      const result = generatePuzzle({ gridSize: difficulty === "child" ? 8 : 9, candidates, seed: `${demoMarker}-${set.key}-${difficulty}`, searchBudget: 100000 });
      if (!result.ok) throw new Error(`fixture puzzle ${set.key}-${difficulty}: ${json(result)}`);
      const grid = serializePublicPuzzle(result.puzzle), solution = result.puzzle.solution, canonical = grid.cells.map(c => c.id);
      const stored = { size: grid.gridSize, cells: Array.from({ length: grid.gridSize ** 2 }, (_, i) => { const row = Math.floor(i / grid.gridSize), column = i % grid.gridSize; const entries = grid.entries.filter(e => e.start.row === row && e.start.column === column); return { row, column, isBlocked: !canonical.includes(`r${row}c${column}`), ...Object.fromEntries(entries.map(e => [e.direction === "across" ? "acrossNumber" : "downNumber", e.number])) }; }) };
      insert("quiz_variants", { id: variantId, quiz_set_id: quizSetId, difficulty, revision: 1, lifecycle_status: "active", results_status: "valid", grid_size: grid.gridSize, public_grid_json: json(stored), word_count: grid.entries.length, active_cell_count: canonical.length, intersection_count: result.puzzle.report.crossingCellCount, winner_count: 3, validation_report_json: json({ errors: [], warnings: ["테스트용 합성 퀴즈"], generatedAt: demoNow }), created_at: set.opens });
      grid.entries.forEach((e, i) => insert("quiz_entries_public", { id: e.id, quiz_variant_id: variantId, number: e.number, direction: e.direction, start_row: e.start.row, start_col: e.start.column, length: e.length, clue: e.clue!, transcript_evidence_json: "[]", display_order: i }));
      insert("quiz_solutions", { quiz_variant_id: variantId, canonical_cell_order_json: json(canonical), solution_cells_json: json(solution.cells), entry_answers_json: json(solution.entries), solution_sha256: await hash(json(solution)) });
      puzzles.push({ quizSetId, variantId, difficulty, slug, status: set.status, grid, solution, canonical });
      if (set.status !== "archived") continue;
      const snapshotId = await uuid(`${variantId}/snapshot`);
      insert("leaderboard_snapshots", { id: snapshotId, quiz_variant_id: variantId, winner_count: 3, finalized_at: set.closes });
      for (let i=0;i<3;i++) {
        const session = await hash(`${variantId}/synthetic-session/${i}`), id = await uuid(`${variantId}/submission/${i}`);
        const at = new Date(Date.parse(set.opens) + (i+1)*3600000).toISOString();
        const name = `가상${difficulty === "child" ? "어린이" : "장년"}${setIndex-1}${i+1}`;
        const comment = ["(테스트) 끝까지 풀었어요. 다음 퀴즈도 기대됩니다!", "(테스트) 가족과 함께 즐겁게 풀었습니다.", "(테스트) 어려운 칸은 비워 두었어요. 다시 도전할게요."][i]!;
        const answers = i === 2 ? Object.fromEntries(Object.entries(solution.cells).slice(0, Math.ceil(canonical.length/2))) : solution.cells;
        const score = scoreSubmission({ grid, solution, canonicalCellOrder: canonical }, answers);
        insert("anonymous_sessions", { session_hash: session, created_at: at, last_seen_at: at, expires_at: "2026-12-31T00:00:00.000Z" });
        insert("submissions", { id, quiz_variant_id: variantId, quiz_revision: 1, session_hash: session, idempotency_key: await uuid(`${id}/request`, "7"), request_hash: await hash(json({ name, comment, answers })), display_name: name, comment, answers_json: json(score.answers), correctness_mask: score.correctnessMask, correct_cells: score.correctCells, total_cells: score.totalCells, correct_words: score.correctWords, total_words: score.totalWords, score_basis_points: score.scoreBasisPoints, is_fully_correct: Number(score.isFullyCorrect), status: "visible", submitted_at: at });
        if (i<2) insert("leaderboard_snapshot_entries", { snapshot_id: snapshotId, rank: i+1, submission_id: id });
        if (i === 0 && difficulty === "child") {
          const fields = { requestType: "delete_submission", quizSlug: slug, submittedName: name, message: `[테스트용 가상 삭제 요청] ${title} 어린이 퀴즈의 ${name} 제출 기록과 코멘트를 삭제해 주세요. 관리자 처리 연습용이며 실제 사람의 요청이 아닙니다.` };
          insert("privacy_requests", { id: await uuid(`${variantId}/privacy`), lookup_token_hash: await hash(crypto.randomUUID()), request_hash: await hash(json(fields)), request_type: fields.requestType, quiz_slug: slug, submitted_name: name, message: fields.message, status: "received", created_at: demoNow, updated_at: demoNow });
        }
      }
    }
  }
  return { statements, rows, manifest, puzzles };
}
