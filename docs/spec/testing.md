> 현재 분야별 명세. 기존 implementation 19장 기준을 옮겼으며 구현 일지는 보관본으로 분리했다.
> [명세 목차](../../implementation.md) · [현재 상태](../STATUS.md) · [변경 전 원문](../archive/2026-09-21-p5-48/implementation.md#19-테스트-계획)

2026-10-01 구현·검수 근거와 알려진 기기 한계는 [P7B-01](../work/P7B-01.md)을 따른다. 자동 검사를 실제 OS 입력 검수로 간주하지 않는다.

## 19. 테스트 계획

### 19.1 단위 테스트

퍼즐:

- 5×5·6×6·8×8·10×10 각각의 경계 밖 placement 거부
- 교차 음절 불일치 거부
- 고립 답과 여러 연결 component 거부
- 의미 없는 인접 문자열 거부
- 크기·단어 수 profile별 교차 하드 게이트
- 동일 seed의 결정적 결과
- 확정 후보에서 가장 작은 통과 크기와 추천 문제 수를 재현 가능하게 선택
- 잠금 후보는 모든 추천 배치에 포함하고 제외 후보는 포함하지 않음
- 중복 답·중복 placement 거부
- public serialization에 정답 음절이 없는지 검사

한글 정답 표현:

- NFC 정규화
- 완성형 한글 한 음절 판정
- 독립 자모, 영문, 숫자, 이모지, 조합 미완료 값 거부
- grid answer 길이가 2 이상이고 선택한 grid size 이하인지 검사
- display answer의 내부 공백 제거가 grid answer와 일치
- 조사 포함 여부로 자동 탈락시키지 않음
- 정상 명사 끝 음절을 단순 조사로 오판하지 않는 사례

장절:

- 정식 책 이름과 모든 허용 별칭
- `~`, `-`, `장`, `절`, 공백 변형
- `요`, `요일`, `요이`, `요삼` 구분
- 존재하지 않는 장·절 거부
- 모호한 입력을 추측하지 않고 selector로 유도
- parser → selector → canonical JSON 왕복 일치

moderation:

- NFC/NFKC와 grapheme 길이
- `목 사`, zero-width 삽입, 구두점 삽입 예약어 우회
- 제어문자, bidi, URL, 이메일, HTML, Markdown, 줄바꿈 거부
- 비속어의 공백·반복 우회
- 정상적인 짧은 이름·코멘트 오탐 fixture
- 가로·세로 entry와 격자 행·열을 조합한 악성 답안 차단
- 정상 오답과 우연한 짧은 음절 조합의 오탐 fixture

채점:

- 교차 셀 한 번만 계산
- browser score 위조 무시
- correctness mask와 canonical cell order 일치
- 참여 현황의 실제 답안이 제출 원문과 일치하고 비제출 세션에는 반환되지 않음
- score basis points 반올림, 완전 정답 판정, Top N 제출 시각 순서

### 19.2 API·통합 테스트

- Turnstile 누락, 위조, 만료, 재사용 실패
- 같은 idempotency key 재시도는 같은 결과
- 같은 key의 다른 body는 conflict
- 다른 key로 동시에 이중 제출하면 한 건만 성공
- 같은 세션이 어린이·장년 각각 한 번 제출 가능
- 다음 주에는 같은 세션이 다시 제출 가능
- 완전 빈 답안은 거부하고 부분 답안은 허용; 추가 셀, 잘못된 cell ID, 16KB 초과 거부
- revision 변경 중 제출 거부
- `published + paused`, featured와 active submission 세트가 다른 상태에서 신규 제출 거부
- 저장 실패는 제출 횟수를 소모하지 않음
- 다른 Origin·content type 거부
- 숨김·해제·삭제 후 순위 재계산
- 삭제 후 같은 세션 재제출 차단
- Access 없는 관리자 API, 위조 JWT, 잘못된 issuer/audience 거부
- `wrangler.jsonc`에서 Static Assets navigation은 `index.html`로 fallback하고 `/api/*`는 항상 `biblequiz-app` Hono JSON으로 routing되며, asset·SPA navigation은 Worker invocation을 만들지 않음
- Preview/Production `DB`·`CONTENT_WORKFLOW` target·secret 이름이 교차하지 않고, `biblequiz-content`·`biblequiz-backup`은 `workers_dev = false`, preview URL 비활성, route/custom domain 없음
- `biblequiz-app` binding 환경에 `OPENAI_API_KEY`, `D1_REST_API_TOKEN`, `BACKUP_BUCKET`이 없고 `biblequiz-content`에는 R2/export token이 없으며 `biblequiz-backup`에만 R2/export token이 있음
- Production 트리거가 합의한 수동 release 승인을 따르고 `main`은 Preview만 갱신함. 향후 Production Builds를 연결하면 일반 코드 변경은 version upload까지만 수행하며 traffic/D1은 별도 승인. 최초 Worker 생성·DO 수명 변경의 deploy 예외는 주소 비공개·구체적 승인·복구 기준을 확인함
- 관리자 dashboard가 활성 미발행 작업 유무에 따라 `이번 주 퀴즈 만들기`와 `계속 작업하기` 상태를 정확히 반환하고 중복 주간 세트를 만들지 않음
- 설교일 후보는 유효한 제목 앞 `YYMMDD`/`YYYYMMDD`를 우선하고, 없으면 한국 시간 YouTube 게시일 기준 최근 주일, metadata도 없으면 작업일 기준 최근 주일을 사용함; 잘못된 날짜와 게시일 31일 초과 차이는 확인 경고
- 같은 설교일의 서로 다른 영상은 서로 다른 6자리 suffix와 slug로 생성되고, 같은 YouTube video ID 재입력은 기존 작업으로 안내되며, 발행된 slug는 표시 날짜 정정 뒤에도 바뀌지 않음
- 6단계 상태는 저장된 콘텐츠와 검증 결과에서 파생되며 클라이언트가 임의로 완료 처리할 수 없음
- 상위 단계 수정 시 이후 단계가 `다시 확인 필요`가 되고 과거 revision은 비교 가능하게 유지됨
- 첫 성공 제출 전에는 발행 내용 새 revision 교체와 발행 취소가 가능하고, 첫 성공 제출 직후 같은 요청은 `PUBLISHED_SUBMISSIONS_EXIST`로 거부됨
- 첫 제출 전 featured 발행 취소 시 새 세트는 `review_ready`가 되고, 다음으로 최신인 열린 published 세트가 featured로 바뀌며 그 세트의 기존 마감·제출 상태는 유지됨; 열린 세트가 없을 때만 archived 세트를 읽기 전용 featured로 사용
- 7일 안에 새 퀴즈를 발행해 두 세트가 동시에 published여도 각각 제출 가능하고, 새 발행이 기존 세트의 `closes_at`·제출·Top N을 바꾸지 않음
- `now >= closes_at`이면 scheduled finalization 전이라도 제출이 거부되고, scheduled/lazy/관리자 즉시 마감이 경쟁해도 Top N snapshot과 archive 전환은 한 번만 생성됨
- 마감 일시 변경은 사유·이전값·새값을 감사 로그에 남기고, 이미 제출이 있는 세트는 확인 절차 없이 변경되지 않음
- 첫 제출 후 표시 오탈자 수정은 허용 필드만 바꾸고 수정 전·후·사유를 감사 기록에 남기며 정답·격자·채점 hash가 그대로임
- 정답·격자·단서 의미 변경을 표시 오탈자 API로 요청하면 `SEMANTIC_CORRECTION_REQUIRED`로 거부됨
- 문제 오류 처리 시작 시 접수가 중지되고, 수정본 검증 실패 동안 기존본·수정본 어느 쪽에도 신규 제출이 저장되지 않음
- 미발행 문제 오류 correction이 남아 있으면 일반 접수 재개가 거부되고, correction 취소 시 감사 사유를 남긴 뒤에만 재개 가능
- 수정본 발행 트랜잭션이 기존 variant를 `superseded`, 새 variant를 `active`로 바꾸며 활성 variant가 난이도별 하나뿐임
- 진행 중 수정본 발행 화면은 기존 마감과 남은 시간을 기본값으로 표시하고, 마감 연장은 확인·감사 기록을 거치며 자동으로 새 7일을 부여하지 않음
- 수정 작업 중 마감이 지나거나 마감 후 오류가 발견되면 제출·순위를 다시 열지 않고 기존 결과를 무효 표시하며, 정정 variant의 풀이·채점 결과는 submission·참여 현황·Top N에 저장되지 않음
- 오류본 제출은 재채점·이전되지 않고 기존 제출 세션에서 당시 결과를 확인할 수 있으며, 수정본에는 같은 세션이 새로 한 번 제출 가능
- `superseded` 오류본과 그 참여 현황·Top N은 일반 archive·Top N 출력에서 제외되고 관리자·해당 제출자 경로에서만 조회됨
- 부분 재생성은 선택 scope만 바꾸고 나머지 부모 revision snapshot을 보존
- 과거 revision 복원은 기존 행을 덮어쓰지 않고 새 revision 생성
- 자막 다시 가져오기·provider 변경·수동 source 교체는 기존 raw text/checksum을 바꾸지 않고 증가한 `source_revision`의 새 행을 생성하며, 새 source도 사람 확정 전에는 의도 분석에 사용할 수 없음
- 현재 AI revision 평가가 `regenerate`이면 해당 scope 확정·발행이 거부되고, `edited_then_use`는 실제 수정 revision 연결 없이는 저장·발행되지 않음
- 관리자 수동 재생성 누적 횟수로 API·버튼이 차단되지 않음
- 일반 퀴즈 API가 정답·제출 답안·내부 근거·secret을 반환하지 않음
- 제출 전/후 solution endpoint와 참여 현황 response 차이
- 미제출 세션의 `/board`는 `SUBMISSION_REQUIRED`; 현재 퀴즈의 `/top-n-export`도 같은 오류로 차단
- archived의 정답·참여 현황·확정 Top N·`/top-n-export`는 연습 check 없이 공개
- archived 연습 check는 현재 제출 결과와 같은 형식의 점수·correctness mask·정답을 반환하지만 어떤 access grant도 만들지 않고 submission·참여 수·Top N 구성도 변경하지 않음
- archive 순간 Top N snapshot이 제출 시각순으로 고정되고 이후 연습 결과가 포함되지 않음
- archive가 설교일 최신순으로 정렬되고 같은 날짜의 cursor pagination에서도 중복·누락이 없음
- 제목·성경 장절 부분 검색과 연도·월 조합 필터가 일치하며 잘못된 filter는 거부됨
- archive 목록 응답에 정답·실제 참여 답안·관리자 정보가 포함되지 않음. 개별 archived 퀴즈의 공개 solution·board는 각각의 전용 endpoint에서만 반환됨
- snapshot 구성원 hide/delete 시 해당 순위가 빠지되 차순위자가 자동 승격되지 않음
- `/top-n-export`에는 완전 정답자만 있고 오답·부분 답안·코멘트·세션 식별자는 없음
- 제출 답안의 entry 경계·행·열 악성 문자열 차단과 관리자 숨김 즉시 반영
- `winner_count` 1·3·5·10에서 완전 정답자만 정확히 선정
- Top N 전환 후 오답·부분 답안 카드는 사라지고, N위 밖을 포함한 모든 완전 정답자 카드는 제출 순서대로 남음
- 개인화 응답이 CDN cache를 통해 다른 사용자에게 섞이지 않음
- prepared statement로 SQL injection 문자열 처리
- rate limit 후 `429`와 `Retry-After`
- `biblequiz-app`은 공개 URL이나 service binding이 아니라 `CONTENT_WORKFLOW` 내부 binding으로 `biblequiz-content`의 Workflow만 시작하며, 대상 Worker에는 공개 URL·일반 fetch endpoint가 없고 OpenAI secret은 호출자 환경에 없음
- D1 export의 polling bookmark가 완료될 때까지 재시도되고, 제한 token 누락·권한 부족·signed URL 만료를 구분하며 token·signed URL은 모든 응답·로그에서 redaction됨
- D1 export 중 query 일시 실패에는 안전한 재시도 안내와 requestId를 반환하고 미제출 격자 local draft가 유지됨
- backup upload 실패·checksum 불일치에서는 기존 정상 8개를 삭제하지 않고 실패 상태를 기록
- 검증된 9번째 backup 성공 뒤 가장 오래된 정상본 하나만 회전되어 항상 8개 유지
- backup bucket public URL 접근 실패, `biblequiz-app`·공개 API에 R2 binding/object key가 노출되지 않음
- 삭제 tombstone manifest가 과거 backup 복원 fixture에 재적용되어 삭제된 이름·답안·코멘트가 다시 공개되지 않음
- R2·D1·Workers·Workflows metric 정상/지연/실패 fixture와 계정 전체·프로젝트 사용량 구분
- 50%·80% 상태, 24시간 metric stale, 매월 1일 policy reminder가 한국 시간 기준으로 정확히 계산되고 provider 오류를 `여유`로 오표시하지 않음
- `이번 달 확인 완료`는 같은 연월의 policy reminder만 다음 달 1일까지 숨기며 사용량·비용·metric·backup 경고는 숨기지 않음
- 예상 R2 account 사용량이 80%를 넘는 fixture에서는 새 backup을 건너뛰고 기존 8개와 경고를 유지
- OpenAI AI usage event의 quiz set·월 합계가 기존 비용 drawer와 통합 dashboard에서 일치하고 metric 경고가 재생성 버튼을 막지 않음

### 19.3 자동 브라우저 E2E

Playwright의 매 변경 핵심 경로:

- 새 세션에서 어린이·장년 퀴즈 열기와 난이도 전환
- 한글 입력, Tab, 모바일 다음 칸 버튼, 일부 빈칸 제출
- 완전 빈 답안 제출 차단과 부분 답안 제출 성공
- 현재 퀴즈는 제출 전 정답보기·참여 현황·Top N·`Top N 출력` 비노출, 제출 후 노출
- 현재 퀴즈 제출 직후 내 답안 격자에 맞음·틀림·빈칸을 색 외의 기호까지 포함해 표시하고 내 답안/정답 격자를 즉시 비교; 재방문 때는 `정답보기`로 같은 화면 복원
- Everforest 라이트와 Gruvbox 다크에서 본문·버튼·focus·정오·오류 상태가 WCAG 2.2 AA 대비를 통과하고 테마 전환 뒤 레이아웃이 변하지 않음
- 참여 현황의 실제 제출 격자와 Top N 전환·정렬
- 현재 퀴즈의 미제출 세션이 보호 API를 직접 호출해도 차단; 지난 퀴즈의 공개 API는 세션 없이 성공
- 빈 격자 PNG 공개 생성과 단서 텍스트 복사, 현재 퀴즈 제출 세션의 Top N PDF 생성, 지난 퀴즈 비로그인 Top N PDF 생성
- 관리자 Access mock 아래 초안 작업 시작·진행·실패·검토 준비 화면
- 관리자 첫 화면에서 활성 작업 복원, 초안 삭제 예정·문의·제출 기록 관리 정보, 최근 발행 목록 확인
- 관리자 `비용·사용량` 요약과 drawer에서 서비스별 plan·사용량·포함량·예상비·갱신 시각을 route 이동 없이 확인하고 stale/주의 상태를 색 외의 문구로 구분
- 최근 8개 backup의 시각·크기·checksum·성공 상태는 보이지만 restore 버튼과 object URL은 없음
- `/admin/manual`은 Access 밖에서 차단되고, 서비스 사전·기능 지도·등록 절차·월간 체크·변경 기록이 키보드와 모바일에서도 탐색 가능
- service registry fixture의 서비스 하나를 manual/dashboard에서 누락시키면 CI가 실패하고, 안전한 시스템 정보 복사 결과에는 secret 값·개인정보가 없음
- 발행 직후 제출 0건에서는 `발행 내용 수정 / 발행 취소`, 첫 제출 뒤에는 `표시 오탈자 수정 / 제출 일시 중지 / 문제 오류 처리`로 버튼이 전환됨
- 첫 제출 전 featured 발행 취소 뒤 다른 열린 퀴즈가 있으면 그 퀴즈가 계속 제출 가능한 featured가 되고, 없으면 직전 archived 퀴즈와 `새 퀴즈를 준비하고 있습니다`가 제출 버튼 없이 보임
- 새 퀴즈 발행 뒤 기존 퀴즈가 `아직 참여할 수 있는 퀴즈`에 남고 각 퀴즈의 마감 countdown·제출 권한이 독립적으로 동작함
- 첫 제출 뒤 오류 처리에서는 접수 중지 안내, 수정본 미리보기·검증·발행, 기존 제출자의 오류본 결과 확인, 수정본 재참여가 route 오작동 없이 이어짐
- 오류본은 archive와 `Top N 출력`에서 나타나지 않고 수정본과 정상 archived 기록만 보임
- 작업 도중 route 이동·브라우저 재접속 후 동일한 6단계와 실행 상태가 복원됨
- 모바일 관리자 화면에서 상태 확인·문의 답변·숨김이 가능하고 복잡한 편집 안내가 기능을 차단하지 않음
- 후보 확정 뒤 코드가 추천 격자 크기·문제 수를 제안하고 관리자 override가 가능
- `이번 주 AI 예상 비용` drawer의 모델별 소계·전체 합계와 route 미변경
- archived 퀴즈는 풀이 전에도 정답·참여 현황·코멘트·확정 Top N·`Top N 출력` 공개; 선택적으로 연습 풀이→현재 사용자와 동일한 정오 비교 화면 확인
- 당시 제출 세션은 archived 뒤에도 기존 결과·참여 현황·확정 Top N·출력 접근 유지
- 메인에는 최근 지난 퀴즈 3개만 보이고 `/archive`에서 12개씩 `더 보기`가 route 이동 없이 이어짐
- archive 검색·연도·월 조건이 URL에 유지되고 뒤로가기로 목록·펼친 개수·scroll 위치가 복원됨
- 검색 결과 없음에서 `찾는 지난 퀴즈가 없습니다`와 조건 초기화가 동작

기본 CI는 Chromium으로 실행한다. UI·IME·출력 변경 시 WebKit과 Firefox를 추가하고, 핵심 viewport screenshot은 의도된 디자인 변경일 때만 명시적으로 기준 이미지를 갱신한다. E2E는 Preview/Production D1이 아니라 격리된 local test DB와 fixture를 사용한다.

### 19.4 실제 한글 IME 수동 행렬

다음은 실제 한글 키보드의 검수 대상 행렬이다.

**P7B-01 종료 기준(2026-10-01 사용자 승인):** 입력 계약이 바뀌지 않은 Windows Chrome/Edge·iPhone의 기존 실제 검수 증거를 재사용하고, 이번 모바일 viewport 보정은 노트10+ Chrome의 실제 입력·회전 후 글자 보존·선택 칸 재터치/키보드 위 표시 결과로 확인한다. 이 보유 기기 결과와 필수 검사로 P7B-01을 완료한다. 기기 없는 macOS와 개별 Android 브라우저/키보드 조합은 미검수 한계로 기록하며 이번 작업 종료의 추가 게이트로 삼지 않는다. 지원 대상 삭제나 미검수 조합의 통과 판정은 아니다. 이후 입력 계약 변경 또는 실제 결함 재현이 있을 때 영향받는 조합만 다시 확인한다.

| OS/기기 | 브라우저·키보드 |
|---|---|
| Windows 11 | Chrome, Edge, Microsoft IME |
| macOS | Safari, Chrome, macOS 두벌식 |
| Android | Chrome + Gboard |
| Samsung Android | Samsung Internet/Chrome + 삼성 키보드 |
| iPhone/iPad | Safari + iOS 두벌식/천지인 사용 가능 범위 |

필수 입력 사례:

- `감`, `값`, `갑세`
- 받침 뒤 다음 초성 재조합
- 셀 중간 수정과 Backspace
- 교차 셀 방향 변경
- 여러 음절 붙여넣기(데스크톱 `Ctrl/Cmd+V` 필수, 모바일은 운영체제가 메뉴·이벤트를 제공하는 경우만 확인하며 iPhone 길게 누르기는 통과 조건 아님)
- Tab/Shift+Tab과 모바일 이전/다음
- 조합 중 난이도 전환·포커스 이동 방지
- 화면 키보드로 격자가 가려지지 않음

### 19.5 반응형·접근성 테스트

- viewport: 320, 360, 375, 768, 1024, 1440, 1920px
- portrait/landscape 회전
- 200% browser zoom
- light/dark/system과 새로고침 상태
- 기본/크게 보기와 난이도별 상태
- 키보드 전용 탐색, focus 표시, tab 순서
- 스크린리더의 셀 좌표·번호·방향·오류 안내
- 색각 이상 simulation과 AA 대비
- reduced motion
- 참여 현황 → Top N 전환 시 카드 탈락·재배치, reduced motion에서는 즉시 전환
- 축하 일러스트가 격자·이름·조작 버튼과 겹치지 않음
- 긴 설교 제목·긴 단서·가장 긴 허용 이름/코멘트

### 19.6 출력 테스트

- 어린이/장년 빈 격자 이미지와 복사 단서에 정답이 없음
- 빈 문제 다운로드에 내비게이션·버튼·입력 커서·배경 사진·페이지 바깥 여백이 없고 정확한 export 영역만 포함됨
- QR이 실제 영구 URL을 열음
- 1600×1600 PNG의 시작 번호와 격자 선명도, 주보 축소 배치 시 판독성
- `빈 격자 받기`에서 어린이용·장년용·둘 다 PNG가 올바른 파일명으로 한 번에 내려받아짐
- `문제 텍스트 복사`가 `[가로]`·`[세로]` 번호와 단서를 누락 없이 plain text로 제공하고 한글·Word 붙여넣기 후 편집 가능
- A4 2480×3508 및 PDF page size
- 브라우저 print preview에 내비게이션·버튼·URL용 UI·스크롤바가 없음
- PDF의 글자·격자선이 확대해도 선명하고 한글 폰트가 대체되지 않음
- `Top N 출력` 한 번으로 A4 PDF가 생성되고 웹 머리글·바닥글이 존재하지 않음
- Chrome·Edge·Safari에서 생성한 PDF의 페이지 크기·폰트·도형 비교
- 공용 축하 일러스트의 화면용·인쇄용 파생본이 같은 디자인이고 인쇄에서 픽셀화되지 않음
- 참여자 0, 1, 3, 4, 9, 13, 50명 페이지 분할
- 완전 정답자만 Top N 후보가 되고 제출 시각순으로 잘리는지 확인
- 현재 퀴즈의 비회원 제출 세션과 지난 퀴즈의 모든 방문자에게 `Top N 출력` PDF 생성 허용; 현재 퀴즈 제출 전에만 버튼 숨김과 API 차단
- 숨김·삭제 참가자 제외
- Top N 벽보에는 완전 정답자만 포함, 코멘트 기본 제외, 숨김·삭제 답안 제외
- Windows/macOS 인쇄 미리보기

### 19.7 성경·콘텐츠 검증

v1 `reference_only` 필수 검사:

- 66권 책·장·절 metadata와 선택 범위의 첫 절·마지막 절·절 수 검증
- 자연어 파서와 selector가 같은 canonical reference를 만들고 `개역개정`·대한성서공회 공식 읽기 링크를 표시
- DB·공개 API·HTML·PNG·PDF·AI request payload에 성경 본문 전문이 없는지 contract test

향후 허가형 본문 전문 기능을 별도 승인해 추가한 경우에만 실행하는 검사:

- 승인 원본 파일 SHA-256 재계산과 import report
- 원문과 D1 text의 byte 또는 명시된 encoding-normalized 비교
- 판본명, 출처, 필수 attribution 노출
- `allowed_web/archive/png/pdf` 중 하나라도 false면 해당 산출물 차단
- 성경 본문이 AI request payload에 없는지 contract test

모든 모드의 설교 콘텐츠 검사:

- AI 요약 고지 문구 누락 시 발행 차단
- 자막 checksum과 근거 구간 확인
- 수동 한국어 자막 우선, 없으면 한국어 자동 자막 선택; 임의 번역 track 거부
- `TRANSCRIPTS_DISABLED`, `KOREAN_TRANSCRIPT_NOT_FOUND`, `TRANSCRIPT_SOURCE_BLOCKED`, `TRANSCRIPT_FORMAT_CHANGED` 구분
- signed caption URL·전체 player 응답이 로그와 관리자 공개 오류에 포함되지 않음
- 자막 원본은 사람 수정·AI 교정·모두 수락 후에도 byte와 checksum이 바뀌지 않음
- AI 교정 결과는 수정된 문서 한 벌로 제공하며, 원본과 구분해 사람이 검토·수정·채택함. 시간 정보는 원래 자막과 연결되고 설교 내용을 임의로 추가하지 않음
- 과거 항목별 제안/수락 이력은 보존하며 새 교정 문서 결과와의 호환 경계를 확인함. 교정 이유/confidence/risk 보고를 신규 LLM 출력의 필수 조건으로 두지 않음
- 사람 직접 수정 뒤 AI 교정을 한 번도 호출하지 않고 같은 화면의 `자막 확정`으로 확정할 수 있으며 미저장 변경도 유실되지 않음
- 교정 프롬프트에 성경 인명·지명·신학 용어·숫자·부정 표현과 원래 의미의 보존을 명시하고 사람이 결과를 확인함. 별도 항목별 위험 보고를 기본 생성 요구로 만들지 않음
- 미확정 자막에서는 의도 분석 API와 UI가 모두 차단됨
- 확정 자막을 다시 수정하면 의도·요약·문제가 `다시 확인 필요`가 되고 이전 결과는 비교용으로 보존되며 재확정 전 발행이 차단됨
- 이후 모든 의도·요약·문제 AI 요청이 raw가 아니라 현재 `confirmed_transcript_sha256`와 일치하는 확정본을 사용함
- 의도 분석·요약·각 문제의 timestamp 근거가 실제 자막 범위 안에 있음
- `근거 확인 필요` 항목이 숨겨지거나 임의 신뢰도 백분율로 변환되지 않음
- 최종 발행에 선택된 AI revision과 관리자 identity가 기록됨
- `ai_usage_events`의 건별 합, 모델별 소계, quiz set 총계가 일치하고 재시도/idempotency로 중복 과금 표시되지 않음
- 발행 기초본을 포함한 모든 revision은 발행 7일 뒤 삭제되고 정식 퀴즈 데이터·최소 provenance는 유지
- 미발행 revision은 마지막 활동 7일 뒤 삭제되고 그 전에 수정하면 `purge_after`가 갱신

### 19.8 성능 예산

- React SPA의 route·기능별 코드를 분할하고 첫 퀴즈 화면에 필요하지 않은 관리자·출력 bundle은 지연 로드한다.
- resvg/pdf 코드는 출력 route에서만 지연 로드하고 일반 퀴즈 bundle에 포함하지 않는다.
- hero 이미지는 기기별 적정 크기와 modern format을 사용한다.
- archive 목록 이미지는 lazy load한다.
- 3G 수준에서 입력 UI가 이미지 때문에 막히지 않아야 한다.
- 실제 목표 수치는 첫 구현의 Lighthouse/Web Vitals baseline을 측정한 뒤 CI budget으로 고정한다.


### P5-71 요청·응답 보관과 원격 한도 검증

- 요청 저장 실패 전송 0, 같은 호출 ID의 재시작/중복 전송 0, 헤더/key 미보관을 확인한다.
- 거절/깨진 JSON의 원 바이트, usage, 큰 요청의 chunk를 새 reader로 회수한다. 누락/손상/정리 경합은 회수 성공으로 표시하지 않는다.
- 응답 보관 실패에서도 관측 usage는 먼저 보존하고 내용 채택/다음 호출을 중단한다. 승인된 기존 초안 정리 후 원문 재생성과 늦은 저장을 차단한다.
- 로컬 통신 제한 검사와 실제 원격 CPU를 구분한다. native exceededCpu가 발생하면 추가 시험을 중지하고 자료를 보존한다. tail의 invocation CPU를 개별 step CPU로 표시하지 않는다.
- 기존 migration의 전송 표현식 보정은 원본 SHA와 전송 SHA를 구별하고 동등성·기존 행·FK를 확인한다. 새 migration이 과거 복구 CLI의 승인 범위에 자동 포함되면 실패다.

P5-71 무료 CPU 수정 검사는 UTF-16 전 코드 단위/서로게이트의 UTF-8 길이 동등성, 중첩 문맥의 정확한 byte 경계, D1 hex 전송의 전 바이트 왕복·잘못된 형식/크기 거절, 캐시의 큰 BLOB 미보관·원문 무손실 반환, 기존 lifecycle 손상/동시 변경/완료 검사를 포함한다. 원격 CPU 판정과 분리한다.

표시용 읽기는 기존 전체 검증 reader와 같은 선택 결과/버전을 보여주며 소유자 불일치와 손상된 byte를 거절해야 한다. 입력 교체 후 이전 결과의 비교 표시와 재사용 금지를 함께 유지한다. 정상 두 자료와 실패 자료의 저장 사본에서 이전 Preview 응답과 표시 내용·검수·배치·비용을 비교한다. 표시 함수는 DomainBasis/witness를 반환하지 않으며 발행·복구·품질/metadata 변경 회귀 검사를 함께 통과해야 한다. 최초 조회와 이후 조회 CPU를 모두 남기며 가장 빠른 표본만 무료 한도 통과 근거로 사용하지 않는다.

P5-71 Cloudflare 최종 검사 전용 Workflow는 기존 5개 응답을 재사용해 완료하며 같은 requestKey의 POST가 같은 실행을 유지해야 한다. Access 없음/다른 소유자/외부 Origin을 거절하고 Workflow 출력의 비공개 추가 필드를 노출하지 않는다. 실제 Workflow 검사에서 원래 생성 작업까지 완료·응답 5건 불변·미발행을 확인한다. 데스크톱/모바일 브라우저에서는 202 뒤 running→review_ready 조회, 완료 대기 중 버튼 비활성·POST 1회, 기존 동기 경로를 함께 확인한다. 이 기능 검사의 성공과 무료 CPU 한도 충족은 별도로 기록한다.


### P5-71 분할 조회와 순차 표시

- 상태·비용 요청이 콘텐츠 BLOB·생성 문맥·격자 탐색을 실행하지 않는지 확인한다. 내용 응답은 배치를 계산하지 않으며 배치 응답은 중복 본문을 반환하지 않는다.
- 부분 응답을 합친 결과가 기존 전체 응답과 같은지 정상 두 크기와 실패 자료로 대조한다. 기존 소유자/SHA 손상 거부·AI 재호출 방지를 유지한다.
- 별도 품질 평가처럼 content version이 늘지 않는 변경도 `viewRevision`에 반영되고, 브라우저가 서로 다른 시점의 응답을 합치지 않는지 확인한다.
- 실제 브라우저에서 느린 배치를 기다리는 동안 내용·비용 표시, 부분 실패 시 받은 내용 보존·편집 잠금·명시 재조회, 화면 종료 시 요청 취소를 확인한다. 로컬 브라우저 성공과 원격 native CPU를 구별한다.

### P5-71 저장된 내용·격자의 재사용

- 검증된 생성/편집/배치 선택/최종 완료와 표시 사본이 같은 거래에서 저장되고 실패 시 함께 롤백되는지 기존 쓰기·발행·정리 회귀 검사로 확인한다. 원본 SHA/출처 검사를 표시 사본으로 대체하지 않는다.
- 완료된 자료의 content/placement GET을 반복하면서 원본 input/content/context/ticket 조각 읽기, 격자 탐색, DB 쓰기가 0인지 확인한다. 사본 누락은 명시적으로 실패하고 격자 재계산으로 우회하지 않아야 한다. 소유자 불일치·사본 SHA 손상·입력/metadata/선택/품질 변경에 대한 거부/미리보기 무효화를 확인한다.
- 기존 자료 준비의 flag·정확한 허용 목록·Workflow ID·중복 요청·비공개 출력 경계를 확인하고 원래 완료 proof의 preview fingerprint와 같은 결과만 준비 완료로 처리한다. 검증된 Workflow 경로의 단계 목록과 모든 원래 앱 표·행 보존, AI transport 0을 검사한다.
- `node scripts/p5-71-verify-display-reuse.mjs --local-existing-copy <영속 시험 폴더>`는 저장된 `after-split-reads.sql`과 기존 세 응답을 메모리 DB에서 비교한다. 0036 사본 준비 후 기존 전체 응답/다섯 부분의 재조합을 대조하고 원래 schema/행·SQLite 순번·FK/quick_check를 확인한다. 원격/실제 로컬 DB/원본 파일/credential을 사용하거나 변경하지 않는다.
- 새 원격 적용은 구체적 승인 뒤 같은 Preview의 0036·app/content 배포·기존 세 자료 준비와 읽기 CPU 측정으로 묶는다. 첫/후속 표본과 요청 구간 대응을 남기고 Workflow invocation CPU를 개별 step CPU로 환산하지 않는다. 이전 배포/읽기 승인을 새 migration/배포/사본 작성의 승인으로 확대하지 않는다.

표시 격자는 난도별 저장 reader에서 원래 geometry schema로 검사한다. 응답 조합은 같은 격자의 구조를 Zod로 검사하되 preview와 reviewLayouts를 만들기 위해 geometry를 반복 계산하지 않는다. 올바른 사본 SHA를 다시 붙인 잘못된 geometry도 placement GET이 거절하는 회귀 검사를 유지한다. 공개/생성/발행의 완전 검증 schema는 그대로다.

내용 목록→개별 사본과 어린이/장년 격자를 독립 요청으로 읽어 이전 전체 결과/비용과 정확히 같음을 정상 두 크기·실패 자료로 확인한다. manifest가 있어도 사본 손상/누락을 통과시키지 않는다. 부분 도착/버전 변경/취소/실패 시 먼저 받은 자료·편집 잠금과 자동 AI 호출0을 실제 브라우저로 확인한다. Access 공개키 재사용에서도 변조된 JWT를 거절하고 새 kid·TTL·no-store·갱신 실패를 검사한다. 첫 요청부터 native 표본을 요청별 CF-Ray 해시와 정확히 대조하고 초과 표본을 제외하지 않는다. 최신 결과는 P5-71 검증 JSON을 따른다.

## P8-01 로컬 운영 검사

백업·사용량 Worker 검사는 합성 D1·R2와 native local RateLimit을 사용한다. 정상본8개 보존·아홉 번째 주간 회전·미연결·80%·손상·빈 파일·같은 ID·Cron·누적 삭제 manifest·Access·동일 출처·cache/stale·한국 월·공급자 개인정보/URL 차단을 검사한다. callback 모의 실행과 실제 Workflow checkpoint·원격 CPU는 구분한다.

`node scripts/check-isolated-backup-restore.mjs`는 인자 없는 합성 전용 검사다. /tmp의 격리 D1 두 개에만0000~0038을 적용한다. SQLgzip·checksum·schema/data/index/trigger·삭제 재적용 gate·멱등성·원본 불변·FK/quick_check를 확인하며 원격 복원 성공으로 표현하지 않는다.

관리자 비용·매뉴얼의 Chromium PC/모바일 검사는 `pnpm exec playwright test --config playwright.p8-local.config.ts --project=chromium --project=mobile-chromium`이다. 정책 확인 후 실제 경고 유지·drawer 키보드/폭·HTML escape를 확인한다. 기존 IME·PDF 실제 검사는 반복하지 않으며 필수 pnpm check는 수행한다. 원격 권한·자료가 없는 metric은 미확인으로 표시한다. Production·새 원격 연결은 구체적 승인 뒤 검수한다. [결과](../work/P8-01.md).

## P8-02 배포 준비·승인 후 출시 검사

합의 전 문서/후보 준비는 diff·로컬 링크·기존 config guard·소스/기존 자료 보존과 후보의 strict dry-run을 확인한다. 후보 검사는 합성HTML/로컬 번들만이며 Production 화면·원격 권한·무료 청구 완료가 아니다. 제품 소스가 같은 P8-01의 pnpm check·격리 복원·입력/PDF 결과를 재사용하고 반복하지 않는다. 실제 배포 단위 완료 전에는 최종 설정·소스에 pnpm check와 관련 검수 결과가 필요하다.

[실행·중지·출시 행렬](../work/P8-02.md#남은-같은-p8-02-실행출시-조건)에 따라 Preview0037/0038과 새 빈 Production0000~0038을 구분하고, 별도 환경/자원·version·SQL/산출물 SHA·백업/삭제 manifest·Access/Turnstile·공유망 제한·대표 실제 사용자/운영 경로를 확인한다. 2026-10-02 사용자 승인은 실제 서버 준비·연결·배포/공개까지 포함하며 새 AI/유료 전환은 제외한다. all-traffic에서 관리자 path 보호로 전환할 때 관리 경계가 열린 틈이 없어야 한다. 설치/실제 콘텐츠/AI·상시 운영 활성화/공개 범위는 구체적 승인 묶음에 고정한다. 알려진 기기·지표 미확인 한계는 유지하며 전체 release 조건을 만족하기 전 P8-02/v1을 완료로 처리하지 않는다.
