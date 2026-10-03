-- Synthetic P4-23 Preview acceptance candidate.
-- Rehearse this file only in an isolated local D1 until remote registration is approved.
-- It contains no real sermon, Bible text, transcript, summary, person, or administrator data.
PRAGMA foreign_keys = ON;

INSERT INTO bible_translations (
  id, display_name, edition, publisher_or_rightsholder, mode, created_at, updated_at
) VALUES (
  'p423-preview-translation', '개역개정', 'reference-only', '대한성서공회', 'reference_only',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

INSERT INTO sermons (
  id, slug, slug_suffix, church_name, youtube_url, youtube_video_id, sermon_title,
  sermon_date, bible_translation_id, bible_reference_json, bible_reference_label,
  bible_text_snapshot, ai_summary, ai_summary_disclosure, created_at, updated_at
) VALUES (
  'p423-preview-sermon', '2026-09-05-p423qa', 'p423qa', '기능 확인용',
  'https://www.youtube.com/watch?v=p423qa00001', 'p423qa00001',
  '기능 확인용 연습 문제 — 실제 설교 아님', '2026-09-05',
  'p423-preview-translation',
  '[{"book":"마태복음","chapter":5,"verseStart":1,"verseEnd":12}]',
  '마태복음 5:1-12 (기능 확인용)', NULL, NULL, NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

INSERT INTO quiz_sets (
  id, sermon_id, confirmed_transcript_id, status, submission_state,
  published_ai_provenance_json, published_at, opens_at, closes_at,
  created_by, created_at, updated_at
) VALUES (
  'p423-preview-set', 'p423-preview-sermon', NULL, 'published', 'open', NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days'),
  'p423-preview-acceptance',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

INSERT INTO quiz_variants (
  id, quiz_set_id, difficulty, revision, lifecycle_status, results_status, grid_size,
  public_grid_json, word_count, active_cell_count, intersection_count,
  validation_report_json, created_at
) VALUES (
  'p423-preview-child', 'p423-preview-set', 'child', 1, 'active', 'valid', 5,
  '{"size":5,"cells":[{"row":0,"column":0,"isBlocked":false,"acrossNumber":1,"downNumber":1},{"row":0,"column":1,"isBlocked":false},{"row":0,"column":2,"isBlocked":false,"downNumber":2},{"row":0,"column":3,"isBlocked":false},{"row":0,"column":4,"isBlocked":false,"downNumber":3},{"row":1,"column":0,"isBlocked":false},{"row":1,"column":1,"isBlocked":true},{"row":1,"column":2,"isBlocked":false},{"row":1,"column":3,"isBlocked":true},{"row":1,"column":4,"isBlocked":false},{"row":2,"column":0,"isBlocked":false,"acrossNumber":4},{"row":2,"column":1,"isBlocked":false},{"row":2,"column":2,"isBlocked":false},{"row":2,"column":3,"isBlocked":false},{"row":2,"column":4,"isBlocked":false},{"row":3,"column":0,"isBlocked":false},{"row":3,"column":1,"isBlocked":true},{"row":3,"column":2,"isBlocked":false},{"row":3,"column":3,"isBlocked":true},{"row":3,"column":4,"isBlocked":false},{"row":4,"column":0,"isBlocked":false,"acrossNumber":5},{"row":4,"column":1,"isBlocked":false},{"row":4,"column":2,"isBlocked":false},{"row":4,"column":3,"isBlocked":false},{"row":4,"column":4,"isBlocked":false}]}',
  6, 21, 9,
  '{"errors":[],"warnings":["기능 확인용 합성 격자"],"generatedAt":"2026-09-05T00:00:00.000Z"}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

INSERT INTO quiz_entries_public (
  id, quiz_variant_id, number, direction, start_row, start_col, length, clue,
  transcript_evidence_json, display_order
) VALUES
  ('p423-preview-across-1', 'p423-preview-child', 1, 'across', 0, 0, 5, '가로 1번 기능 확인 단서', NULL, 0),
  ('p423-preview-down-1', 'p423-preview-child', 1, 'down', 0, 0, 5, '세로 1번 기능 확인 단서', NULL, 1),
  ('p423-preview-down-2', 'p423-preview-child', 2, 'down', 0, 2, 5, '세로 2번 기능 확인 단서', NULL, 2),
  ('p423-preview-down-3', 'p423-preview-child', 3, 'down', 0, 4, 5, '세로 3번 기능 확인 단서', NULL, 3),
  ('p423-preview-across-4', 'p423-preview-child', 4, 'across', 2, 0, 5, '가로 4번 기능 확인 단서', NULL, 4),
  ('p423-preview-across-5', 'p423-preview-child', 5, 'across', 4, 0, 5, '가로 5번 기능 확인 단서', NULL, 5);

-- Server-only synthetic answer material. Public responses must never expose it.
INSERT INTO quiz_solutions (
  quiz_variant_id, canonical_cell_order_json, solution_cells_json,
  entry_answers_json, solution_sha256
) VALUES (
  'p423-preview-child',
  '["r0c0","r0c1","r0c2","r0c3","r0c4","r1c0","r1c2","r1c4","r2c0","r2c1","r2c2","r2c3","r2c4","r3c0","r3c2","r3c4","r4c0","r4c1","r4c2","r4c3","r4c4"]',
  '{"r0c0":"가","r0c1":"가","r0c2":"가","r0c3":"가","r0c4":"가","r1c0":"가","r1c2":"가","r1c4":"가","r2c0":"가","r2c1":"가","r2c2":"가","r2c3":"가","r2c4":"가","r3c0":"가","r3c2":"가","r3c4":"가","r4c0":"가","r4c1":"가","r4c2":"가","r4c3":"가","r4c4":"가"}',
  '{"p423-preview-across-1":"가가가가가","p423-preview-down-1":"가가가가가","p423-preview-down-2":"가가가가가","p423-preview-down-3":"가가가가가","p423-preview-across-4":"가가가가가","p423-preview-across-5":"가가가가가"}',
  '504e672a75b2bb9ed93ff464c15c4398cb25b42e435771a56e681269905a41a1'
);
