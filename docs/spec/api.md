> 현재 분야별 명세. 기존 implementation 15장 기준을 옮겼으며 구현 일지는 보관본으로 분리했다. 기존 데이터/이력과 API 호환 설계도 포함한다. 교정 items/AI 감사 관련 표·계약은 과거 구현 보존 대상이며 신규 제품 기능 요구가 아니다. 실제 구현은 코드/마이그레이션과 STATUS를 확인한다.
> [명세 목차](../../implementation.md) · [현재 상태](../STATUS.md) · [변경 전 원문](../archive/2026-09-21-p5-48/implementation.md#15-api-계약)

## 15. API 계약

### 15.1 공통 규칙

- base path: `/api`
- JSON request/response
- 상태 변경은 같은 Origin의 `application/json`만 허용
- 공통 오류에는 사람이 읽을 메시지, 안정적인 code, requestId를 넣는다.
- 내부 stack, SQL, 정답, 정확한 금지어는 응답하지 않는다.
- 공개 읽기 API도 필요한 필드만 allowlist한다.

### 15.2 공개·세션 API

```text
GET  /api/quizzes/latest?difficulty=child|adult
GET  /api/quizzes/:slug?difficulty=child|adult
POST /api/session
GET  /api/quizzes/:slug/:difficulty/board
GET  /api/quizzes/:slug/:difficulty/top-n-export
GET  /api/quizzes/:slug/:difficulty/export-data
GET  /api/quizzes/:slug/:difficulty/me
GET  /api/quizzes/:slug/:difficulty/solution
POST /api/quizzes/:slug/:difficulty/submissions
POST /api/quizzes/:slug/:difficulty/practice/check
DELETE /api/quizzes/:slug/:difficulty/me/submission
POST /api/privacy-requests
GET  /api/privacy-requests/:lookupToken
GET  /api/archive?cursor=...&q=...&year=YYYY&month=1..12&limit=12
```

`POST /api/session`은 정확한 서비스 Origin과 `application/json`, raw UTF-8 16KB 이하인 strict 빈 객체 `{}`만 받는다. 활성 cookie가 있으면 같은 session을 재사용하고, 없거나 변조·미등록·만료되었으면 180일 session을 새로 만든다. 성공은 `private, no-store` 응답의 `{data:{expiresAt}}`만 반환하며 token은 `__Host-bq_session` cookie로만 전달한다.

`GET /api/quizzes/:slug/:difficulty/me`는 현재 공개 가능한 exact quiz variant와 현재 브라우저의 활성 익명 session을 함께 검증하며 모든 응답을 `private, no-store`로 보낸다. cookie가 없거나 형식이 잘못됐거나 등록되지 않았거나 만료됐거나 해당 variant 제출이 없으면 새 session을 만들거나 만료를 연장하지 않고 `{data:{submission:null}}`을 반환한다. visible·hidden 제출은 소유자에게만 `status`, variant ID/revision, 저장 답안과 서버 결과를 반환하고 이름·코멘트·session hash·idempotency/request hash·moderation 상태는 반환하지 않는다. deleted 제출은 답안·정답 없이 variant ID/revision·삭제 시각의 tombstone만 반환한다. submitted 복원은 현재 공개 geometry와 서버 비공개 solution으로 저장 답안을 다시 채점해 답안·correctness mask·모든 집계·점수·완전 정답 여부가 저장값과 일치할 때만 성공하며, revision·solution·저장 점수가 어긋나면 내부 값을 숨긴 안정적인 503으로 닫는다. 브라우저는 이 조회가 실패하면 소유권을 모르는 상태에서 새 제출을 허용하지 않고 재시도를 제공한다. 현재 `/me`는 published/archived의 공개 active variant만 대상으로 하며, superseded 오류본의 소유자 접근은 P5-61의 별도 `problem-history` 경로로 연결했다.

`DELETE .../me/submission`은 same-origin `application/json`, raw UTF-8 16KB 이하의 strict 빈 객체 `{}`만 받는다. 현재 공개 가능한 exact variant와 active 익명 session을 검증한 뒤 visible·hidden 본인 제출의 이름·답안·코멘트를 제거하고 tombstone을 남긴다. 최초 상태 변경은 email 없는 `self_service_delete` 감사와 같은 D1 batch로 실행해 감사 insert 실패 시 session touch와 개인정보 제거도 rollback한다. 감사 insert는 exact visible/hidden 행에서만 조건부로 만들어 동시·반복 삭제에도 최초 감사 한 건과 최초 삭제 시각만 남긴다. 성공은 `private, no-store`의 `{data:{submission:{status:"deleted",quizVariantId,quizRevision,deletedAt}}}`만 반환한다. session 없음·만료는 `401 SESSION_REQUIRED`, exact variant 미제출은 `404 SUBMISSION_NOT_FOUND`다. tombstone은 재제출을 `ALREADY_SUBMITTED`로 막으며 archive 순간 자동 제거하지 않는다. 브라우저는 검증된 본인 결과에만 삭제 버튼을 표시하고 되돌릴 수 없음과 같은 퀴즈·난이도 재제출 불가를 확인한다. 실패에는 기존 결과를 유지하고, 검증된 성공 뒤에는 답안·정답·참여 현황과 브라우저 임시 답안을 제거해 tombstone 상태로 바꾼다. 최종 purge와 backup restore 경계는 D-024의 server-only service를 사용하며 실제 R2 저장·restore 실행은 Phase 8 runbook 범위다. `POST /api/privacy-requests`는 Turnstile과 속도 제한을 통과한 짧은 문의만 저장하고 lookup token을 반환한다.

퀴즈 GET 응답에는 다음만 포함한다.

- 설교 공개 메타데이터, 승인된 본문과 판본 표기
- AI 요약과 고지
- public grid, entry 위치·길이·단서
- revision, status, mode: `participation | practice`, 기록 제출 가능 여부
- `opensAt`, `closesAt`, 한국 시간 표시용 마감 label
- 난이도 이미지 경로
- 제출 수와 공개 정책 상태

`GET /api/quizzes/latest`는 featured 퀴즈와 함께 `otherOpenQuizzes` 요약 목록을 반환한다. 이 목록은 featured가 아닌 `published + open`이면서 `opens_at <= now < closes_at`인 세트만 포함하고, slug·설교 제목·설교일·성경 장절·마감 일시·난이도 존재 여부를 제공한다. 새 발행 때문에 기존 진행 중 퀴즈가 접근 불가능해지지 않게 하는 용도이며 정답이나 참여 답안은 포함하지 않는다.

현재 `published` 퀴즈의 공식 정답 음절과 entry answer는 초기 일반 퀴즈 응답에 포함하지 않는다. 이 상태의 `/solution`은 exact active variant에 visible 또는 hidden 본인 제출이 있는 활성 세션만 허용하고 미제출·deleted·만료·다른 variant 세션에는 `403 SUBMISSION_REQUIRED`를 반환한다. 제출 revision이 현재 variant와 다르거나 공개 geometry·canonical order·비공개 solution의 cell/entry 관계가 손상되면 정답을 추측해 내보내지 않고 `503 SOLUTION_UNAVAILABLE`로 닫는다. `archived` 상태의 `/solution`은 lazy finalization 뒤 세션 없이 공개한다. 성공 응답은 `private, no-store`이며 `{data:{quizVariantId,quizRevision,solution:{cells,entries}}}`만 반환하고 storage 전용 canonical order·checksum·관리자 정보는 제외한다. strict 브라우저 client는 same-origin credential·`no-store`·timeout/abort로 응답을 읽고 exact variant ID/revision, 공개 cell/entry ID 집합과 entry별 cell 조합까지 다시 검증한다. 진행 중 퀴즈는 즉시 제출 성공 응답을 바로 표시하고, 재방문은 `/me`로 확인한 저장 답안을 잠근 뒤 사용자가 `정답보기`를 선택했을 때 `/solution`과 저장 결과의 정답 일치를 확인해 같은 비교 화면을 복원한다. 미제출 화면의 진입점은 focus 가능한 `aria-disabled` 상태와 제출 후 안내만 제공한다. archived는 작성·session 여부와 관계없이 정답을 열 수 있고 현재 브라우저의 임시 입력 또는 모든 활성 셀 빈칸과 비교한다. `practice/check`는 archived active variant에서만 `{revision,cells}`를 받고 최소 한 칸의 sparse NFC 완성형 한글 답을 서버 메모리에서 채점한다. 성공은 `{data:{quizVariantId,quizRevision,correctCells,totalCells,correctWords,totalWords,scoreBasisPoints,correctnessMask,solution}}`만 반환하며 이름·코멘트·동의·idempotency·Turnstile·가짜 제출 ID/시각을 받거나 만들지 않는다. public geometry 읽기에서는 제출 수와 lazy finalization을 끄고 session·submissions·board·snapshot을 읽거나 쓰지 않는다. 브라우저는 exact target·geometry·solution·현재 답안 기준 점수를 다시 검증하고 loading·오류·재시도 뒤 동일 비교 화면을 쓰며, `정답 닫기` 뒤 임시 답안 편집과 재채점을 이어간다.

`published + paused` 상태에서는 문제 화면과 기존 제출자의 자기 결과는 유지하되 제출 버튼을 비활성화하고 관리자가 입력한 짧은 중지 안내를 표시한다. 제출 API도 `SUBMISSIONS_PAUSED`로 거부한다. `superseded` 오류본은 일반 slug 조회·아카이브·참여 현황·Top N에서 제외한다. 다만 그 variant에 실제 제출한 세션이 `/me`로 접근하면 `문제 오류로 종료된 버전입니다`라는 안내와 당시 저장된 답안·채점 revision을 반환할 수 있다. 수정본은 새 `quiz_variant_id`이므로 같은 세션도 정상적으로 한 번 다시 제출할 수 있다.

`GET /api/archive` 계약:

- `status = archived`인 세트만 반환한다. 모든 published 세트는 archive 목록에서 제외하고 featured는 최신 퀴즈 응답, 그 밖의 진행 중 세트는 `otherOpenQuizzes` 요약과 영구 slug 상세 조회로 접근한다.
- 기본 `limit=12`, 최대 24. 클라이언트 기본 UI는 항상 12개씩 요청한다.
- `q`는 trim·NFKC 정규화 후 최대 60자로 제한하고 설교 제목과 `bible_reference_label`에 매개변수화한 `instr(lower(...), lower(?))` 부분 검색을 적용한다. `%`, `_`, `\\`도 일반 문자로 찾으며 기존 ASCII 대소문자 무시와 한글 비교를 유지한다. P5-58에서 허용 범위 내 한글 검색어도 D1 LIKE 패턴 byte 제한에 걸릴 수 있음을 확인해 검색식을 변경했다.
- `year`와 `month`는 `sermon_date` 기준이며 잘못된 범위는 `400 INVALID_ARCHIVE_FILTER`로 거부한다.
- 정렬은 `sermon_date DESC, quiz_sets.id DESC`이며 cursor도 이 두 값과 현재 filter fingerprint를 담은 불투명한 서명값으로 만들어 다른 검색 조건의 cursor 혼용과 중복·누락을 방지한다.
- 응답 item은 `slug`, 설교 제목·일자, 성경 장절 label, 어린이·장년 variant 존재 여부만 기본 포함한다. 정답·참여 답안·관리자 정보는 목록 응답에 포함하지 않는다.
- 첫 페이지 응답에는 `availableYears`와 선택한 연도에 맞는 `availableMonths`를 함께 넣어 실제 데이터에 존재하는 필터만 렌더링한다.
- `nextCursor`가 null이면 `더 보기`를 숨긴다. 검색·연도·월이 바뀌면 기존 item과 cursor를 초기화한다.
- 메인 화면의 최근 3개도 같은 repository와 정렬 규칙을 사용하되 `limit=3`으로 요청한다.
- cursor HMAC key는 `ARCHIVE_CURSOR_SECRET`이라는 서버 전용 32-byte key(64자리 hex)로 환경별 관리한다. 공용 fallback을 두지 않으며, 다음 페이지가 존재하는데 key가 없거나 잘못되면 cursor 없는 결과를 발행하지 않고 조회를 실패시킨다. key 값은 브라우저·Git·로그에 포함하지 않는다.

### 15.3 제출 요청

```http
POST /api/quizzes/:quizSlug/:difficulty/submissions
Content-Type: application/json
```

```json
{
  "revision": 3,
  "idempotencyKey": "018f...",
  "turnstileToken": "...",
  "name": "은혜",
  "comment": "말씀을 다시 생각해 보았어요.",
  "consent": true,
  "cells": {
    "r0c1": "믿",
    "r0c2": "음"
  }
}
```

요청에 `score`, `rank`, `correctness`를 받지 않는다.

`cells`는 작성된 셀만 보내는 sparse map이다. 누락된 활성 셀은 빈칸으로 오답 처리한다. 활성 셀이 아닌 key, 빈 문자열, 잘못된 음절은 거부하며 유효한 작성 셀이 하나도 없으면 `EMPTY_SUBMISSION`을 반환한다.

검증 순서:

1. method·정확한 Origin·content type과 선언된 Content-Length 확인
2. 실제 stream 16KB 상한, UTF-8과 JSON 형식
3. 세션 쿠키와 idempotency key 형식
4. 정확한 schema와 추가 필드 금지
5. 공개 가능한 slug·난이도·active variant와 작성 셀 ID·완성형 한글·최소 한 칸 확인
6. 정규화한 실제 제출 내용의 request hash로 이미 제출한 세션의 replay·conflict·already-submitted 판정
7. 신규 제출의 이름·코멘트 정규화와 moderation
8. 신규 제출의 entry·행·열 답안 문자열 moderation
9. Turnstile Siteverify
10. 해당 세트의 `published + open`, `opens_at <= now < closes_at`, variant `active`, revision 일치
11. 서버 정답으로 채점
12. 제출과 관련 상태를 D1 batch로 저장
13. 고유 제약 충돌 처리

헤더를 먼저 거부하는 이유는 허용하지 않을 요청의 body를 불필요하게 읽지 않기 위해서다. 동일 idempotency key의 재시도는 현재 moderation 규칙이 바뀌었더라도 저장 당시와 같은 정규화된 실제 내용이면 Siteverify를 다시 소비하지 않고 당시 결과를 재생한다. request hash에는 variant·revision·NFC/trim된 이름·코멘트·정렬된 cells·동의를 포함하고, 재시도 식별자인 idempotency key와 일회용 전송 증명인 Turnstile token은 포함하지 않는다.

제출 성공 응답은 D1 저장이 성공한 뒤 점수·correctness mask·공식 정답을 함께 반환한다. 클라이언트는 이 단일 성공 응답으로 route 이동이나 새로고침 없이 비교 채점 화면을 즉시 그린다. 이후 다른 화면에서 돌아오거나 재방문한 기제출자는 `/me`와 `/solution`로 같은 결과를 복원한다.

```json
{
  "submissionId": "...",
  "submittedAt": "...",
  "correctCells": 17,
  "totalCells": 21,
  "correctWords": 5,
  "totalWords": 7,
  "scoreBasisPoints": 8095,
  "correctnessMask": "...",
  "canRevealAnswer": true,
  "solution": {
    "cells": { "r0c1": "믿", "r0c2": "음" },
    "entries": {}
  }
}
```

`consent`는 7.5의 필수 공개·보관 동의를 사용자가 체크했음을 나타내며 값은 `true`만 허용한다. 서버는 필드 생략이나 `false`를 거부한다. `solution.cells`와 `solution.entries`는 각각 셀 ID와 entry ID를 key로 하는 객체이며 `correctnessMask`는 `canonical_cell_order_json` 순서의 `1`(정답)·`0`(오답) 문자열이다.

### P5-72 주간 운영의 실제 연결 계약

- `GET /api/admin/dashboard`: 서버에 저장된 작업 목록·대표/발행 상태·최근 활동 시각·정리 완료/철회 여부·생성 단계·전체/공개 및 난도별 제출 수·난도별 Top N·미처리 문의 수. 원문·정답·관리자 이메일·조회 token은 포함하지 않는다. 정리 예정 시각은 기존 `/api/admin/draft-cleanup`, 비용은 기존 퀴즈별 `/ai-costs`에서 따로 읽는다. 서비스 전체 metric·백업 상태는 P8-01의 기존 출시 범위다.
- `GET /api/admin/quiz-sets/:id/workspace`: 같은 작업 정보 한 건. 6단계 진행은 기존 입력 확정·내용 검수·최종 미리보기 상태를 조회해 계산한다. URL의 `step`은 화면 이동 선택이며 저장 상태를 대신하지 않는다.
- `GET /api/admin/submissions?quizSetId=:id`: 실제 답안·이름·코멘트·난도/버전·점수·상태·조치 사유/시각. session/request hash와 관리자 이메일은 반환하지 않는다. 삭제한 제출에는 이름·답안·코멘트가 없다. hide/unhide/delete는 기존 API와 감사 거래를 재사용한다.
- `GET/PATCH /api/admin/quiz-sets/:id/winner-settings`: 난도별 1~10명과 `editable`·불투명 `revision`. PATCH는 `child, adult, expectedRevision, reason`을 받는다. 기존 `site_state`에 발행 전 값을 두고 발행/재발행 거래가 같은 값을 사용한다. 현재 active variant는 마감 전에만 변경하며 마감/확정 snapshot은 잠근다. 설정·마감·상태 충돌 시 409, 감사와 설정은 함께 저장된다.
- 보호 이름·금지어·정확한 예외는 기존 표의 GET/POST/PATCH를 사용한다. 보호 대상 표시명과 여러 별칭을 한 그룹으로 등록하고 정규화된 값·활성 상태를 수정한다. PATCH에는 `expectedUpdatedAt`과 사유가 필요하다. 예외 등록은 영향 확인 `acknowledged:true`가 필요하다. `/moderation-test`는 이름/코멘트의 기존 형식·연락처·기본 예약 이름 검사까지 같은 함수로 확인하고 관리자에게만 정규화/일치 규칙을 반환한다. 답안 시험은 한 문구의 필터 시험이며 격자 행/열/단어 결합 검사를 대신하지 않는다.
- `POST /api/privacy-requests`: strict `requestKey, requestType, quizSlug, submittedName, message, turnstileToken`. 설명 2~1000자, 추가 연락처/첨부 필드 불가, same-origin JSON, 서버 Turnstile `privacy_request` action·host 검증. 같은 key·내용은 재확인 없이 동일 접수번호를 반환하고 내용이 다르면 409다. 공개 요청 제한의 운영 설정은 DELIVERY_PLAN의 P8-01에 남아 있으며 이번 로컬 구현이 공개 출시 승인은 아니다.
- 접수번호는 `PRV-` + 256-bit 암호학적 값이다. 기존 `SESSION_PEPPER`와 requestKey의 HMAC으로 재시도 시 동일 값을 복구하며 D1에는 SHA-256 hash만 저장한다. `GET /api/privacy-requests/:lookupToken`은 종류·접수 시각·상태·관리자 답변만 반환한다. 관리자 목록/답변은 Access 보호이며 PATCH는 `status, adminResponse, expectedUpdatedAt`을 받는다. 0037 문의 표를 쓰며 문의 처리 상태를 바꾸어도 실제 제출은 자동 삭제하지 않는다.

새 운영 endpoint는 `private, no-store`이며 잘못된 입력/불필요 query는 400, 충돌은 409, 지원하지 않는 method는 405다. 모든 관리자 변경은 기존 Access·Origin 경계를 따른다. 분할 생성 GET·사람 수정의 버전 검사·무료 배치/발행 경로는 그대로 재사용한다.

### 15.4 참여 현황·Top N 응답

`/board`는 published variant에서는 현재 세션이 같은 variant에 성공적으로 제출했는지 확인하고 미제출 세션에 `403 SUBMISSION_REQUIRED`를 반환한다. archived variant에서는 세션 조건 없이 예상 최대 50명 규모의 전체 visible 목록을 공개한다.

```json
{
  "winnerCount": 3,
  "participants": [
    {
      "submissionOrder": 1,
      "displayName": "은혜",
      "submittedAt": "...",
      "comment": "...",
      "answers": { "r0c1": "믿" },
      "correctCellIds": ["r0c1"],
      "isFullyCorrect": false,
      "isMine": true
    }
  ],
  "winners": []
}
```

- `participants`: `submitted_at ASC, id ASC`
- 서버는 각 visible 답안을 현재 공개 geometry와 비공개 solution으로 다시 채점하고 저장 revision·답안·mask·cell/word 합계·basis points·완전 정답 여부가 모두 일치할 때만 응답한다. `correctCellIds`는 제출한 answer key의 부분집합이며 공식 정답은 포함하지 않는다.
- `winners`: published 중에는 `is_fully_correct = true`를 `submitted_at ASC, id ASC LIMIT winner_count`; archived 뒤에는 고정된 `leaderboard_snapshot_entries` 순위와 visible submission을 join
- published 응답은 실제 오답과 빈칸을 포함하므로 `Cache-Control: private, no-store`. archived 응답도 숨김·삭제를 즉시 반영하도록 기본 `no-store`로 두되 robots `noindex`를 강제하지 않는다.
- 숨김·삭제 제출은 두 배열 모두에서 제외
- 브라우저는 published 결과 복원 또는 제출 성공 전에는 `/board`를 요청하지 않는다. published·archived 모두 사용자가 `참여 현황 보기`를 선택한 뒤에만 읽고 loading·empty·error·retry를 화면 안에서 처리한다.
- `/me`는 자신의 실제 제출 세션을 검사한다. `/solution`, `/board`, `/top-n-export`는 published 상태에서 실제 제출 세션을 검사하고 archived 상태에서는 공개한다.

화면의 `Top N`은 이미 on-demand로 검증한 `/board` 응답을 다시 투영한다. `participants` 중 `isFullyCorrect`인 카드만 제출 순서대로 남기고, `winners` 참조가 있는 카드에만 확정 rank를 붙인다. 따라서 N위 밖의 완전 정답자도 남지만 오답·부분 답안·코멘트는 Top N 화면에 보이지 않으며, 같은 순위 snapshot을 두 API가 따로 계산하지 않는다. 독립 `GET /top-n`은 만들지 않는다.

`/top-n-export`만 PDF/PNG view model용 별도 endpoint로 둔다. 이 응답에는 완전 정답자만 제출 순서대로 넣고 `winner_count`에 따른 Top N 표시 정보를 포함한다. archived variant에서는 snapshot된 확정 순서를 사용한다. 오답·부분 답안 참여자, 코멘트, 세션 식별자, 내부 점수 필드는 포함하지 않는다. 현재 퀴즈의 미제출 세션에만 `403 SUBMISSION_REQUIRED`를 반환하고 archived variant에서는 공개한다. `Cache-Control: private, no-store`를 사용해 최신 moderation 결과와 현재 상태를 반영한다.

### 15.5 관리자 API

```text
POST   /api/admin/sermons/youtube-preview
GET    /api/admin/dashboard                              # 공개 중 퀴즈·활성 작업·운영 알림 집계
POST   /api/admin/quiz-sets/:id/manual-source             # 새 불변 raw source revision 생성; 사람 확정은 별도
GET    /api/admin/sermons/:id/transcript                  # 불변 원본·현재 작업본·revision metadata
PATCH  /api/admin/sermons/:id/transcript/working          # 사람 직접 수정·자동 저장
POST   /api/admin/sermons/:id/transcript/ai-corrections   # 자동 적용 없는 AI 교정 제안 job
POST   /api/admin/sermons/:id/transcript/apply-decisions  # 과거 항목별 제안 호환; 새 문서 교정은 아래 전환 기준
POST   /api/admin/sermons/:id/transcript/confirm          # 사람 최종 수정본 checksum 확정
POST   /api/admin/sermons/:id/transcript/revisions/:revisionId/restore
GET    /api/admin/generation-jobs/:jobId/diagnostics      # redacted 기술 정보·timeline
POST   /api/admin/bible/parse-reference
GET    /api/admin/bible/reference-preview?book=...&chapter=...&verseStart=...&verseEnd=... # v1: 장절·판본명·공식 링크만
POST   /api/admin/quiz-sets/:id/generation-jobs       # scope·부모 revision·관리자 guidance로 새 생성
GET    /api/admin/generation-jobs/:jobId              # D1의 영구 진행 상태
POST   /api/admin/generation-jobs/:jobId/retry        # 과거 설계 경로; provider 자동 재호출 금지, 아래 기준
GET    /api/admin/quiz-sets/:id/ai-revisions          # 비교용 revision 목록·현재본
PATCH  /api/admin/quiz-sets/:id/ai-revisions/:revisionId  # label 등 초안 메타데이터
POST   /api/admin/quiz-sets/:id/ai-revisions/:revisionId/restore
POST   /api/admin/quiz-sets/:id/ai-revisions/:revisionId/reviews # good/edited_then_use/regenerate 평가
GET    /api/admin/quiz-sets/:id/ai-costs               # 선택한 quiz_set 전체의 호출·모델·관측 비용
GET    /api/admin/usage-summary                         # 서비스별 비용·무료 한도·staleness
POST   /api/admin/usage-summary/refresh                 # 읽기 전용 provider metric 갱신
GET    /api/admin/monthly-operations-check              # 이번 달 확인 상태·대상 서비스
POST   /api/admin/monthly-operations-check              # 이번 달 정책 확인 완료 기록
GET    /api/admin/backups                               # private object key를 숨긴 8개 상태
POST   /api/admin/backups                               # pre-migration/수동 백업 실행, 복원 아님
POST   /api/admin/quiz-sets/:id/validate
PATCH  /api/admin/quiz-sets/:id
POST   /api/admin/quiz-sets/:id/publish
POST   /api/admin/quiz-sets/:id/archive
POST   /api/admin/quiz-sets/:id/withdraw-to-review       # 첫 제출 전 발행 취소
PATCH  /api/admin/quiz-sets/:id/display-text             # 첫 제출 후 비의미 오탈자만
POST   /api/admin/quiz-sets/:id/pause-submissions
POST   /api/admin/quiz-sets/:id/resume-submissions
PATCH  /api/admin/quiz-sets/:id/closes-at                # 사유와 함께 마감 일시 변경
POST   /api/admin/quiz-sets/:id/close-now                # 즉시 snapshot + archive
GET/POST /api/admin/quiz-sets/:id/problem-corrections     # 영향 조회·접수 중지·오류본 보존·수정본 검토/교체
POST   /api/admin/quiz-variants/:id/problem-corrections/:correctionId/publish
DELETE /api/admin/quiz-variants/:id/problem-corrections/:correctionId # 오인 시 취소
GET    /api/admin/submissions
PATCH  /api/admin/submissions/:id          # hide / unhide
DELETE /api/admin/submissions/:id
GET    /api/admin/privacy-requests
PATCH  /api/admin/privacy-requests/:id
GET    /api/admin/moderation-terms
POST   /api/admin/moderation-terms
PATCH  /api/admin/moderation-terms/:id
POST   /api/admin/moderation-test                 # 저장하지 않는 정규화·rule 결과 시험
GET    /api/admin/moderation-exceptions
POST   /api/admin/moderation-exceptions
PATCH  /api/admin/moderation-exceptions/:id
GET    /api/admin/reserved-names
POST   /api/admin/reserved-names                 # 보호 대상·alias와 정규화 미리보기
PATCH  /api/admin/reserved-names/:id             # 활성화·표시명·alias 변경
```

P5-52의 구현된 무료 배치 경로:

- `POST /api/admin/sermons/:id/generation/:jobId/placement-trial`: strict `{ expectedVersion, expectedMetadataRevision, expectedSelectionRevision, difficulty, options }`. 현재 검수된 후보로 최대 3개의 실제 격자와 보고를 반환한다. 저장·AI 호출 없음.
- `POST /api/admin/sermons/:id/generation/:jobId/placement-select`: strict `{ expectedVersion, expectedMetadataRevision, expectedSelectionRevision, requestKey, selection: { child, adult } }`. 각 선택은 `{ options, index }`이며 서버가 격자·정답·검사 결과를 재현한다. 현재 버전에서 두 배치를 함께 저장하고 기존 이력은 보존한다.
- 기존 `/generation/content` 조회의 `placement`는 현재 옵션/선택 revision과 유효 여부, `preview`는 정답 없는 공개 형식, `reviewLayouts`는 관리자 전용 정답·품사 설명·교차/제외 정보를 제공한다. 이전 자료가 바뀌면 preview/reviewLayouts는 null이다. 이 응답 전체는 관리자 전용이며 공개 API로 전달하지 않는다.

두 POST는 Access·same-origin JSON·기존 16KB 제한, 작업/quiz 소유 관계, 최근 full v3 작업, 현재 검수/metadata/선택 버전을 확인하고 응답은 `private, no-store`다. AI 실행 opt-in이 false여도 무료 배치 검토는 가능하며 실제 발행은 하지 않는다.

P5-53의 개별 재생성과 P5-55 의도만 재생성의 로컬 경로:

- `POST /api/admin/sermons/:id/generation/regenerate`: strict `{ requestKey, quizSetId, expectedVersion, scope: "summary" | "child" | "adult" | "intent", supersedesJobId? }`. 서버가 현재 확정 입력을 읽고 별도 job/dispatch를 저장한다. 요약·후보 범위는 확정 의도를 사용하고, 의도 범위는 분석과 비판 검토를 순서대로 실행한다. 같은 key는 기존 요청을 확인하며 새로운 호출을 만들지 않는다. `supersedesJobId`는 같은 범위의 불확실/기한 지난 실행을 명시적으로 대체할 때만 받는다. 실행 opt-in과 Workflow 연결이 없으면 503이다.
- `GET /api/admin/sermons/:id/generation/content?before=<content_sequence>`: 현재 full 작업·선택본과 비교 snapshot 한 페이지, 이전 페이지 `historyCursor`, 개별 생성 이력 `regenerations`의 scope/status/resultId/시각/관측 비용/미확인 호출 수를 반환한다. 본문을 모두 한 번에 불러오지 않는다. query 추가 key와 비양수/비정수 cursor는 거절한다.
- 의도 결과 선택·확정 뒤에는 기존 관리자 resume API가 의도 job을 후속 AI 호출 없이 완료한다. P5-55는 저장된 첫 분석을 재사용하는 `retryCritiqueOnly` 재시도와 기존 의도 유지 후 비교 종료도 연결했다. P5-56의 `target`은 선택한 후보 목록/문제 하나의 재생성 대상을 봉인한다. 결과 선택/수정/검수는 기존 `POST /generation/:jobId/review`를 사용한다. 부분 job의 성공은 full의 최종 검수나 발행 승인이 아니다. 이 경로도 Access·same-origin mutation·private no-store이며 공개 API와 분리한다.

P5-54의 로컬 발행 경로:

- `POST /api/admin/quiz-sets/:id/publish`: strict `{ requestKey, jobId, expectedVersion, expectedMetadataRevision, expectedSelectionRevision, confirmation: "publish" }`. query/추가 key를 받지 않는다. Access JWT·same-origin JSON·기존 16KB 제한을 적용하고, 서버가 현재 검수·두 배치·최신 full v3 및 실행 중 작업 부재를 검증한다. 생성 opt-in은 필요하지 않다.
- 성공 `{ data: { outcome: "published" | "replayed", quizSetId, slug, publishedAt, closesAt } }`. UTC 시각과 공개 주소 식별자만 반환하며 정답·근거·발행자·provenance는 반환하지 않는다. 동일 요청의 job/발행자/revision이 다르면 재생으로 취급하지 않는다.
- 인증 실패는 401/403, same-origin/형식 오류는 기존 mutation 경계 상태, 검수/충돌/저장 실패는 안전한 `PUBLICATION_UNAVAILABLE` 409, 다른 method는 405다. 응답은 `private, no-store`다.
- `GET /api/admin/sermons/:id/generation/content`는 초안 정리 전 발행 뒤 `publication: { slug, publishedAt, closesAt }`와 published 상태를 영구 snapshot에서 읽는다. 편집 상태에서는 `quizCostMicroUsd`/`quizUnknownCalls`로 그 퀴즈의 전체 호출 비용을 제공한다. 공개 latest/slug·열린 퀴즈 목록·archive는 새 영구 snapshot을 우선하고 정답은 별도 비공개 경계를 유지한다.

P5-58 발행 후 표시 정보 정정:

- `GET /api/admin/published-quizzes`: published/archived 목록의 quizSetId·최초 slug·상태·정정 revision(최초 0)·metadata `{ title, sermonDate }`·publishedAt·closesAt만 반환한다.
- `GET /api/admin/quiz-sets/:id/display-text`: `{ quiz, history }`를 같은 D1 조회에서 읽는다. history는 최신부터 정정 번호·수정 전후 값·사유·시각만 포함한다. 관리자 이메일/digest·요청 번호·초안/정답은 응답하지 않는다.
- `PATCH /api/admin/quiz-sets/:id/display-text`: strict `{ requestKey, expectedRevision, before: { title, sermonDate }, after: { title, sermonDate }, reason }`. 제목은 trim 뒤 1~300자와 제어/고립 surrogate 문자 금지, 설교일은 실제 ISO 날짜, 사유는 기존 2~500자/제어 문자 금지를 적용한다. 최소 한 값이 바뀌어야 한다. DB guard에서 현재 공개 상태·번호·기존 값을 대조하고 감사와 원자 저장한다.
- 성공 `{ outcome: "changed" | "replayed", quizSetId, revision }`. 같은 key의 내용/관리자가 달라지면 재생하지 않는다. 미발행·충돌·형식·저장 실패는 안전한 DISPLAY_TEXT_UNAVAILABLE 409이며 같은 요청 재확인 또는 최신 내용 재조회를 제공한다. 단서/요약/정답/격자 등 문제 필드는 SEMANTIC_CORRECTION_REQUIRED 409로 안내한다. 다른 추가 필드도 strict 검증으로 거부한다.
- Access JWT·private no-store·query 금지·method 경계를 적용한다. PATCH는 same-origin JSON과 기존 16KB 제한을 적용한다. AI 호출/생성 opt-in 없이 동작하며 발행·철회·문제 교체·마감 변경을 수행하지 않는다.

P5-59 첫 제출 전 발행 철회:

- `POST /api/admin/quiz-sets/:id/withdraw-to-review`: strict `{ requestKey, expectedPublishedAt, expectedDisplayRevision, reason, confirmation: "withdraw" }`. 사유는 기존 2~500자/제어 문자 금지를 적용한다. 성공 `{ outcome: "withdrawn" | "replayed", quizSetId, reviewRevision, withdrawnAt }`이며 같은 key/발행 시각/정정 번호/사유/관리자만 재생한다.
- `GET /api/admin/withdrawn-quizzes`: review_ready인 철회본의 `{ quizSetId, title, reviewRevision, withdrawnAt }` 목록. `GET /api/admin/quiz-sets/:id/withdraw-to-review`: 사유·시각·번호와 관리자 전용 검수 시작 자료. 정답/근거를 포함하므로 공개 DTO와 분리하며 관리자 이메일/digest·요청 key·참여자·비용은 포함하지 않는다.
- 모든 variant의 제출 0건을 commit 시 재검증하고 불변 복사본·상태·featured·감사를 원자 저장한다. 공개/아카이브는 기존 상태/lifecycle 필터로 철회본을 제외한다. 자세한 조건은 [철회 명세](generation.md#p5-59-로컬-첫-제출-전-발행-철회)를 따른다.
- Access JWT·private no-store·query 금지·method 경계를 적용한다. POST는 same-origin JSON/16KB·Zod strict 검증을 적용하며 형식/충돌/마감/제출/저장 실패는 안전한 WITHDRAWAL_UNAVAILABLE 409다. AI 실행 opt-in/유료 호출과 독립이며 재발행·문제 교체는 실행하지 않는다.

모든 관리자 endpoint는 Access가 앞에서 차단한 뒤 `biblequiz-app`에서도 JWT issuer, audience, signature를 검증한다.

현재 구현된 성경 장절 route는 `POST /api/admin/bible/parse-reference`의 strict `{ "input": "요한복음 3:1-3" }`와 `GET /api/admin/bible/reference-preview`의 exact `book=JHN&chapter=3&verseStart=1&verseEnd=3`을 받는다. POST는 same-origin JSON·16KB 제한을 적용하고 GET은 누락·추가·중복·비정규 숫자 query를 거부한다. 두 route는 같은 `createBibleReference` 경계로 `bookId/start/end`, 정규 label, 절 수, `개역개정`, `reference_only`, 대한성서공회 읽기 포털만 반환한다. 본문·자막·DB·AI·Access 이메일은 읽거나 반환하지 않고 전 응답은 `private, no-store`다.

`withdraw-to-review`는 세트의 모든 variant에 성공 제출이 0건일 때만 허용한다. 발행 정식 snapshot을 새 편집 revision의 시작점으로 복사하되, 공개 세트를 미발행 초안으로 되돌렸다는 감사 기록을 남긴다. 취소된 세트가 featured였다면 다음으로 최신인 열린 published 세트를 featured로 승격한다. 그런 세트가 없을 때만 직전 archived 세트를 읽기 전용 featured 항목으로 둘 수 있으며 `published`나 접수 가능 상태로 되돌리지 않는다.

`closes-at` 변경은 새 UTC 시각과 사유를 받고 한국 시간 미리보기를 응답한다. 이미 제출이 있으면 관리자에게 기존 마감·변경 마감·남은 시간을 다시 보여준 확인 토큰을 요구한다. `close-now`와 마감 finalization은 같은 idempotent service를 사용한다. 새 퀴즈 publish API는 다른 published 세트의 이 endpoint를 내부 호출하지 않는다.

현재 구현된 `close-now` 요청은 추가 필드를 허용하지 않는 `{ "confirmation": "close_now", "reason": "..." }`이며 사유는 trim 뒤 2~500자와 제어 문자 금지를 적용한다. 성공 응답은 quiz set ID, 기존 immutable `archivedAt`, `finalized | replayed` 결과와 난이도별 variant ID·winner/submission count만 반환하고 관리자 이메일·사유·제출 ID는 반환하지 않는다. 미래 마감 강제 종료는 `closes_at = now`, 두 난이도 snapshot과 rank, archive, 감사 로그를 한 D1 batch로 확정한다.

현재 구현된 submission moderation은 `PATCH /api/admin/submissions/:id`에 strict `{ "action": "hide" | "unhide", "reason": "..." }`, `DELETE`에 strict `{ "confirmation": "delete", "reason": "..." }`를 사용한다. 성공 응답은 submission ID, 현재 status, `changed | replayed`와 delete일 때 최초 `deletedAt`만 포함하며 관리자 이메일·사유·이름·코멘트·답안은 반환하지 않는다. hide/unhide/delete 상태 전이와 moderation action·Access audit는 한 조건부 D1 batch로 확정한다.

`display-text`는 허용 필드, 수정 전·후 값, 사유를 받고 서버가 정답·격자·채점 데이터의 변경을 거부한다. 의미가 달라질 가능성이 있는 단서·요약 수정은 자동으로 안전하다고 판정하지 않고 `문제 오류 처리` 경로로 안내한다. `problem-corrections`는 세트 전체 접수를 먼저 중지하고 기존 variant에 연결된 수정본을 만든다. publish endpoint는 전체 검증 성공, 현재 pause 상태, 기존 revision 일치 여부를 다시 확인한 한 트랜잭션 안에서 기존본을 `superseded`, 수정본을 `active`로 바꾸고 접수를 재개한다. 관리자가 실제 오류가 아니라고 판단해 수정 작업을 취소하면 미발행 correction revision만 폐기하고 감사 사유를 남긴 뒤 명시적으로 접수를 재개할 수 있다. 오류 수정 작업이 남아 있는 동안 일반 `resume-submissions`는 거부한다.

진행 중 수정본의 마감은 자동으로 7일을 다시 부여하지 않는다. 수정본 발행 화면에 기존 `closes_at`과 남은 시간을 먼저 표시하고 이를 기본값으로 두며, 관리자가 필요할 때 같은 확인 절차로 연장한다. 수정 작업 중 기존 마감이 이미 지났다면 과거 시각으로 수정본을 발행할 수 없고, 아래의 마감 후 정정 흐름으로 전환한다.

마감 뒤 발견되었거나 수정 도중 마감에 도달한 문제 오류는 순위 접수를 다시 열지 않는다. 기존 오류 variant와 제출 기록은 감사·당시 제출자 확인용으로 보존하되 일반 Top N과 참여 현황에서는 제외하고 `결과 무효 처리됨`을 표시한다. 관리자는 검증된 수정 variant를 **정정된 지난 퀴즈**로 발행할 수 있으며, 누구나 풀고 채점·정답보기를 사용할 수 있지만 새 결과는 D1 제출 기록·참여 현황·Top N에 들어가지 않는다. 이 정정은 기존 제출을 재채점하거나 새 순위를 만드는 동작이 아니다.

`GET /api/admin/dashboard`는 featured 퀴즈, 동시에 진행 중인 published 퀴즈들과 각 마감 일시, 가장 최근에 활동한 미발행 `quiz_set`, 파생된 6단계 진행 상태, 실행 중·실패 작업, 하루 이내 초안 삭제 예정 수, 미처리 문의 수, 진행 중 퀴즈별 공개 제출 수와 관리 바로가기, 난이도별 `winner_count`, 최근 발행 목록, 비용·사용량의 최악 상태와 마지막 갱신 시각만 반환한다. 상세 metric은 `usage-summary`에서 지연 로드한다. 별도 승인 대기열은 만들지 않는다. 전체 자막·AI 원문·실제 답안은 첫 화면 집계에 넣지 않고 상세 화면에서 별도로 요청한다.

공개 `export-data`는 주보 편집용 번호 표시 빈 격자와 단서 복사용 데이터만 반환한다. 응답은 `{ data: { slug, difficulty, quizVariantId, quizRevision, grid } }`이며 정답·solution hash·제출 답안·설교 원문·참여자는 포함하지 않는다. 제출·관리자 권한 없이 사용할 수 있고 제출 수·세션·순위 확정을 조회하거나 저장하지 않는다.

P6-01의 `top-n-export`는 `{ data: { ...export-data, status, generatedAt, sermon: { churchName, title, date, bibleReferenceLabel, translation }, board: { winnerCount, participants: [{ completionOrder, displayName, submittedAt, answers, rank }] } } }`다. `rank`는 기존 winners에 해당하지 않으면 null이며 완전 정답자만 반환한다. 현재 퀴즈의 exact 활성 세션·visible/hidden 성공 제출, 저장 revision·점수/격자 검증은 `/board`와 같은 handler/저장소를 사용한다. 마감 후에는 기존 lazy finalization과 고정 snapshot을 읽으며 숨김/삭제 이후 빈 순위를 승격하지 않는다. 오류본·비순위 정정본은 404다. 두 출력 API는 `private, no-store`, query 금지·GET 전용(다른 method 405)이며 구조/저장 자료 오류는 안전한 503으로 닫는다. 코멘트·세션·submission ID·점수·관리자 자료는 반환하지 않는다.

백업 API에는 restore endpoint를 만들지 않는다. 목록은 생성일·종류·크기·checksum 앞자리·검증 상태만 반환하고 R2 object URL이나 서명 다운로드 주소를 반환하지 않는다. metric refresh는 Access/JWT, 짧은 cache, 동시 실행 잠금을 적용하며 실패하면 이전 수치를 최신인 것처럼 표시하지 않는다.

monthly check POST는 서버의 `Asia/Seoul` 연월, 현재 `pricing_catalog` version, 확인 대상 서비스 목록을 다시 계산하며 클라이언트가 과거·미래 연월을 임의로 제출하지 못한다. 현재 catalog가 누락되거나 변경 감지 상태면 확인 완료를 받지 않고 먼저 기준 갱신을 요구한다.

### 15.6 표준 오류

```json
{
  "error": {
    "code": "EMPTY_SUBMISSION",
    "message": "한 칸 이상 적은 뒤 제출해 주세요.",
    "field": "cells",
    "requestId": "..."
  }
}
```

| HTTP | code | 의미 |
|---:|---|---|
| 400 | `INVALID_JSON` | JSON 파싱 실패 |
| 400 | `INVALID_SESSION_REQUEST` | 세션 요청에 알 수 없는 필드 또는 잘못된 body가 있음 |
| 400 | `INVALID_ARCHIVE_FILTER` | 지난 퀴즈 검색어·연도·월·cursor 범위 또는 형식 오류 |
| 401 | `SESSION_REQUIRED` | 쿠키 사용 불가 |
| 403 | `ORIGIN_NOT_ALLOWED` | 다른 출처 요청 |
| 403 | `TURNSTILE_FAILED` | 봇 검증 실패·만료·재사용 |
| 403 | `SUBMISSION_REQUIRED` | 현재 퀴즈의 정답보기·참여 현황·Top N·`Top N 출력` 전에 같은 난이도 제출 필요 |
| 403 | `ADMIN_FORBIDDEN` | Access 검증 실패 |
| 404 | `QUIZ_NOT_FOUND` | 퀴즈 또는 난이도 없음 |
| 405 | `METHOD_NOT_ALLOWED` | 상태 변경 경계에서 지원하지 않는 method |
| 409 | `ALREADY_SUBMITTED` | 해당 세션이 이미 제출 |
| 409 | `REVISION_MISMATCH` | 열린 화면보다 revision이 바뀜 |
| 409 | `QUIZ_CLOSED` | 제출 기간 종료 |
| 409 | `SUBMISSIONS_PAUSED` | 문제 확인·수정 중이라 신규 제출 일시 중지 |
| 409 | `PUBLISHED_SUBMISSIONS_EXIST` | 첫 제출 후라 단순 발행 취소·정답 교체 불가 |
| 409 | `SEMANTIC_CORRECTION_REQUIRED` | 오탈자 범위를 넘어 문제 오류 처리 절차 필요 |
| 409 | `IDEMPOTENCY_CONFLICT` | 같은 key의 다른 요청 |
| 409 | `SUBMISSION_MODERATION_INVALID_STATE` | 관리자 조치가 exact 현재 제출 상태와 맞지 않음 |
| 413 | `PAYLOAD_TOO_LARGE` | 16KB 초과 |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | `application/json`이 아닌 상태 변경 요청 |
| 422 | `EMPTY_SUBMISSION` | 작성된 활성 셀이 하나도 없음 |
| 422 | `INVALID_GRID_SHAPE` | 예상 밖 셀 |
| 422 | `INVALID_HANGUL_SYLLABLE` | 완성형 한글 한 음절이 아님 |
| 422 | `INVALID_NAME` | 이름 형식 오류 |
| 422 | `INVALID_COMMENT` | 코멘트 형식 오류 |
| 422 | `NAME_RESERVED` | 사칭 가능 이름 |
| 422 | `CONTENT_BLOCKED` | 공개 부적합 표현 |
| 429 | `RATE_LIMITED` | 요청 과다 |
| 503 | `VERIFICATION_UNAVAILABLE` | Turnstile·DB 일시 오류 |
| 503 | `SESSION_UNAVAILABLE` | session secret·D1 일시 오류 |
| 503 | `SUBMISSION_MODERATION_UNAVAILABLE` | 관리자 submission 변경·감사 기록을 원자적으로 확정하지 못함 |

## P5-48 입력·생성 API 전환 기준

신규 교정은 [생성 연결 계약](generation.md#간결한-생성-결과의-연결-계약)을 따른다. 현재 실제 경로는 `workers/app/app.ts`와 `shared/api/admin-sermon-input.ts`가 기준이며 아래 장기 API 목록 전체가 구현됐다는 뜻은 아니다.

기존 Access 관리자 입력 PATCH의 action에 `apply_correction_document`를 추가해 같은 version/source/document/hash 확인·사람 검토·조건부 저장을 사용한다. 제안 상세 GET은 문서형/옛 items형을 명시적으로 구분해 반환한다. 생성 요청은 원문/사용자 신원/비용을 브라우저가 확정하게 하지 않고 서버가 현재 바탕을 캡처한다. 문서형 교정에 items decide/merge 요청을 쓰거나 반대 형식을 적용하면 저장 없이 거부한다.

P5-49에서 문서형 교정의 선택 조회·채택 PATCH를 로컬 연결했다. P5-50/51에서 새 `final_audit` 요청 거부와 감사 없는 full v3 실행을 연결했고 P5-53에서 요약·난이도별 개별 실행을 연결했다. 단순 중복 요청은 저장된 결과를 확인하며, 관리자의 명시 재생성만 새 호출을 시작한다. 불확실한 provider 호출을 자동 반복하지 않는다. 공개 응답에는 교정 본문·비공개 자막·관리자/비용 내부 정보를 추가하지 않는다.

## P5-57 초안 정리 조회

- `GET /api/admin/draft-cleanup`: Access 보호, `no-store`, query 없음. 하루 안의 예정/기한 경과 자료와 보류/정리 완료 자료를 `{ items: [{ sermonId, title, dueAt, state, reason }] }`로 반환한다. 상태는 `scheduled | due | blocked | purged`, 사유는 `active_call | publication_missing | activity_unknown | unreadable | expired | null`이다. 본문·정답·source checksum·actor·정리 SQL/ID 목록은 반환하지 않는다.
- 정리 완료한 `/api/admin/sermons/:id/*` 초안 API는 `410 DRAFT_EXPIRED`로 새 작업 시작을 안내한다. 공개/아카이브 API 계약은 유지한다.
- 정리 실행 POST API는 제공하지 않는다. 실행은 기본 비활성 Content Worker scheduled handler와 임시 D1 검사에서만 연결했다. [정리 정책](generation.md#p5-57-로컬-초안-정리-연결).

### P5-60 철회본 편집 미리보기 — 부분 연결

`POST /api/admin/quiz-sets/:id/withdrawal-preview`는 `expectedReviewRevision`, `expectedEditRevision`(기본 0), `edits: [{difficulty, entryId, answer?, clue?}]`를 받는다. 저장 이력이 있으면 정확한 최신 editRevision을 지정해야 하며, 빈 edits로 저장본만 검사할 수 있다. Access·same-origin JSON·기존 16KB 요청 경계·strict 검증·query 금지·private no-store를 적용한다. 현재 review_ready + paused, 모든 variant withdrawn, 모든 revision의 성공 제출 0건을 읽기 시 확인한다. 영구 철회 자료만 사용하며 초안 본문/생성 ticket/AI에 의존하지 않는다.

어린이·장년 모두 기존 한글·배치·공개 격자·채점 정합성을 다시 검사한다. 현재 작은 연결 범위는 기존 좌표의 답·단서 편집 미리보기이며, 답 길이가 달라지면 `REPLACEMENT_LAYOUT_REQUIRED`, 교차 음절이 충돌하면 `LETTER_CONFLICT` 등을 반환하고 해당 preview는 null이다. 이는 제품의 답 길이 제한이 아니라 아직 미연결인 재배치를 안내하는 결과다. 코드 검사 실패는 정상 200 데이터의 `codeChecksPassed: false`로, 잘못된 요청·오래된 revision·잘못된 바탕 자료는 안전한 409로 구분한다.

응답의 `persisted: false`, `requiresHumanReview: true`는 항상 유지한다. 정답은 관리자 응답 안의 별도 `solution`으로만 반환한다. 성공은 저장·사람 검토·최종 발행 검증 증거가 아니며 metadata/요약/근거 의미 검토와 두 난이도 사람 확인을 대신하지 않는다. 편집 revision 저장·조회는 아래 경로로 연결했다. 재배치·화면·사람 검토·재발행은 아래 통합 revision 경로를 사용한다. 새 주기를 시작하면 이 초기 경로를 현재 편집본으로 사용하지 않는다. [현재 구현·검사](../work/P5-60.md).

### P5-60 철회본 편집 저장·조회 — 부분 연결

`GET /api/admin/quiz-sets/:id/withdrawal-edits`는 현재 철회 자료에 대한 `quizSetId`, `reviewRevision`, `editRevision`, `savedAt`, 누적 `edits`, `requiresHumanReview: true`를 반환한다. 저장 전에는 editRevision 0, savedAt null, 빈 edits다. 정답을 포함할 수 있는 관리자 전용 자료이며 공개 DTO에는 연결하지 않는다.

같은 URL의 `POST`는 `requestKey`, `expectedReviewRevision`, `expectedEditRevision`, 비어 있지 않은 `edits`를 받는다. 현재 저장본의 다른 문제/난이도/필드는 유지하고 지정한 답·단서 필드만 합친다. 결과는 `{outcome: saved | replayed, revision: 위 조회 형식}`이다. 원본 철회 snapshot은 수정하지 않는다. 성공 재확인은 같은 key·정규화한 요청·관리자에만 기존 revision을 반환하며, 나중 revision이 생겨도 head를 되돌리지 않는다.

편집 이력 삽입과 본문 없는 Access 감사를 한 D1 batch로 저장한다. 저장 직전 상태·철회 revision·최신 편집 번호·전체 revision 제출 0건을 재확인하고 경합 또는 감사 실패 시 전체 취소한다. 미완성 답은 초안으로 저장할 수 있으며 저장 성공을 코드 검사/사람 승인으로 간주하지 않는다. 이 초기 경로의 metadata·요약·근거 편집은 통합 revision 경로로 이어간다.

Access, same-origin JSON, 기존 16KB 요청 경계, strict/query/method 검사와 private no-store를 미리보기와 같이 적용한다. 저장/조회 실패는 안전한 409 `WITHDRAWAL_EDITS_UNAVAILABLE`로 반환한다. 저장본 기준 미리보기는 정확한 editRevision에서만 허용하고 응답에도 그 번호를 포함한다. 새 편집 이력의 7일 정리를 연결했다. 사람 검토·UI·재발행·새 편집 주기는 아래 통합 경로에 연결했다. 새 주기 시작 뒤 초기 경로의 저장은 차단한다.

### P5-60 철회 편집 만료 응답

기존 `GET /api/admin/draft-cleanup` 목록에서 현재 철회 편집 작업을 동일한 sermonId로 표시한다. 마지막 편집 저장+7일의 하루 전부터 scheduled/due를 제공하며, 새 편집 작업이 있으면 옛 초안의 purged 표식을 현재 편집 완료로 표시하지 않는다. 원래 생성 초안의 정리 기록은 바꾸지 않는다. 신규 답·단서 이력 전체를 한 작업 단위로 계산하며 조회·저장 성공 재확인은 기한을 늘리지 않는다.

정리 완료 후 withdrawal-edits GET/POST와 withdrawal-preview POST는 `410 DRAFT_EXPIRED`·private no-store를 반환한다. 빈 edits를 정상 저장본으로 재생하지 않고 원래 철회 자료 조회는 계속 허용한다. 기존 scheduled handler의 기본 비활성 스위치를 유지하며 삭제 실행 HTTP API·새 Cron·원격 활성화는 추가하지 않았다.


### P5-60 통합 편집·검토·재발행 API

`GET /api/admin/quiz-sets/:id/revision`은 `not_started | editing | expired | published` 상태, sessionId/cycle/revision, 현재 본문(content/layouts/reviewed), 코드 검사 issues/canPublish, 원본 근거와 공개 주소/고지, 저장 시각과 발행 결과를 반환한다. 정답은 관리자 `layouts.*.solution`에만 있으며 공개 자료형에 섞이지 않는다. 만료 상태는 본문 없이 200으로 명시해 새 편집 시작 화면을 제공한다.

같은 URL의 POST는 strict 명령을 받는다.

| action | 바탕·입력 | 결과 |
|---|---|---|
| start | requestKey, expectedCycle | 보존된 철회 자료에서 새 편집 주기. 최초 시작만 살아 있는 이전 답·단서 편집을 가져옴 |
| save | requestKey, sessionId, expectedRevision, content | 누적 전체 내용 저장·기존 배치 재검사·모든 사람 검토 무효화 |
| trial | sessionId, expectedRevision, difficulty, gridSize, seed | 무료 배치 시험의 layout 또는 실패 사유. 쓰기/기한 연장 없음 |
| layout | requestKey, sessionId, expectedRevision, difficulty, gridSize, seed | 서버가 배치를 재현해 선택 저장·사람 검토 무효화 |
| review | requestKey, sessionId, expectedRevision, area(summary/child/adult), confirmed:true | 코드 검사를 통과한 현재 내용에 해당 영역 사람 검토 기록 |
| publish | requestKey, sessionId, expectedRevision, confirmation:publish | 다시 검증하고 원자 재발행. 같은 주소·정확히 7일 참여 기간 |

성공 명령은 현재 view를 반환한다. 동일 key·요청 SHA·관리자 재확인은 중복 저장이나 기한 연장 없이 현재 상태를 읽으며, 옛 요청이 head/공개 상태를 되돌리지 않는다. 만료된 편집의 save/layout/review/trial은 `410 DRAFT_EXPIRED`; 경합·검사 실패는 본문/SQL 없는 안전한 409다. Access, same-origin JSON, query/method 검사와 private no-store를 적용한다. 전체 요약/두 난이도 편집에는 기존 관리자 입력의 `2 MiB + 4096 bytes` 전송 경계를 재사용한다. 이전 withdrawal-edits/preview의 16 KiB 경계는 그대로다.

재발행 뒤 철회는 기존 `withdraw-to-review` 명령을 재사용한다. 최초 quiz_withdrawals를 덮지 않고 새로운 편집 주기에 최신 영구 발행 자료를 복사한다. 기존 GET과 철회 목록도 최신 주기를 보여준다. 삭제 실행·원격 적용·AI 호출 API를 추가하지 않았다.

### P5-61 문제 오류 처리와 당시 본인 기록

- `GET /api/admin/quiz-sets/:id/problem-corrections`: 현재 난이도별 variant·공개/숨김/삭제 수·기존 확정 순위 수·기존 마감·현재 편집/검토 상태를 읽는다.
- 같은 경로 `POST`: strict `start`(requestKey, expectedCycle, expectedVariants, levels, reason, notice), 기존 revision 명령의 save/trial/layout/review/publish, 또는 `cancel`(requestKey, sessionId, expectedRevision, reason, confirmation=`not_an_error_resume`)을 받는다. 한 난이도만 선택하면 공통 metadata/요약과 반대 난이도 변경을 거부한다. 성공은 현재 상태를 반환하고 같은 key·정규화 요청·관리자의 재시도는 기존 결과를 재생한다. 새 교체를 과거 요청으로 되돌리지 않는다.
- `GET /api/admin/quiz-sets/:id/problem-records`: 원본 격자·당시 정답·단서·요약과 각 처리 사유/결과를 Access 안에서만 반환한다. 편집 본문 정리 후에도 원본은 조회된다.
- 관리자 경로는 Access JWT·same-origin mutation·strict JSON·기존 요청 byte 경계·query/method 제한·private no-store를 사용한다. 일반 실패는 내부 SQL/정답을 포함하지 않는 `PROBLEM_CORRECTION_UNAVAILABLE` 409다.
- `GET /api/quizzes/:slug/:difficulty/problem-history`: 현재 active 익명 세션이 실제 제출한 superseded/invalidated 오류본만 목록으로 반환한다. 별도 세션을 만들거나 수명을 연장하지 않는다. 당시 geometry·기존 solution으로 저장 점수 정합성을 확인하고 최소 own-submission DTO와 당시 공개 격자·오류 안내만 반환한다. 이름·코멘트·근거·관리자·session/request hash는 없다. 모르는/만료/다른 세션은 빈 목록, 손상은 안전한 503이다.
- `DELETE /api/quizzes/:slug/:difficulty/problem-history/:variantId`: same-origin strict `{}`·exact 소유권으로 기존 본인 삭제 writer를 재사용한다. PII 제거·삭제 감사/표식과 tombstone 계약을 유지하고 새 variant의 제출을 변경하지 않는다.
- 공개 현재 퀴즈의 선택적 `correction: {nonRanked, notice}`는 새 수정본 안내만 포함한다. 기존 `/me`는 계속 현재 variant만 반환하며 과거 오류본을 현재 제출로 복원하지 않는다. 공개/본인 응답은 private no-store다.

`problem-corrections`는 세트 단위 endpoint와 선택한 `levels`로 연결했다. 일반 표시 오탈자는 P5-62로 연결했다. 일반 마감 변경 endpoint는 [P5-63](#p5-63-일반-마감-변경-api)으로 로컬 연결했다.

### P5-62 일반 문구 오탈자 API

- `GET /api/admin/quiz-sets/:id/display-text/wording`: `{ quizSetId, revision, contentRevision, blocked, targets, history }`. 한 D1 조회로 최신 상태·허용된 공개 요약/단서·정정 이력을 읽는다. target은 `summary` 또는 현재 active 문제의 entry ID다. 대상은 종류·난이도·번호·방향·표시 문구만, 이력은 수정 전후·사유·시각만 담는다. 관리자/요청 digest·정답·근거·참여자는 DTO에서 제외한다.
- 같은 주소의 `PATCH`: strict `{ requestKey, expectedRevision, contentRevision, target, before, after, assessment: "non_semantic_typo", confirmation: "meaning_and_answer_unchanged", reason }`. 현재 공개 계약의 요약 20,000자·단서 2,000자, 기존 사유 2~500자를 재사용한다. 줄바꿈/탭 외 제어 문자·고립 surrogate·무변경을 거부한다. 문구가 긴 경우에도 수정 전후를 받을 수 있도록 기존 관리자 콘텐츠 JSON 크기 경계를 재사용한다.
- 의미 변경/불확실 판단·확인 누락·정답/격자/채점 필드는 `SEMANTIC_CORRECTION_REQUIRED` 409다. 의미 판정은 관리자의 명시 확인이며 자동 안전 판정은 없다. 현재 값/번호/콘텐츠/소속 충돌·오류 처리 진행 중·미발행·저장 실패는 본문 없는 `DISPLAY_TEXT_UNAVAILABLE` 409다.
- 성공은 기존 `{ outcome: "changed" | "replayed", quizSetId, revision }`이다. 같은 key/내용/관리자만 기존 성공을 재생한다. Access JWT·same-origin JSON·query 금지·method 제한·private no-store를 적용한다. 기존 제목·설교일 `display-text` 계약은 그대로 유지한다.

### P5-63 일반 마감 변경 API

`GET /api/admin/quiz-sets/:id/closes-at`는 현재 UTC 마감·한국 시간 표시·시간상 변경 가능 여부·접수 중지 여부·전체 성공 제출/공개/숨김/삭제 표식 수와 마감 변경 이력을 반환한다. 정답·답안·관리자 식별·내부 요청 hash는 반환하지 않는다.

`POST`는 strict `{closesAt, reason}`을 받아 읽기 전용 영향 미리보기를 반환한다. 기존/요청 마감의 UTC·한국 시각, 확인 시점의 남은 시간, 즉시 마감 여부, 제출 수와 서명 확인 토큰을 제공한다. `PATCH`는 같은 필드와 UUID `requestKey`, `confirmationToken`, `confirmation: change_deadline | close_now`를 받는다. 제출 유무와 관계없이 이 UI 흐름은 미리보기 뒤 확인을 거치며, 기존 제출이 있으면 영향을 명시한다. 사유는 기존 close-now의 trim 2~500자·제어 문자 금지를 재사용한다.

확인 토큰은 서버 전용 기존 SESSION_PEPPER와 별도 `quiz-deadline-v1` 목적값으로 서명하며 대상·관리자 digest·새 시각·사유·현재 마감/접수/문제 버전·전체 성공 제출/상태별 수·오류 처리 주기/결과·마감 변경 수에 귀속한다. 새 secret이나 공용 fallback을 만들지 않는다. 변조·다른 대상/관리자·확인 뒤 변경된 상태를 거부한다. 서버 현재 시각에 원래 마감이 지났다면 연장 불가이며, 미래 변경 요청 시각이 저장 전에 지났다면 즉시 마감으로 자동 전환하지 않고 재확인한다. 같은 요청 재생은 최초 성공만 반환하고 최신 기간을 되돌리지 않는다.

과거/현재 시각 요청은 `close_now` 확인으로 실제 저장 시각에 마감한다. 조건 검사·감사와 기존 finalizer의 snapshot/archive를 한 batch에 저장한다. 성공은 `{quizSetId, closesAt, archived, outcome: changed | replayed}`다. 조회/미리보기/저장 모두 Access·private no-store·query 금지, mutation은 same-origin JSON·기존 16KB, 지원 외 method는 405다. 실패는 안전한 409 `DEADLINE_UNAVAILABLE`로 입력 재확인을 안내한다. [구현·검사](../work/P5-63.md).

### P5-65 관리자 설교 초안 등록·메타데이터

- `GET /api/admin/sermon-drafts`: 미발행 작업의 sermonId/quizSetId·제목·설교일·상태·본문 정리 여부만 반환한다. 발행/철회는 기존 관리 경로를 사용한다.
- `POST /api/admin/sermon-drafts`: strict `{ video, title, sermonDate, referenceInput, confirmed: true }`. 서버가 URL/video ID·실재 날짜·장절을 검증하고 원자 등록한다. `{ outcome: "created" | "existing", sermonId, destination: "draft" | "published" | "expired" }`. 중복 영상은 기존 ID만 반환하며 요청한 metadata로 덮지 않는다.
- `GET /api/admin/sermon-drafts/:id`: 편집 가능한 미발행 정보와 metadataRevision(미초기화면 null), 정규 장절·공식 링크·slugPreview. 본문/정답·관리자·비용은 반환하지 않는다.
- `PATCH /api/admin/sermon-drafts/:id`: strict `{ expectedRevision: number | null, title, sermonDate, referenceInput, confirmed: true }`. 저장 시 현재 revision/미발행/철회 이력 없음/정리 전을 확인한다. 정상 저장 후 현재 metadata view를 반환한다. 정보 변경은 기존 발행 검수 증거를 무효화한다.

모두 Access·`private, no-store`, query 거부·허용 method 제한을 적용한다. POST/PATCH는 기존 same-origin JSON·16 KiB 경계다. 검증 실패 400, 편집 대상 없음 404, 저장 경합 409, 확인 불가 503으로 구별하며 SQL·본문·개인 정보를 오류에 싣지 않는다. 실제 외부 metadata/자막 provider를 호출하지 않는다.

### P5-66 공개 영상 미리보기와 자막 원본 저장

- POST /api/admin/sermon-drafts/video-preview는 strict video 문자열을 받는다. 동일 video ID가 이미 있으면 기존 sermonId와 draft/published/expired 위치를 반환하고 외부 provider를 호출하지 않는다. 신규 영상은 제목·게시일(없으면 null), 자막 사용 가능 여부·언어/자동 여부·구간/글자 수 또는 분류된 실패와 안전한 진단만 반환한다. 자막 본문·signed URL·인증 정보는 반환하지 않고 DB 쓰기도 하지 않는다. 자막 차단으로 제목도 없으면 공개 oEmbed 제목을 제한적으로 보완하며, caption.status/code/diagnostic은 원래 실패 그대로 반환한다. 제목 조회 성공이 자막 성공이나 원본 저장을 뜻하지 않는다.
- POST /api/admin/sermons/:id/input/public-captions는 strict expectedVersion 0을 받는다. 미발행·미정리 작업의 저장된 영상 주소를 사용하고 아직 입력자료가 없을 때만 provider를 다시 호출한다. 성공은 기존 불변 시간 자막 원본 저장 후 outcome imported만 반환한다. 사람의 자막 확정은 기존 별도 명령이다. provider 실패는 outcome failed와 고정된 code/message, manual_paste fallback, 안전한 진단을 반환하며 DB에 쓰지 않는다. 저장 경합은 409, 3만 자 초과는 422, 불확실한 저장 결과는 503으로 구별한다.
- 두 경로는 Access, private/no-store, same-origin JSON, 기존 16 KiB 요청 제한, query 거부, 허용하지 않은 method 405를 적용한다. 공개 API에는 영상 취득 정보·비공개 자막·관리자 진단을 추가하지 않는다. 자막 track ID의 관리자 읽기 응답은 기존 provider의 점 포함 식별자(예: .ko)를 검증한다. [흐름](generation.md#p5-66-공개-영상-정보자막-취득의-관리자-연결).


### P5-68 퀴즈 AI 비용 조회 API

`GET /api/admin/quiz-sets/:id/ai-costs`는 Access 관리자 전용, query 없는 읽기 요청이다. 응답은 `private, no-store`이며 `{data: {quizSetId, knownCostMicroUsd, unknownCalls, totalCalls, models, calls}}`다. `models`는 provider/model별 관측 소계·전체/미확인 호출 수, `calls`는 최신 시작순의 작업 목적·scope·개별 문제 요청 여부(`singleEntry`)·provider/model·시작/관측 시각·상태·입력/metadata revision·시도·입력/캐시/추론/출력/음성 사용량·저장된 `pricingVersion`·`estimatedCostMicroUsd`를 담는다. 관측이 없는 호출의 사용량·버전·금액은 `null`이며 알려진 소계에 더하지 않는다. 같은 호출에 현재/옛 원장 행이 모두 있으면 현재 관측만 쓴다. 없는 퀴즈는 404, 조회 불가 상태는 안전한 503을 반환한다. 공개 API에는 이 자료를 직렬화하지 않는다. [화면 계약](generation.md#p5-68-로컬-비용-상세-연결) · [검사](../work/P5-68.md).

### P5-67 관리자 품질 평가

- `POST /api/admin/sermons/:id/generation/:jobId/quality`: strict `{ requestKey: UUID, expectedVersion, targetSnapshotId, scope: intent | summary | child | adult, status: good | edited_then_use | regenerate, criteria, adminNote }`. 의도 `criteria`는 중심 주제·예화 구분·청중 적용·자막 밖 결론·반복 강조의 다섯 상태, 다른 scope는 빈 객체다. 메모는 선택적 2,000자 이하다. 대상은 같은 설교/quiz set의 봉인된 분석·요약·후보 revision이어야 하고 수정 후 사용은 실제 사람 edit revision이어야 한다. 응답은 `{ outcome: saved | replayed, review }`. 같은 요청 key/내용은 동일 결과를 반환하고 다른 내용의 재사용·오래된 버전은 거부한다.
- `GET /api/admin/sermons/:id/generation/:jobId`의 관리자 `quality` 맵은 표시된 snapshot별 최근 평가·메모·수정 revision·시각만 담는다. 비용/원문 자료와 별도의 평가이며 공개 응답에 포함하지 않는다. `regenerate` 평가는 같은 snapshot의 사람 confirm/review, 의도 대기 재개와 최종 검사/발행을 차단한다. 초기 의도 대기에서 새 분석은 기존 `POST /api/admin/sermons/:id/generation/content`에 `supersedesJobId`를 명시해 새 전체 요청으로 시작하고, 기존 결과·비용은 보존한다.
- 모든 관리자 생성 경로와 동일한 Access, `private, no-store`, same-origin JSON, 요청 크기, query/method 제한을 사용한다. 평가 저장은 AI dispatch를 만들지 않는다. [흐름](generation.md#p5-67-근거-검수사람-의도-확정-연결) · [검사](../work/P5-67.md).

### P5-70 보관 분석에서 후속 생성

`POST /api/admin/sermons/:id/generation/content`의 기존 strict 요청에 선택적 `recoveredAnalysisId`와 `recoveredCritiqueId`를 제공한다. 비판 ID는 분석 ID와 함께만 사용할 수 있다. `supersedesJobId`와 동시 사용은 거부한다. 같은 requestKey의 반복은 이 ID까지 동일해야 하며, 현재 입력/metadata/선택 분석과 검증된 복구 출처가 일치해야 한다. 성공은 기존 `{ jobId, dispatch }`이며 분석만 재사용하면 비판부터, 보관 비판까지 명시하면 추가 호출 없이 의도 검수부터 진행한다. 검증 거절은 기존 안전한 409 생성 오류 응답이다.

생성 조회의 선택적 nullable `recoveredAnalysisId`/`recoveredCritiqueId`는 현재 이어 쓸 수 있는 복구 분석에만 제공한다. 단순히 실패 job이 있다는 이유로 재사용을 허용하지 않는다. 사람 `review`/`resume`, 무료 배치/`finish`, 검수 후 `publish`는 기존 API를 사용한다. 로컬 시험 요청 도구는 품질/무료 배치를 허용하고 `localPublicationApproved === true`일 때만 로컬 publish를 허용한다. 이 값은 유료 AI 승인과 별개이며 기본 false다. 원격 URL·재취득·정리 경로는 허용하지 않는다. [생성 계약](generation.md#p5-70-복구-분석을-이용한-후속-생성).


### P5-71 관리자 콘텐츠의 분할 조회

기존 `GET /api/admin/sermons/:id/generation/content`에 선택적 `section=state|costs|content|activity|placement`를 받는다. 생략한 전체 응답은 기존 도구와의 호환을 위해 유지한다. 새 화면은 상태를 먼저 받고 비용·내용·생성 이력·배치를 독립 HTTP 요청으로 조회한다. 이력 `before`는 내용 요청에만 전송한다. 상태/비용 경로는 콘텐츠 BLOB, 생성 문맥, 격자 계산을 실행하지 않는다. 내용 조회는 배치 탐색을 실행하지 않고, 배치 조회는 비교 이력 페이지를 읽지 않는다.

실제 화면은 `parts=true`도 전송한다. `content`의 최초 응답은 작은 `snapshotIds` 목록이며 각 `snapshotId`를 같은 API의 독립 요청으로 읽어 사본 하나씩 합친다. `placement`는 `difficulty=child|adult`로 읽고 `layoutPart`의 두 난도를 합친다. snapshotId는 parts/content에만, difficulty는 parts/placement에만 허용한다. 이전 section/전체 응답 호환은 유지한다. 받은 사본은 먼저 표시하되 content 완료 전 편집을 잠그고, 두 격자가 모두 도착해야 미리보기를 완성한다. 상태/비용과 viewRevision은 한 SQL snapshot에서 읽고 그 외 부분은 조회 전후 버전을 확인한다.

분할 응답은 기존 관리자 자료형과 `viewRevision`을 사용한다. 클라이언트는 각 section에 해당하는 필드만 합친다. `state`의 빈 내용과 0 비용은 해당 자료를 아직 읽지 않은 자리값이며 비용 조회 완료 전 금액을 표시하지 않는다. 입력/content/metadata·품질·작업·배치·quiz 상태의 변경 표식을 조회 전후 검사하며, 응답 사이 표식이나 job/version/status가 다르면 합치지 않는다. 일부 요청 실패 시 받은 내용은 유지하고 편집을 잠근 뒤 사용자가 재조회할 수 있다. 화면 종료/다른 자료 이동 시 요청을 취소하고 자동 AI 재호출은 하지 않는다.

Access·private/no-store와 공개/비공개 자료형 경계를 유지한다. 수정·최종 완료·발행의 기존 전체 검증도 유지한다. 내용·배치 GET은 D-038의 저장된 표시 사본을 읽으며 원본 조각 복원·격자 탐색·자동 쓰기를 하지 않는다. 사본 누락/손상은 기존 `GENERATION_STATUS_UNAVAILABLE` 409로 반환한다. `section` 생략 응답도 같은 표시 경로와 저장 버전 재확인을 사용한다. 무료 CPU 한도 통과는 [P5-71](../work/P5-71.md)의 원격 실측으로만 판정한다.

### P5-71 기존 자료의 표시 준비

`POST /api/admin/sermons/:id/generation/:jobId/display-prepare`는 `{requestKey?: UUID}`만 받는다. 원문·격자·API key를 받지 않는다. Access·동일 Origin JSON·full v3 소유자를 확인하고 `CONTENT_DISPLAY_PREPARATION_ENABLED=true` 및 `CONTENT_DISPLAY_PREPARATION_SERMON_IDS`의 정확한 UUID 허용 목록을 요구한다. 기본값은 false/[]다. 성공은 202 `{outcome:"queued",requestKey}`이며 `display-<job digest>-<requestKey>`의 같은 Workflow를 재사용한다. 불명확한 create 응답은 그 실행의 상태를 읽어 확인하며 자동 재시작/AI 재호출을 하지 않는다.

`GET /api/admin/sermons/:id/generation/:jobId/display-preparation/:requestKey`는 Access·소유자·같은 비활성 경계를 확인하고 `{requestKey,outcome:"queued"|"running"|"prepared"|"failed"}`만 반환한다. Workflow 오류나 내부 원문/격자는 출력하지 않는다. 실패는 `DISPLAY_PREPARATION_UNAVAILABLE` 409다. 준비는 기존 불변 자료에서 표시 사본만 작성하며 생성 작업 상태·원문·호출/usage·발행을 변경하지 않는다. 공개 route와 관리자 화면의 새 조작 흐름을 추가한 것은 아니다.

## P8-01 운영 API의 실제 계약

모든 /api/admin 경로는 기존 Access를 재사용한다. 운영 API는 query를 허용하지 않고 읽기도 private, no-store다. 쓰기는 same-origin application/json·16KB와 strict Zod 경계를 사용한다. token·개인정보·SQL·private object key·download URL을 반환하지 않는다.

| 경로(/api/admin 아래) | 계약 |
|---|---|
| GET usage-summary | 서비스·scope·기간·갱신 시각·허용된 metrics/null·출처·상태·안전한 error, 한국 연월·정책 확인·가격 version, 기존 AI 원장의 월별 모델 관측. 공급자 호출·DB 쓰기 없음 |
| POST usage-summary/refresh | strict `{}`, 5분 cache·동시 lease, 읽기 전용 GraphQL/GET → snapshot. 실패 scope·조회 지연을 보존하며 원응답 저장 금지 |
| POST operations/monthly-check | 현재 yearMonth/pricingVersion, 10개 checkedServices, confirmation official_policies_reviewed. 한국 월·전체 서비스·version 일치 필수, 관리자 신원은 비공개 기록만 |
| GET backups | enabled·주간 verified 총수·최근 SQL32개와 최신 독립 manifest 상태·오류·크기·SHA 앞12자·독립 manifest 성공 시각. object key·bookmark·URL 없음 |
| POST backups | UUID requestKey·manual/pre_migration·confirmation export_may_pause_database. 활성 binding 필수, 같은 ID 접수 재생, 202 started/replayed. 미연결503·종류 충돌409. 복원 없음 |
| GET manual / manual/future/member-auth | Git 정본 Markdown·갱신일·로컬 검증 표시·환경·실제 version metadata(없으면 미연결). React text로 escape하며 HTML 실행 금지 |

공개 session·submission·삭제·연습·privacy 경로의 요청 제한은 [submissions7.4](submissions.md#74-멱등성과-속도-제한)를 따른다. 성공 재생과 개인정보·정답 분리 계약을 유지하며 수치 조회 실패를 0이나 여유로 바꾸지 않는다.
