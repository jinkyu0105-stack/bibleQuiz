-- Synthetic browser integration fixture. It is loaded only into a fresh /tmp D1.
-- It is not a real sermon, summary, answer set, local developer DB, or deployable seed.
PRAGMA foreign_keys = ON;

INSERT INTO bible_translations (
  id, display_name, edition, publisher_or_rightsholder, mode, created_at, updated_at
) VALUES (
  'e2e-translation', '개역개정', 'reference-only', '대한성서공회', 'reference_only',
  '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'
);

INSERT INTO sermons (
  id, slug, slug_suffix, church_name, youtube_url, youtube_video_id, sermon_title,
  sermon_date, bible_translation_id, bible_reference_json, bible_reference_label,
  bible_text_snapshot, ai_summary, ai_summary_disclosure, created_at, updated_at
) VALUES (
  'e2etest', '2026-09-01-e2e001', 'e2e001', '다사랑교회',
  'https://www.youtube.com/watch?v=e2e001', 'e2e001', '통합 경로 검증용 설교 (테스트)',
  '2026-09-01', 'e2e-translation', '[{"book":"마태복음","chapter":5,"verseStart":1,"verseEnd":12}]',
  '마태복음 5:1-12', 'PRIVATE_E2E_CANARY_성경본문',
  '격리된 브라우저 통합 검사에만 사용하는 합성 요약입니다.',
  '아래 내용은 설교 영상의 공개 자막을 바탕으로 AI가 요약한 것으로, 설교자의 원문이 아닙니다.',
  '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'
);

INSERT INTO sermon_transcripts (
  id, sermon_id, source_revision, language, source_mode, source_coverage, is_auto_generated,
  raw_text, raw_sha256, confirmed_text, confirmed_sha256, status, confirmed_by, confirmed_at, fetched_at
) VALUES (
  'e2e-transcript', 'e2etest', 1, 'ko', 'public_unofficial', 'full_transcript', 1,
  'PRIVATE_E2E_CANARY_자막원문', 'PRIVATE_E2E_CANARY_SHA', 'PRIVATE_E2E_CANARY_확정자막',
  'PRIVATE_E2E_CANARY_CONFIRMED_SHA', 'confirmed', 'PRIVATE_E2E_CANARY_관리자',
  '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'
);

INSERT INTO quiz_sets (
  id, sermon_id, confirmed_transcript_id, status, submission_state,
  published_ai_provenance_json, published_at, opens_at, closes_at,
  created_by, created_at, updated_at
) VALUES (
  'e2e-set', 'e2etest', 'e2e-transcript', 'published', 'open',
  '[{"model":"PRIVATE_E2E_CANARY_모델","purpose":"PRIVATE_E2E_CANARY_목적"}]',
  '2026-09-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', '2099-09-07T00:00:00.000Z',
  'PRIVATE_E2E_CANARY_관리자', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'
);

INSERT INTO quiz_variants (
  id, quiz_set_id, difficulty, revision, lifecycle_status, results_status, grid_size,
  public_grid_json, word_count, active_cell_count, intersection_count,
  validation_report_json, created_at
) VALUES (
  'e2e-child', 'e2e-set', 'child', 1, 'active', 'valid', 5,
  '{"size":5,"cells":[{"row":0,"column":0,"isBlocked":false,"acrossNumber":1,"downNumber":1,"syllable":"PRIVATE_E2E_CANARY_정답"},{"row":0,"column":1,"isBlocked":false},{"row":0,"column":2,"isBlocked":false,"downNumber":2},{"row":0,"column":3,"isBlocked":false},{"row":0,"column":4,"isBlocked":false,"downNumber":3},{"row":1,"column":0,"isBlocked":false},{"row":1,"column":1,"isBlocked":true},{"row":1,"column":2,"isBlocked":false},{"row":1,"column":3,"isBlocked":true},{"row":1,"column":4,"isBlocked":false},{"row":2,"column":0,"isBlocked":false,"acrossNumber":4},{"row":2,"column":1,"isBlocked":false},{"row":2,"column":2,"isBlocked":false},{"row":2,"column":3,"isBlocked":false},{"row":2,"column":4,"isBlocked":false},{"row":3,"column":0,"isBlocked":false},{"row":3,"column":1,"isBlocked":true},{"row":3,"column":2,"isBlocked":false},{"row":3,"column":3,"isBlocked":true},{"row":3,"column":4,"isBlocked":false},{"row":4,"column":0,"isBlocked":false,"acrossNumber":5},{"row":4,"column":1,"isBlocked":false},{"row":4,"column":2,"isBlocked":false},{"row":4,"column":3,"isBlocked":false},{"row":4,"column":4,"isBlocked":false}]}',
  6, 21, 9,
  '{"errors":[],"warnings":["PRIVATE_E2E_CANARY_검증"],"generatedAt":"2026-09-01T00:00:00.000Z"}',
  '2026-09-01T00:00:00.000Z'
);

INSERT INTO quiz_entries_public (
  id, quiz_variant_id, number, direction, start_row, start_col, length, clue,
  transcript_evidence_json, display_order
) VALUES
  ('e2e-across-1', 'e2e-child', 1, 'across', 0, 0, 5, '가로 1번 통합 검사 단서', '{"private":"PRIVATE_E2E_CANARY_근거"}', 0),
  ('e2e-down-1', 'e2e-child', 1, 'down', 0, 0, 5, '세로 1번 통합 검사 단서', '{"private":"PRIVATE_E2E_CANARY_근거"}', 1),
  ('e2e-down-2', 'e2e-child', 2, 'down', 0, 2, 5, '세로 2번 통합 검사 단서', '{"private":"PRIVATE_E2E_CANARY_근거"}', 2),
  ('e2e-down-3', 'e2e-child', 3, 'down', 0, 4, 5, '세로 3번 통합 검사 단서', '{"private":"PRIVATE_E2E_CANARY_근거"}', 3),
  ('e2e-across-4', 'e2e-child', 4, 'across', 2, 0, 5, '가로 4번 통합 검사 단서', '{"private":"PRIVATE_E2E_CANARY_근거"}', 4),
  ('e2e-across-5', 'e2e-child', 5, 'across', 4, 0, 5, '가로 5번 통합 검사 단서', '{"private":"PRIVATE_E2E_CANARY_근거"}', 5);

-- Valid server-only solution canary. Public repositories must never select it.
INSERT INTO quiz_solutions (
  quiz_variant_id, canonical_cell_order_json, solution_cells_json,
  entry_answers_json, solution_sha256
) VALUES (
  'e2e-child',
  '["r0c0","r0c1","r0c2","r0c3","r0c4","r1c0","r1c2","r1c4","r2c0","r2c1","r2c2","r2c3","r2c4","r3c0","r3c2","r3c4","r4c0","r4c1","r4c2","r4c3","r4c4"]',
  '{"r0c0":"비","r0c1":"공","r0c2":"개","r0c3":"정","r0c4":"답","r1c0":"가","r1c2":"가","r1c4":"가","r2c0":"가","r2c1":"가","r2c2":"가","r2c3":"가","r2c4":"가","r3c0":"가","r3c2":"가","r3c4":"가","r4c0":"가","r4c1":"가","r4c2":"가","r4c3":"가","r4c4":"가"}',
  '{"e2e-across-1":"비공개정답","e2e-down-1":"비가가가가","e2e-down-2":"개가가가가","e2e-down-3":"답가가가가","e2e-across-4":"가가가가가","e2e-across-5":"가가가가가"}',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);

INSERT INTO site_state (key, value, updated_at) VALUES (
  'featured_quiz_set_id', 'e2e-set', '2026-09-01T00:00:00.000Z'
);
