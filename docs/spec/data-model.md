> 현재 분야별 명세. 기존 implementation 14장 기준을 옮겼으며 구현 일지는 보관본으로 분리했다. 기존 데이터/이력과 API 호환 설계도 포함한다. 교정 items/AI 감사 관련 표·계약은 과거 구현 보존 대상이며 신규 제품 기능 요구가 아니다. 실제 구현은 코드/마이그레이션과 STATUS를 확인한다.
> [명세 목차](../../implementation.md) · [현재 상태](../STATUS.md) · [변경 전 원문](../archive/2026-09-21-p5-48/implementation.md#14-d1-데이터-모델)

## 14. D1 데이터 모델

### 14.1 공통 규칙

- ID는 정렬 가능하고 URL에 안전한 UUIDv7 또는 동등한 문자열 ID를 쓴다.
- DB 시각은 UTC ISO 8601로 저장하고 화면에서 `Asia/Seoul`로 표시한다.
- JSON column은 쓰기 전에 Zod schema로 검증한다.
- foreign key를 켜고 migration으로 관리한다.
- 공개 데이터와 비공개 정답을 테이블과 repository 함수에서 분리한다.
- soft delete가 필요한 레코드는 상태와 시각을 별도 필드로 둔다.

### 14.2 성경 판본·본문

`bible_translations`

```text
id PK
display_name
edition
publication_year
publisher_or_rightsholder
mode: reference_only | licensed_api | licensed_local
source_url / license_url / permission_evidence_path
allowed_web / allowed_archive / allowed_png / allowed_pdf
required_attribution
permission_territory / permission_starts_at / permission_expires_at
permission_fee_amount / permission_fee_currency / renewal_notice_days
cache_ttl_seconds / deletion_requirement
source_sha256
status: pending | approved | rejected
approved_by / approved_at / created_at / updated_at
```

`bible_books`

```text
translation_id FK
book_id                 # USFM: GEN, EXO, JHN 등
canonical_korean_name
aliases_json
canonical_order
chapter_count
PRIMARY KEY (translation_id, book_id)
```

`bible_verses` — 로컬 승인을 받은 판본에만 사용

```text
translation_id FK
book_id
chapter
verse
text_exact
source_locator
PRIMARY KEY (translation_id, book_id, chapter, verse)
```

API 판본을 쓰면 계약의 캐시·FUMS·출처표시 조건을 구현한 별도 adapter를 사용하며, 위 테이블에 무기한 복제하지 않는다.

### 14.3 설교와 자막

`sermons`

```text
id PK
slug UNIQUE nullable        # draft에서는 비어 있을 수 있고 발행 시 YYYY-MM-DD-고유문자6자리로 고정
slug_suffix UNIQUE NOT NULL # draft 생성 시 한 번 만든 읽기 쉬운 소문자·숫자 6자리
church_name             # 다사랑교회
youtube_url
youtube_video_id UNIQUE
sermon_title
sermon_date NOT NULL    # 주차 정본; 같은 날짜 여러 설교 허용, archive 표시·정렬에 쓰며 published_at과 별개
bible_translation_id FK
bible_reference_json
bible_reference_label
bible_text_snapshot     # 승인 조건이 영구 아카이브를 허용할 때만
bible_source_sha256
ai_summary
ai_summary_disclosure
created_at / updated_at
```

`sermon_transcripts`

```text
id PK
sermon_id FK
source_revision
language
track_id
provider
provider_version
source_mode: public_unofficial | manual_paste | manual_upload | sermon_notes |
             audio_transcription | youtube_oauth
manual_source_kind: youtube_visible_transcript | sermon_manuscript |
                    sermon_summary nullable
source_coverage: full_transcript | partial_notes
is_auto_generated
raw_transcript_text          # provider에서 가져온 불변 원본; source 조건에 따라 정리 가능
raw_transcript_sha256
raw_segment_map_json
confirmed_transcript_text    # 관리자 최종 확정본; source 조건에 따라 정리 가능
confirmed_transcript_sha256
status: imported | editing | correction_pending | confirmed
confirmed_revision_id nullable
confirmed_by / confirmed_at nullable
retention_mode: keep_private | delete_text_after_publish
fetched_at
UNIQUE (sermon_id, source_revision)
```

자막은 공개하지 않으며 AI 요약·문제 초안의 근거로만 쓴다. 다시 가져오기, provider 변경, 수동 source 교체는 기존 raw 행을 덮어쓰지 않고 새 `source_revision` 행을 만든다. 한 quiz set이 실제로 확정·분석한 transcript ID/checksum은 `quiz_sets`에 고정한다. YouTube 자막 재배포 조건을 별도로 확인해 필요하면 발행 후 원문 자막은 보존하지 않고 checksum과 파생 근거만 남기는 모드도 지원한다.

P5-07/P5-08의 현재 구현은 위 DB 표를 생성하지 않는 메모리 계약이다. `sourceRevision`·집계 `version`·current head, `imported | manual_edit | restored | merged` 작업 이력과 별도 confirmation·교정 제안·불변 결정 batch 배열을 사용한다. 아래 `kind: manual_edit | ai_proposal | merged | confirmed` 등은 전체 기능의 DB 설계 초안이며 현재 schema로 간주하지 않는다. 후속 저장 설계에서 최초 작업본·복원 출처·부모 revision·확정 기록·원자적 version 비교를 함께 매핑하고 migration을 검토해야 한다.

`transcript_revisions`

```text
id PK
sermon_transcript_id FK
parent_revision_id nullable
kind: manual_edit | ai_proposal | merged | confirmed
transcript_text
transcript_sha256
segment_map_json             # segment_id·start·duration 보존
created_by                   # Access 이메일 또는 system AI job
created_at
expires_at nullable          # 발행 후 source 보존 정책·초안 7일 정리에 따름
```

`transcript_correction_items`

```text
id PK
proposal_revision_id FK
segment_id
original_text
proposed_text
change_type
reason
confidence
risk_flags_json              # 성경 용어·숫자·부정·삭제 등
decision: pending | accepted | rejected
decided_by / decided_at nullable
```

AI 교정 제안은 `transcript_correction_items`에만 먼저 저장되며 작업본을 자동 변경하지 않는다. 수락·거절 결과를 적용할 때 별도 merged revision을 만든다. 발행 뒤 text를 삭제해야 하는 source라도 raw/confirmed checksum, provider metadata, 확정 관리자·시각과 발행 provenance는 유지한다.

`generation_jobs` — Workflow 화면 표시와 영구 작업 기록의 정본

```text
id PK                         # API가 반환하는 jobId
quiz_set_id FK
workflow_instance_id UNIQUE
input_revision
idempotency_key UNIQUE
status: queued | fetching_transcript | awaiting_transcript_review | correcting_transcript |
        analyzing_intent | awaiting_intent_review |
        generating_ai | placing_grid | final_audit |
        validating | review_ready | needs_revision | failed
current_step
progress_percent
attempt_count
ai_provider / ai_model / reasoning_effort
prompt_tokens / cached_input_tokens / reasoning_tokens / output_tokens
estimated_cost_usd_before
calculated_cost_usd_after
pricing_version
error_code / error_message_safe
error_fingerprint nullable
diagnostic_json_safe nullable     # redacted metadata·timeline·shape·stack 상위 frame
deploy_version nullable
started_by
started_at / updated_at / completed_at
```

AI 응답 전문이나 자막 전문을 오류 필드에 복사하지 않는다. 결과물은 기존 `sermons`, `sermon_transcripts`, `quiz_variants`, `quiz_entries_public`, `quiz_solutions`에 저장하고 이 테이블에는 진행·연결 정보만 둔다. 같은 설교와 `input_revision`에 활성 작업이 둘 이상 생기지 않도록 unique 조건 또는 트랜잭션 검사를 둔다.

`generation_job_events` — 관리자 기술 정보 timeline

```text
id PK
generation_job_id FK
attempt_number
step
level: info | warning | error
event_code
message_safe
metadata_json_safe nullable
elapsed_ms nullable
created_at
```

`metadata_json_safe`는 allowlist serializer를 통과한 값만 저장한다. 임의 request/response header와 body를 그대로 직렬화하지 않는다. 이 event는 장애 분석용이며 공개 API에 노출하지 않는다.

`attempt_count`는 과거 시도·같은 요청의 재전송과 관리자 수동 재생성을 구분해 해석할 수 있게 event 기록과 함께 쓴다. 신규 AI 호출은 자동 재시도하지 않는다. 공개 자막 가져오기의 기존 유한 재시도는 AI 재호출과 구별한다. 관리자 수동 재생성은 새 `input_revision`과 새 job을 만들며 누적 횟수로 차단하지 않는다. 비용은 공급자 usage 응답과 해당 `pricing_version`으로 계산한 추정치이며 청구서와 소수점 차이가 날 수 있음을 화면에 표시한다.

`ai_usage_events` — 주간 누적 비용 상세의 정본

```text
id PK
quiz_set_id FK
generation_job_id FK nullable
revision_id FK nullable
provider
model
purpose: transcription | transcript_correction | intent | critique | summary | child | adult |
         single_entry | final_audit
input_tokens / cached_input_tokens / reasoning_tokens / output_tokens nullable
audio_input_tokens nullable
audio_seconds nullable
pricing_version
estimated_cost_usd
provider_request_id nullable
created_at
```

건별 event는 성공한 provider usage를 기준으로 한 번만 기록하고 idempotency key로 중복 합산을 막는다. `이번 주 AI 예상 비용`은 `quiz_set_id`로 합산하며 모델·purpose별 group 결과도 함께 반환한다. 관리자 drawer 이외의 공개 API에는 노출하지 않는다.

`ai_draft_revisions` — 관리자 비교·부분 재생성·복원의 정본

```text
id PK
quiz_set_id FK
generation_job_id FK
parent_revision_id FK nullable
revision_number
scope: all | intent | summary | child | adult | single_entry | final_audit
draft_label nullable            # 관리자가 붙이는 초안 이름
admin_guidance                 # 공개 안 되는 선택 입력
intent_analysis_json
summary_text
child_candidates_json
adult_candidates_json
variant_settings_json          # 난이도별 grid_size, 목표 단어 수, 잠금/제외 후보
layout_candidates_json         # 비교할 배치 결과와 검증 report
evidence_map_json              # timestamp, 짧은 근거, 확인 필요 상태
uncertainties_json
confirmed_transcript_id FK
confirmed_transcript_sha256
is_current
purge_after                  # 발행+7일 또는 미발행 마지막 활동+7일
created_by / created_at / updated_at
UNIQUE (quiz_set_id, revision_number)
```

새 revision은 변경 대상 외의 승인된 부분을 부모 revision에서 명시적으로 복사해 완전한 snapshot으로 저장한다. 복원도 과거 행을 수정하지 않고 선택한 snapshot을 부모로 하는 새 revision을 만든다. transcript는 여기에서 중복하지 않고 `sermon_transcripts`를 참조한다. 공개 API는 이 테이블을 직접 읽지 않으며, 발행 시 선택된 현재 revision에서 검증된 요약·문제를 공개용/정답용 테이블로 복사하고 최소 provenance를 정식 발행 기록(P5-54의 `published_quiz_content`)에 snapshot한 뒤 모든 revision을 삭제 가능하게 한다.

`ai_revision_reviews` — 첫 실제 설교 품질 시험과 revision별 관리자 평가

```text
id PK
ai_draft_revision_id FK
scope: intent | summary | child | adult | layout | final_audit
status: good | edited_then_use | regenerate
criteria_json                 # 중심 주제·예화 구분·적용·자막 밖 결론·반복 강조 등
admin_note nullable
edited_revision_id nullable     # edited_then_use일 때 실제 수정 revision FK
reviewed_by / reviewed_at
```

평가는 관리자 판단 기록이며 AI가 자기 결과에 점수를 매기지 않는다. 현재 선택된 scope가 `regenerate`이면 해당 scope 확정·발행을 막고 새 revision 생성 또는 사람 수정을 안내한다. `edited_then_use`는 실제 수정 revision과 연결되어야 한다.

### 14.4 주간 퀴즈

`quiz_sets`

```text
id PK
sermon_id UNIQUE FK
confirmed_transcript_id FK nullable
confirmed_transcript_sha256 nullable
status: draft | review_ready | needs_revision | published | archived
submission_state: open | paused
submissions_paused_at nullable
submissions_paused_reason nullable
published_from_revision_number nullable
published_ai_provenance_json nullable
published_at
opens_at nullable
closes_at nullable
archived_at
created_by / created_at / updated_at
```

P5-54의 실제 신규 발행 저장은 0018 `published_quiz_content`를 사용한다. 위 개념 필드 `published_ai_provenance_json`의 역할을 분리한 정식 표이며 초안 FK는 없다.

```text
quiz_set_id PK FK quiz_sets (delete restrict)
slug UNIQUE / title / sermon_date / church_name
bible_reference_label / translation / bible_reading_url
summary / disclosure
source_sha256 / input_version / content_event_count
metadata_revision / selection_revision
request_key UNIQUE / ticket_fingerprint / generation_job_id (FK 아님)
provenance_json / published_by_digest / published_at
```

snapshot은 update/delete 불변이다. insert 시 현재 봉인 ticket·검수/선택/metadata/input·최신 완료 full 작업·두 유효 variant/정답의 존재를 검사한다. published 전이는 snapshot과 시작 시각의 일치를 요구한다. 발행 service는 기존 정식 문제/정답 표 및 상태·featured를 동일 batch에 쓴다. `generation_job_id`는 추적용 문자열이고 초안 제거가 발행 기록을 cascade하지 않는다. 기존 행 backfill/삭제나 기존 trigger 재작성은 없다. `provenance_json`은 호출별 관측 비용/모델/입력 fingerprint와 발행 당시 코드 계약을 보존한다. 옛 호출에 미기록된 prompt/schema version은 명시적 null이다.

`quiz_variants`

```text
id PK
quiz_set_id FK
difficulty: child | adult
revision
lifecycle_status: active | superseded | withdrawn
results_status: valid | invalidated | non_ranked_correction
replaces_variant_id FK nullable
corrects_variant_id FK nullable
lifecycle_reason nullable
lifecycle_changed_at nullable
grid_size               # 난이도별 5~10, 기본 5
public_grid_json         # 활성/막힘, 번호, entry 연결; 글자 없음
word_count
active_cell_count
intersection_count
winner_count            # 기본 3, 허용 범위 1~10
validation_report_json
desktop_background_path
mobile_background_path
created_at
UNIQUE (quiz_set_id, difficulty, revision)
```

한 세트·난이도에는 `active` variant가 최대 하나만 존재하도록 트랜잭션 검사와 부분 unique index로 보장한다. `superseded` variant의 제출·정답은 삭제하지 않지만 일반 공개 repository, 아카이브 목록, 참여 현황 집계, Top N snapshot과 출력 query가 기본적으로 제외한다. 해당 제출자 확인 endpoint와 관리자 감사 화면만 명시적으로 조회할 수 있다. 마감 후 정정 variant는 `active + non_ranked_correction`으로 공개 풀이·채점만 제공하고, 기존 오류 variant는 `superseded + invalidated`로 보존한다. Top N·참여 query는 `results_status = valid`인 variant만 집계한다.

`quiz_entries_public`

```text
id PK
quiz_variant_id FK
number
direction: across | down
start_row / start_col
length
clue
transcript_evidence_json
display_order
```

`quiz_solutions` — 서버 전용

```text
quiz_variant_id PK/FK
canonical_cell_order_json
solution_cells_json
entry_answers_json
solution_sha256
```

일반 퀴즈 조회 repository는 `quiz_solutions`에 접근하는 메서드를 노출하지 않는다. 정답은 초기 HTML, JavaScript bundle, 정적 JSON, 제출 전 퀴즈 API에 들어가지 않는다. 채점과 제출 완료 세션의 정답보기 endpoint만 서버에서 이 테이블을 읽는다.

`site_state`

```text
key PK                  # featured_quiz_set_id 등
value
updated_at
```

`featured_quiz_set_id`는 메인 최상단에서 소개할 최신 세트만 가리킨다. 신규 제출 가능 여부의 정본으로 site state를 사용하지 않는다. 각 세트가 자신의 `status = published`, `submission_state = open`, `opens_at <= now < closes_at` 조건을 충족하는지 서버에서 검사하므로 여러 세트가 동시에 제출을 받을 수 있다.

새 주 발행은 새 세트를 published로 만들고 `featured_quiz_set_id`만 새 세트로 바꾼다. 이전 published 세트는 자기 `closes_at`까지 그대로 유지한다. 첫 제출 전 featured 발행을 취소하면 다음으로 최신인 열린 published 세트를 featured로 선택하고, 없으면 최근 archived 세트를 읽기 전용으로 보여줄 수 있다. archived 퀴즈의 정답·참여 현황·확정 Top N·출력은 세션 조건 없이 공개하며 기록 없는 채점 결과만 요청 시 계산한다.

각 세트의 `closes_at` 기반 archive 전환에서는 난이도별 `winner_count`와 그 시점의 완전 정답자 제출 순위를 `leaderboard_snapshots`에 함께 고정한다. 새 퀴즈 발행은 이 전환을 대신하지 않는다. 이후 신규 제출은 받지 않으므로 순위가 늘어나지 않는다. 개인정보 삭제·관리자 숨김이 발생하면 해당 snapshot 구성원은 화면과 출력에서 제거하되 다음 사람을 승격해 확정 순위를 다시 쓰지 않는다.

### 14.5 익명 세션과 제출

`anonymous_sessions`

```text
session_hash PK
created_at
last_seen_at
expires_at
```

`submissions`

```text
id PK
quiz_variant_id FK
quiz_revision
session_hash FK
idempotency_key
request_hash
display_name
comment
answers_json             # 정규화된 실제 제출 셀; 빈칸 포함 canonical order로 복원 가능
correctness_mask
correct_cells
total_cells
correct_words
total_words
score_basis_points
is_fully_correct
status: visible | hidden | deleted
submitted_at
hidden_at / deleted_at
UNIQUE (quiz_variant_id, session_hash)
UNIQUE (quiz_variant_id, session_hash, idempotency_key)
```

`answers_json`은 참여 현황판에서 실제 제출 답안을 재현하기 위해 저장한다. `correctness_mask`는 `canonical_cell_order_json`과 같은 순서의 boolean/bit mask다. `is_fully_correct`는 `correct_cells = total_cells`일 때만 true이며 Top N 후보 필터에 사용한다. 삭제 시 `answers_json`, 이름, 코멘트를 제거하되 중복 제출을 막는 행은 tombstone으로 유지한다.

`leaderboard_snapshots` / `leaderboard_snapshot_entries`

```text
leaderboard_snapshots:
  id PK
  quiz_variant_id UNIQUE FK
  winner_count
  finalized_at

leaderboard_snapshot_entries:
  snapshot_id FK
  rank
  submission_id FK
  PRIMARY KEY (snapshot_id, rank)
  UNIQUE (snapshot_id, submission_id)
```

snapshot은 archive 순간의 순위 구성만 고정하고 이름·답안을 중복 복사하지 않는다. 화면과 출력은 현재 visible한 submission과 join하므로 이후 본인 삭제·관리자 숨김을 즉시 반영한다. 제거된 순위는 비어 있을 수 있으며 차순위자를 자동 승격하지 않는다.

`privacy_requests`

```text
id PK                         # 클라이언트 requestKey UUID; 중복 접수 방지
lookup_token_hash UNIQUE       # 원본 조회 token은 저장하지 않음
request_hash                  # 같은 requestKey의 문의 내용 일치 확인
request_type: delete_submission | privacy_question
quiz_slug nullable
submitted_name nullable
message
status: received | reviewing | resolved | rejected
admin_response nullable
resolved_by nullable
created_at / updated_at
resolved_at nullable
purge_after nullable
```

- 개인 이메일·전화번호·첨부파일은 수집하지 않는다.
- 원본 조회 token은 접수 성공 응답과 브라우저에만 둔다. 같은 requestKey·내용의 재시도에는 동일 token을 복구해 반환하며 별도 서버 token 사본을 만들지 않는다.
- 사용자 화면에서는 lookup token을 `접수번호`라고 부른다. 단순 순번은 쓰지 않으며, 충분한 엔트로피의 무작위 값을 URL-safe 형식으로 발급한다.
- 상태 조회 API는 token을 hash한 뒤 `lookup_token_hash`와 비교한다. 일치할 때만 상태와 관리자 답변을 반환하며, 이름·답안 전체 같은 불필요한 개인정보는 조회 응답에 넣지 않는다.
- 해결된 문의 내용은 운영상 필요한 짧은 기간 뒤 삭제하고, 집계용 비식별 상태만 남길 수 있다. 구체적 기간·정리 실행은 P8-01 운영/Cron 범위에서 확정하며 0037은 임의 기간이나 자동 삭제를 넣지 않는다.
- 0037은 위 필수 문의 표와 인덱스만 추가한다. 기존 제출·익명 세션·감사·유료 생성 자료를 옮기거나 수정하지 않는다.

### 14.6 필터와 감사 로그

`reserved_names`

```text
id PK
protected_group_id nullable     # 실제 인물 하나와 여러 alias를 묶음
display_label
normalized_value UNIQUE
category: church | role | person | alias
enabled
created_by / created_at / updated_at
```

실제 인물의 이름·직함 결합은 `protected_group_id`로 묶고 관리자 화면에서 원문과 정규화 결과를 함께 미리본다. 짧은 일반 이름 전체에 fuzzy match를 적용하지 않으며, 변형은 명시적으로 추가한다. 회원 인증이 없는 동안 예약 이름은 실제 당사자를 포함한 모든 공개 제출자에게 동일하게 적용한다.

`moderation_terms`

```text
id PK
scope: name | comment | answer | all
normalized_pattern
match_mode: exact | contains
enabled
created_by / created_at / updated_at
```

`moderation_exceptions`

```text
id PK
scope: name | comment | answer
normalized_value UNIQUE
reason
enabled
created_by / created_at / updated_at
```

예외는 exact match만 허용하고 contains 예외로 전체 금지 규칙을 우회하지 못하게 한다.

`moderation_actions`

```text
id PK
submission_id FK
action: hide | unhide | delete
actor_email
reason
created_at
```

`audit_logs`

```text
id PK
entity_type / entity_id
action
actor_type: access_admin | self_service | system
actor_email nullable            # access_admin일 때만 검증된 이메일 필수
safe_metadata_json
created_at
```

감사 로그에는 세션 토큰, 원문 답안, Turnstile token, 전체 자막, IP를 복사하지 않는다. `0005_phase4_audit_logs.sql`은 이 범용 경계를 추가한다. 관리자 즉시 마감은 검증된 Access 이메일·사유·이전 마감 시각만 safe metadata로 같은 finalization batch에 기록한다. 본인 삭제는 actor type `self_service`, email null, variant ID/revision/삭제 시각만 최초 개인정보 제거 batch에 기록한다. 최종 tombstone purge는 actor type `system`, email null, 종료 경계와 원본 삭제 audit ID·variant/revision/삭제 시각만 기록한다.

`0006_phase4_submission_moderation.sql`은 submission FK, `hide | unhide | delete`, Access 이메일·사유·시각을 가진 `moderation_actions`를 추가한다. 관리자 delete의 manifest 원본은 Access 감사가 아니라 같은 batch의 PII-free `system` 표식이며, manifest의 `deletionSource`가 본인 삭제와 관리자 삭제를 구분한다. 최종 purge에서는 submission FK를 먼저 해제하도록 moderation action과 대상의 `access_admin` 감사를 제거하고 PII-free 표식과 purge 감사만 남긴다.

### 14.7 백업·사용량 운영 데이터

0038의 실제 구현은 다음4개 표다. 원격 적용 여부는 STATUS를 따른다. 기존0000~0037과 원문/유료 결과는 변경하지 않는다.

| 표 | 필드·제약 |
|---|---|
| `backup_runs` | id PK, environment local/preview/production, kind weekly/pre_migration/manual/deletion_manifest, private r2_object_key UNIQUE nullable, status queued/running/verified/failed/rotated, size_bytes·sha256·source_d1_bookmark·안전 error_code·started_at/completed_at/rotated_at. verified/rotated는 key·양수size·64자SHA·completed 필수, 같은환경running 1개 |
| `service_usage_snapshots` | id PK, service/scope/scope_id, period_start/end, allowlist metrics_json, source app_events/cloudflare_graphql/provider_api/configured, fetched_at·안전 error_code. 서비스/scope/id/기간 UNIQUE. 추세 cache31일만 정리 |
| `pricing_catalog` | service PK, plan_name·currency USD·free_limits_json·official_source_url·pricing_version·pricing_checked_at·updated_at·갱신 lease ID/만료. 50/80% 기준은 서비스 함수 정본 |
| `monthly_operations_checks` | 한국시간 year_month PK, pricing_versions_json·checked_services_json·checked_by·checked_at. 공개 DTO에서 이메일 제외 |

사용량 값은 count·bytes·추정cost·미확인null만 받는다. API token, 공급자 개인 응답/청구서, 참여자 데이터, SQL/object key/다운로드 URL을 사용량 snapshot과 공개 응답에 넣지 않는다. OpenAI는 기존 ai_usage_observations/ai_usage_events의 당시 가격표 관측을 조회하며 새 호출·원장 정리·가격 재계산을 하지 않는다. 원래 AI 원장을31일 cache 정리와 혼동하지 않는다. [운영 동작](architecture.md#p8-01-로컬-운영-구현과-활성화-경계).

### 14.8 필수 인덱스·무결성

- 메인 소개 lookup: `site_state(featured_quiz_set_id)`
- 진행 중·마감 대상 lookup: `quiz_sets(status, submission_state, closes_at)`
- 활성 variant 단일성: 난이도별 `quiz_variants(quiz_set_id, difficulty) WHERE lifecycle_status = 'active'` unique
- 순위·참여 집계: `quiz_variants(results_status)`가 `valid`인 variant만 포함
- 오류 대체 계보: `quiz_variants(replaces_variant_id)`
- 아카이브 상태 lookup: `quiz_sets(status, id DESC)`
- 아카이브 설교일 정렬·필터: `sermons(sermon_date DESC, id DESC)`
- 아카이브 제목·장절 부분 검색은 현재 주간 규모에서 D1 `LIKE` query를 사용하고 별도 FTS index는 만들지 않는다. 데이터가 수천 건 이상으로 늘고 측정상 느릴 때만 FTS5를 검토한다.
- 공개 기록: `submissions(quiz_variant_id, status, submitted_at, id)`
- Top N: `submissions(quiz_variant_id, status, is_fully_correct, submitted_at, id)`
- 관리자 moderation: `submissions(status, submitted_at DESC)`
- 모든 count는 0 이상이고 `correct <= total`인 CHECK
- difficulty, direction, status는 CHECK constraint
- published·archived 세트는 `opens_at`, `closes_at`이 필수이고 `closes_at > opens_at`; draft·review 상태에서만 nullable 허용
- variant revision 불일치 제출은 저장 전 차단

## P5-48 저장 호환 기준

[생성 연결 계약](generation.md#간결한-생성-결과의-연결-계약)의 새 교정 문서는 기존 proposal event/chunk와 결과·usage 참조를 재사용한다. P5-49 로컬 경로는 payload의 `correction_document_v1` 구분과 과거 `items` 해석을 분리하고, 원래 proposal을 참조하는 merge 수정본으로 채택한다. 이는 실제 provider/Workflow·운영 DB 연결의 완료를 뜻하지 않는다.

위 `transcript_correction_items`·`final_audit` 관련 표/enum은 옛 설계·이력 호환을 포함한다. 새 결과에 이유/confidence/항목별 decision이나 감사 결과를 억지로 만들지 않는다. 기존 행·참조·관측 비용과 원래 contract version은 보존하며 자동 변환/삭제하지 않는다. P5-50의 0014부터 신규 full v3 finish는 실제 최종 코드 검사 증거를 요구하며 옛 계약의 감사/차단 규칙은 보존한다. 현재 구현 경계는 [생성 연결 계약](generation.md#간결한-생성-결과의-연결-계약)을 따른다.

P5-53의 0017은 기존 generation_jobs의 active unique index 조건과 신규 공존 guard 두 개만 변경/추가한다. full v3가 running/content_review이고 열린 호출/명령이 없을 때 같은 설교/퀴즈의 summary/child/adult v2 작업 하나를 허용한다. 다른 동시 실행과 부분 작업 실행 중 full의 다음 단계/완료 전환은 거부한다. 기존 61개 표/행·BLOB·trigger·usage·완료 증거는 보존하며 backfill·표 재생성·원격 적용은 하지 않는다. [보존 검사](../work/P5-53.md).

## P5-57 초안 본문 정리 저장 경계

0021은 기존 표를 재생성하지 않고 `draft_cleanup_records`(설교 ID, 정리/만료 시각, 입력·콘텐츠·옛 이력·metadata revision, 기준 fingerprint, 본문 없는 source 정보와 제거할 본문 ID 목록)와 `draft_activity`(앞으로의 metadata 저장 시각)를 추가한다. 정리 기록은 불변이다. 삭제 guard 여섯 개는 해당 정리 기록이 허용한 본문 chunk만 제거하도록 좁게 확장하며 기존 identity·외래 키·usage·발행 snapshot guard는 유지한다.

정리 후 원래 본문의 길이·checksum·revision metadata는 삭제된 본문의 provenance다. 새 정리 표식 없이 불완전한 본문을 정상 자료로 해석하지 않는다. 새 초안 쓰기와 본문 재삽입을 막고 관리자 API에서 명시적 만료를 안내한다. `delete_text_after_publish`의 native source 본문은 빈 문자열(기존 confirmed NOT NULL 계약 유지)로, 시간별 본문 배열은 null로 비운다. checksum·provider·확정자·확정 시각은 유지한다. 기존 행에 대한 실제 적용은 하지 않았다. [정책과 범위](generation.md#p5-57-로컬-초안-정리-연결).

### P5-58 발행 표시 정정 저장

`published_display_corrections`(0022)는 `(quiz_set_id, revision)` 기본키·세트별 request_key 고유키를 갖는다. before_title/before_sermon_date·title/sermon_date·reason·actor_digest·created_at을 보존하며 quiz_sets만 restrict 참조한다. 초안 FK·TTL은 없다. update/delete를 차단하고 insert는 공개 상태·직전 번호·기존 표시값·실제 변경을 확인한다. Access 감사는 같은 batch에 저장한다. 기존 published_quiz_content·문제/정답은 수정하지 않는다. [정책](generation.md#p5-58-로컬-발행-정보-정정) · [API](api.md).

### P5-59 철회와 새 검수 시작 자료

0023의 `quiz_withdrawals`는 quiz_set FK만 갖는 불변 기록이다. 요청 key, 원래 발행 시각, 출발 표시 정정 번호, 새 검수 revision 번호(기존 variant 최대 revision + 1), 정식 자료에서 복사한 비공개 review JSON, 사유, 관리자 digest, 철회 시각을 보관한다. 원본 snapshot/정정/문제/정답 표는 수정·삭제하지 않는다. 기존 migration/trigger를 재작성하지 않으며 backfill도 없다.

삽입 guard는 모든 variant의 제출 부재·마감 전 published·정정 번호·두 유효 active variant와 정답/단서의 완전성을 확인한다. 적용 trigger는 review_ready/withdrawn·featured만 전환하고 service가 Access 감사를 같은 batch로 추가한다. 과거 발행 요청으로 되돌리는 상태 전환은 별도 guard로 거부한다. 새 revision 발행은 아래 0026의 별도 증거 경로를 사용한다. [정책](generation.md#p5-59-로컬-첫-제출-전-발행-철회) · [검사](../work/P5-59.md).

### P5-60 철회본 편집 이력 저장

0024의 `withdrawal_edit_revisions`는 `(quiz_set_id, revision)` 기본키, 세트별 request_key 고유키와 원본 quiz_withdrawals restrict FK를 갖는다. 원본 reviewRevision, 정규화 요청 SHA, 누적 답·단서 edits JSON, 관리자 digest·서버 시각을 저장한다. 최초 발행/철회/문제/정답/비용 표를 수정하거나 재생성하지 않는다.

삽입 guard는 현재 review_ready + paused·원본 검수 번호·연속 편집 번호·모든 variant withdrawn·전체 revision 제출 부재와 대상 문제의 원본 소속을 확인한다. update/delete를 차단하고 서비스는 새 이력과 본문 없는 감사를 원자 저장한다. 지금 저장되는 것은 미발행 편집 초안이며 영구 공개 아카이브가 아니다. 0025에서 현재 철회 편집 작업의 7일 정리를 아래와 같이 연결했다. [현재 구현·검사](../work/P5-60.md).

### P5-60 철회 편집 본문 정리

0025의 `withdrawal_edit_cleanup`는 quiz_set 키·최종 editRevision·마지막 저장/기한/정리 시각·revision별 본문 SHA JSON만 보관한다. migration은 기존 행/본문을 바꾸지 않는다. 실제 정리 insert guard는 마지막 저장+정확히 7일, 현재 편집 head·철회 상태·전체 revision 제출 부재·유효한 호출 lease 부재·전체 revision의 해시 manifest를 확인한다.

marker 삽입 뒤 trigger가 `edits_json`만 빈 배열로 바꾸며, 서비스의 본문 없는 system 감사와 같은 batch에서 확정한다. 기존 `withdrawal_edits_update` 하나만 marker가 있는 정확한 본문 비우기를 허용하도록 확장했다. 모든 identity/request SHA/actor/시각 변경·행 삭제·본문 재삽입·만료 후 새 저장은 계속 차단한다. 정리 marker와 해시도 불변이다. 읽기 후 새 편집/상태 변화 또는 감사 실패는 전체 취소한다. [검사 기록](../work/P5-60.md).


### P5-60 반복 편집과 영구 재발행

0026은 기존 행을 backfill하지 않고 네 표와 활동 조회 view를 추가한다.

- `quiz_revision_sessions`: 세트별 연속 cycle, 시작/철회 종류, 새 문제 revision, 출발 발행/정정 번호, 영구 철회 시작 자료, 요청/관리자 SHA·사유·시각. 최초 철회 행을 보존하며 만료 뒤 새 시작과 반복 철회를 구별한다.
- `quiz_revision_drafts`: 주기별 연속 revision, 요청 key/SHA·관리자 digest·종류·본문 SHA·시각, content/layouts/reviewed snapshot. 저장/배치 변경은 검토를 무효화하고 review는 같은 내용/배치에 한 영역 확인만 추가한다.
- `quiz_republications`: 주기당 한 영구 공개 snapshot. 기존 slug, 제목/설교일/교회명/장절/판본/링크/요약/고지, 현재 검토 번호/본문 SHA, 요청/관리자 SHA, variant revision, 출발 정정 번호, 발행/마감 시각. 초기 published_quiz_content를 변경하지 않고 새 quiz_variants/entries/solutions와 연결한다.
- `quiz_revision_cleanup`: 주기별 최종 head, 기한/정리 시각, 본문 SHA 목록과 이전 답·단서 편집 SHA. 본문만 JSON null로 비우고 식별·검토 종류·시각·해시를 보존한다. 초기 편집 이력은 기존 0025 표식으로 비운다.

기존 네 guard(`quiz_withdrawals_no_republish`, `published_quiz_set_transition`, `published_display_insert_guard`, `withdrawal_cleanup_insert`)만 새 증거를 확인하는 조건으로 확장한다. 다른 기존 trigger와 0000~0025 파일을 보존한다. 신규 guard는 최신 주기/head·전체 제출 부재·검토·공개/정답 완전성·동시 정정/정리와 감사 rollback을 확인한다. 기존 편집 API는 새 주기 뒤 경쟁 head를 만들 수 없다.

공개·archive reader는 최신 재발행 snapshot의 허용된 공개 열과 그 이후 표시 정정만 읽는다. 정답/근거/관리자/초안은 공개 serialization에 포함하지 않는다. 동일 설교의 최신 활동/재발행+7일에 새 편집 주기들과 아직 남은 초기 생성 초안의 정리를 같은 batch로 확정한다. 영구 snapshot·옛 variant·문제/정답·철회·참여/순위·비용은 정리 대상이 아니다. [검사](../work/P5-60.md).

### P5-61 오류 처리 저장과 보존

[0027](../../migrations/0027_phase5_problem_corrections.sql)은 기존 행을 backfill/재작성하지 않고 다음 표를 추가한다.

- `quiz_problem_cases`: 세트별 연속 주기, 불변 원본 두 문제/정답 snapshot, 오류 난이도, 다음 문제 revision, 표시 정정 번호·기존 마감·공개 안내·사유·요청/관리자 digest·시각. 첫 성공 제출 이력을 확인하고 insert와 동시에 세트 접수를 중지한다.
- `quiz_problem_drafts`: 주기별 연속 편집/배치/사람 검토 이력. 같은 요청 재생과 최신 head 조건, 검토 이전 내용/배치 동일성, 정리/완료 후 쓰기 금지를 검사한다.
- `quiz_problem_outcomes`: 주기당 단일 publish/cancel 결과, 요청/관리자 digest·검토본 SHA·표시 내용 snapshot·마감 후 여부·시각. publish는 새 문제/정답과 검토본 정합성 및 오류본 수명 전이를 확인한다. 결과와 감사는 같은 batch다.
- `quiz_problem_cleanup`: 최종 편집 head·본문 SHA 목록·정리 시각. 마지막 활동+7일·현재 lease와 경합을 검사해 편집 `body_json`만 `null`로 비운다. 나머지 식별·SHA·원본·발행·결과 자료는 불변이다.

`quiz_content_versions` view는 P5-60 재발행과 P5-61 수정본의 영구 표시 snapshot을 합친다. 공개/아카이브/관리자/다음 오류 처리에서 가장 최신 문제 revision과 그 이후 표시 정정을 읽는다. 최초 `published_quiz_content` 및 과거 snapshot은 그대로다. 기존 trigger는 `published_display_insert_guard` 하나만 이 view를 보도록 확장하며 철회·발행·제출 보호 조건은 완화하지 않는다.

실제 기존 variant schema는 `lifecycle_reason`·`lifecycle_changed_at`이다. 이전 명세의 `status_reason`·개별 superseded/withdrawn 시각 이름을 실제 schema에 맞춰 바로잡았다. 오류본 `replaces_variant_id` 계보와 마감 후 `corrects_variant_id`를 새 variant에 기록하며, 영향 없는 난이도·옛 entries/solutions·submissions·leaderboard snapshots/entries·비용을 보존한다.

### P5-62 일반 문구 정정 저장

[0028](../../migrations/0028_phase5_wording_corrections.sql)의 `published_wording_corrections`는 세트별 정정 번호/요청 key·콘텐츠 버전·대상·수정 전후·사람 확인·사유·관리자 digest·시각을 보존한다. quiz_sets만 restrict 참조하며 초안 FK·본문 정리는 없다. UPDATE/DELETE를 차단하고 현재 문구·소속·버전·연속 번호·공개 상태·미완료 오류 처리 부재를 insert 순간 검사한다. 별도 Access 감사와 원자 저장하며 이전 표/trigger를 수정하거나 backfill하지 않는다.

`quiz_wording_current` view는 영구 콘텐츠의 요약과 active 문제의 단서에 해당 표시 이력을 적용한다. 요약은 현재 콘텐츠 revision, 단서는 exact entry ID를 조건으로 삼는다. 공개 조회와 다음 철회/오류 처리 원본 캡처가 이 view를 재사용한다. 반복 철회에서 먼저 읽은 편집 본문과 commit 시 복사 자료가 달라지는 경합도 source 일치 검사로 거부한다. 기존 오류본 정답·답안/성적·순위·비용과 과거 snapshot은 수정하지 않는다. [검사](../work/P5-62.md).

### P5-63 일반 마감 변경 저장

새 migration·테이블·trigger 변경 없이 기존 `quiz_sets`와 `audit_logs`를 재사용한다. 일반 미래 변경은 현재 상태 전체를 대조하는 조건부 감사 insert와 `closes_at/updated_at` 변경을 같은 D1 batch로 저장한다. 조건이 달라져 감사의 필수 entity ID를 얻지 못하면 제약 실패로 batch 전체가 rollback한다. 감사 ID는 요청 UUID에 `deadline-` 접두사를 붙이고 `deadline_changed`에 이전/요청/실제 마감·사유·즉시 여부·당시 제출 수·요청 hash를 기록한다. 기존 감사 행은 수정하지 않는다.

과거/현재 요청은 같은 조건부 감사를 기존 `closeQuizSetNow` batch 선두에 포함하며 두 난이도 snapshot/순위·archive·기존 close_now 감사를 원자 확정한다. 기존 archived/시간상 마감 세트를 연장하지 않는다. 오류 원본의 captured closes_at은 불변으로 두고 현재 세트 마감만 바꾼다. 일반 변경은 문제/정답·발행 snapshot·variant/revision·제출·성적·기존 순위·비용·slug·featured·다른 세트를 변경하지 않는다. [검사](../work/P5-63.md).

### P5-66 공개 자막 원본의 기존 저장 경계

영상 미리보기는 D1에 쓰지 않는다. 관리자가 등록한 미발행 설교의 첫 공개 자막 취득만 기존 sermon_input_events/sermon_input_chunks와 head의 조건부 원본 저장을 사용한다. sourceMode public_unofficial, video ID, 언어·track·자동 여부·취득 시각·provider 버전, 원본 구간과 SHA를 보존하며 사람 확정은 별도 event다. 실패·중복·3만 자 초과는 새 원본을 만들지 않고 이전 입력자료를 덮어쓰지 않는다. 새 migration 없이 0000~0028을 유지한다. [관리자 흐름](generation.md#p5-66-공개-영상-정보자막-취득의-관리자-연결).


### P5-67 관리자 품질 평가 저장

위 `ai_revision_reviews`는 초기 개념 명칭이며 이번 실제 생성 계보에는 해당 테이블이 없다. migration 0029의 `sermon_content_quality_reviews`를 현재 연결된 정본으로 쓴다. `(sermon_id, snapshot_event_id, revision)` 불변 복합 키와 요청 UUID/해시, quiz set, scope, 평가 상태, 의도 항목 JSON, 비공개 관리자 메모, 실제 사람 edit snapshot ID, 관리자 digest/시각을 저장한다. 이전 평가를 고치거나 지우지 않고 같은 snapshot의 다음 revision을 추가한다. `edited_then_use`는 같은 snapshot의 사람 edit event가 있을 때만 허용한다. SQL guard는 원본 snapshot·scope·quiz set, 순차 revision과 edit 계보를 확인하며 최근 `regenerate` 평가 대상의 사람 confirm/review와 발행 snapshot 삽입을 막는다. 서비스는 동일 요청 재생·현재 권한/입력·버전과 명시 재개/최종 검사를 대조한다. 평가·메모는 관리자 읽기 응답에서만 제공하며 공개 문제·정답·archive serialization에 추가하지 않는다. 품질 평가 시각/건수는 미발행 설교 초안의 기존 7일 활동 기준과 정리 경합 fingerprint에 포함한다. 정리 표식 뒤에는 새 평가 삽입을 막고 평가 메타데이터/메모는 불변 검수 기록으로 남긴다. 원본·기존 AI 사용량·0000~0028은 변경하지 않는다. [관리자 흐름](generation.md#p5-67-근거-검수사람-의도-확정-연결).


## P5-70 보관 분석 복구 출처

0030 `generation_archived_intent_recoveries`는 source job별 유일한 불변 복구 기록이다. 원래 failed full v3의 rejected intent_analysis와 정산된 call/usage, 봉인된 step context, request/response/instructions SHA, 새 content payload SHA와 적용 actor/time을 연결한다. 0032에서 같은 표/저장 경로를 intent_critique에도 확장했고, 비판의 원래 분석 계보도 확인한다. 원래 AI job/outcome/call/usage/result link를 다시 쓰거나 성공으로 바꾸지 않는다.

새 분석은 기존 `sermon_content_events`의 AI origin 및 기존 payload/chunk/domain lineage/current 형식을 그대로 쓴다. 복구 기록→event FK는 **DEFERRABLE INITIALLY DEFERRED**로 0030 SQL에 명시한다(Drizzle 선언이 표현하지 못하는 기존 SQL 검토 방식). 동일 batch에서 기록을 먼저 넣고 분석을 봉인하며 commit 때 양쪽 존재를 요구한다. 기록의 update/delete를 금지한다. event 삽입 guard는 기존 정상/human 규칙을 유지하고 정확한 새 event/job/kind/payload/time이 맞는 복구 기록에만 별도 입구를 허용한다.

기록 삽입 시 원래 실패/정산·현재 input/content head·metadata/selection revision·미발행 quiz·cleanup/동시 실행 여부를 원자 검사한다. 후속 조회는 payload와 출처 지문/정산 증거를 다시 검증한다. 기존 초안 본문 보존/정리 정책을 바꾸지 않으며 ID/지문/원래 비용 기록은 유지한다. 복구 출처 도입 시 0000~0029 SQL/snapshot을 보존하고 journal에 0030을 추가했다. 실제 시험/Preview/Production 적용은 구현 검사와 구분한다. [생성 계약](generation.md#p5-70-보관-분석의-별도-복구-저장).

후속 생성에는 기존 `generation_intent_analysis_reuse`를 사용한다. 0031은 `generation_intent_analysis_reuse_proof`, `lifecycle_full_v3_stage_advance`, `lifecycle_intent_wait` 세 trigger만 교체하는 custom migration이다. Drizzle 테이블 구조를 추가/변경하지 않으며 기존 0000~0030을 보존한다. full v3 새 요청·복구 출처·원래 failed 분석·현재 입력/metadata/선택 분석이 일치할 때만 재사용을 허용한다. 새 job의 분석 단계는 무료 전이 증거를 남기고 AI success/receipt를 만들지 않는다. 종료 검증은 원래 rejected call/usage와 복구 출처를 별도로 대조한다. [후속 생성 계약](generation.md#p5-70-복구-분석을-이용한-후속-생성).

0033은 기존 복구 삽입과 content event 삽입 trigger 두 개를 교체해 보관 요약도 같은 불변 출처 표로 저장한다. 분석/비판/요약 외 task를 허용하지 않으며 기존 failed job, rejected outcome, 원래 usage는 보존한다. 새 표는 없고 0000~0032는 보존한다.

0032는 복구 삽입·content event 삽입·재사용 증명·의도 검수 대기의 기존 trigger 네 개를 교체한다. 분석/비판의 출처와 현재 입력을 함께 검증한 요청만 새 유료 호출 없이 의도 검수로 진입한다. 새 표는 없고 0000~0031은 보존한다. 인용의 미확인 위치는 기존 content payload의 명시적 상태/null 좌표로 저장하며 원문·과거 payload를 재작성하지 않는다. [위치·비판 재사용 계약](generation.md#p5-70-근거-문자-위치는-프로그램이-계산).


## P5-71 비공개 요청·응답 전문 보관

0035의 `ai_response_archives`는 기존 `ai_provider_calls.id`에 연결된 `(call_id,kind)` 요청/응답 manifest다. state(assembling/sealed), HTTP status(응답만), byte 길이, chunk 개수, SHA256, 저장 시각을 기록한다. `ai_response_archive_chunks`는 같은 복합 키/순서에 64KiB 이하 BLOB을 저장한다. 기존 저장 계층의 64MiB 안전 예산을 사용하며 초과 시 자르지 않고 실패한다. 새 provider 결과 형식/품질 상한을 정한 것이 아니다.

요청 예약은 외부 전송 전에 완료해야 하고 기존 예약은 덮어쓰거나 재전송 근거로 사용하지 않는다. 응답은 파싱/채택 전에 보관한다. 읽기는 본문 전 크기/순서 확인, 바이트 hash 확인, 현재 manifest/정리 여부 재확인을 거친다. API key·요청/응답 헤더는 저장하지 않는다. 공개 serialization과 HTTP 다운로드 route에 연결하지 않는다.

이 보관은 Workflow 실행 이력의 보존 기간에 의존하지 않는다. 승인된 기존 7일 초안 정리가 수행되면 원문 chunk를 삭제하고 manifest/비용 원장을 보존한다. 정리 직전 비교값에 archive 상태/개수를 포함하고 정리 후 늦은 저장을 막는다. 이번 작업에서 실제 정리/Cron은 실행하지 않았다. 0035의 실제 Preview 적용 상태는 STATUS를 따른다.

## P5-71 표시용 내용·격자 사본

0036은 두 비공개 표시 표만 추가하며 기존 0000~0035 SQL·표·trigger를 변경하지 않는다. `generation_display_snapshots`는 `(sermon_id,event_id)`별 소유 quiz ID, 봉인 원본 payload fingerprint, 사본 SHA, materialized snapshot과 표시 의존 ID만 저장한다. 큰 before/after 도메인 봉투·원문·요청 헤더를 복사하지 않는다. operation은 표시 kind와 필요한 replacement만 저장하며 중복 분석/초안은 복사하지 않는다. 이전 큰 operation 사본도 SHA를 확인한 뒤 작은 표시 모양으로 읽을 수 있어 재준비가 필요 없다. `generation_display_finals`는 `(ticket_id,difficulty)`별 소유 설교/quiz ID, 원본 ticket fingerprint, 사본 SHA, ticket/공개 미리보기 머리말/난도별 관리자 격자를 저장한다. 격자의 정답·solution은 Access 전용이며 공개 응답에 연결하지 않는다.

기존 검증된 결과의 거래에 함께 넣고 동일 불변 원본에서 파생한 사본만 명시적으로 다시 준비할 수 있다. 사본 자체는 저장/발행 권한의 근거가 아니며 원본 변경·손상 검사는 쓰기 경로의 기존 reader가 수행한다. 조회는 사본 SHA/구조·원본 봉인/fingerprint·소유자·현재 head/metadata/품질을 확인한다. 사본 FK의 `ON DELETE CASCADE`는 기존 승인된 초안 정리가 원본을 삭제할 때 해당 사본도 제거한다. 이번 작업에서 실제 자료 정리는 하지 않는다. 사본은 D1에 있어 Workflow의 3일 완료 이력 보존이나 PC 재부팅에 의존하지 않는다.
