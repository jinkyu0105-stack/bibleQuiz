# P4-23 운영 입력·환경 승인안

> 작성·공식 자료 확인: 2026-09-07, Asia/Seoul
> 현재 상태: P4-23 완료. Preview widget/runtime 6개·DB 0000~0006·Access 보호·실제 Turnstile/세션/부분 제출/채점/결과/참여 현황/본인 삭제/재방문과 D1 후검사를 완료했다.
> 후속 게이트: 실제 교역자 이름·추가 금지 목록은 Phase 5 관리자 화면에서 관리하고, route별 요청 제한은 무료 범위·공유망 오차단을 확인해 Production 공개 전에 구현한다. P4-23에서 실제 정책 데이터·Production 자원은 변경하지 않았다.
> 아래 날짜별 저장·승인 대기 서술은 당시 기록이며 이미 완료한 설정 입력/DB 적용을 반복하지 않는다.
> 정본 정책: [implementation](../implementation.md) 7.2~7.8·13.4~13.6·14.6·17장, [DECISIONS](DECISIONS.md) D-005·D-007·D-018·D-024·D-025

## 1. 먼저 받을 사용자 입력

| 입력 | 필요한 내용 | 현재 상태·권장안 |
|---|---|---|
| 자료 제공·최종 검수 담당 | 운영자 본인이 둘 다 담당하는지, 별도 검수자가 있는지. 문서에는 역할만 기록 | 미확정 |
| 보호할 실제 이름 | 보호 대상별 실제 이름, 차단할 직함 결합·별칭을 명시한 목록. 대상이 없으면 `없음`, 나중이면 `보류`를 구분 | 사용자 보류. 2026-09-07 지금 입력하지 않고 후속 관리자 화면에서 제어하는 방안 검토 요청. 기존 저장/읽기 구조는 있으나 관리 UI/API는 아직 없음 |
| 금지 문구 | 문구별 적용 위치(이름/코멘트/답안/전체), 완전 일치/포함 일치, 차단 이유, 반드시 허용할 정상 예문 | 사용자 보류. 후속 관리자 화면에서 추가·비활성화·시험하는 기존 명세를 Phase 5 필수 범위로 명시하는 안 검토 중 |
| 허용 예외 | 실제 오탐 문구, 적용 위치, 허용 이유 | 초기 0건 권장. 오탐 재현 후 필요한 exact 예외만 추가하는 제안 |
| 비공개 자료 전달·보관 | 사용자 관리 비공개 원본 파일의 경로 또는 별도 안전한 전달 방법, 보존·폐기 방식 | 미확정. 실제 인물 목록·민감 문구·개인 이메일을 이 문서/Git/test fixture에 복사하지 않음 |
| 연결 순서 | 연습용 Preview에서 먼저 사람 확인 기능 시험 | 사용자 동의(2026-09-04). 실제 설정·배포는 단계별로 따로 확인한다는 안내에 대한 동의. Production 보류 |

기본 예약명 10개(`다사랑교회`, `관리자`, `운영자`, `admin`, `official`, `목사`, `목사님`, `담임목사`, `전도사`, `교역자`)는 이미 서버 코드에 있다. 재등록이나 재승인할 필요가 없다. 추가 목록이 비어도 기본 예약명·형식·연락처 검사는 동작하지만, 실제 인물과 실제 악성 문구를 보호한다고 볼 수 없다. 빈 정책 자체는 서버에서 유효하므로 운영 게이트 완료와 혼동하지 않는다.

실제 이름만 나중에 정하기로 했으며, 보호가 불필요하다는 결정이나 출시 게이트 해제는 아니다. 명단을 제공하기 전에는 실제 인물 이름·별칭에 대한 추가 보호가 없고 기존 일반 명칭 차단을 유지한다. 이름을 지금 다시 요구하지 않으며 다른 운영 항목은 쉬운 말로 하나씩 안내한다.

## 2. 등록 전에 검수할 자료 형태

사람은 원문·목적·예상 허용/차단을 제공하고, 에이전트는 기존 함수로 정규화값과 중복을 검사한다. 사용자에게 정규화값이나 ID를 직접 계산하게 하지 않는다. 아직 실제 입력 파일·seed SQL·데이터는 만들지 않았다.

| 종류 | 등록안에 필요한 필드 | 현재 구현의 주의점 |
|---|---|---|
| 예약 이름 | `id`, `protected_group_id`, `display_label`, `normalized_value`, `category`, `enabled`, `created_by`, 생성/수정 시각 | 같은 사람의 별칭을 그룹으로 묶되 각각 명시. 이름에서 정규화 exact만 검사하며 코멘트·답안에는 적용하지 않음 |
| 금지 규칙 | `id`, `scope`, `normalized_pattern`, `match_mode`, `enabled`, `created_by`, 생성/수정 시각 | `scope=name/comment/answer/all`, `match_mode=exact/contains`. 사유·출처·검수 결과는 비공개 검수 자료에 보존 |
| 허용 예외 | `id`, `scope`, `normalized_value`, `reason`, `enabled`, `created_by`, 생성/수정 시각 | `scope=name/comment/answer`, exact만 지원. 해당 문구·scope의 모든 term 검사를 건너뛰므로 효과를 함께 검수 |

- 예약명은 `normalizeReservedName`, 규칙·예외는 `normalizeModerationValue`를 사용한다. NFKC·소문자화·구분자 제거, 규칙/예외의 3회 이상 반복 축약으로 서로 다른 원문이 같은 값이 될 수 있다. 충돌을 자동 덮어쓰지 않는다.
- 세 표 사이에도 ID 중복이 없어야 한다. 예약명과 예외의 정규화값은 각각 표 전체에서 UNIQUE이고, term은 `(scope, pattern, match_mode)` 조합이 UNIQUE다. 같은 예외값을 여러 scope에 중복 등록하는 것은 현재 schema가 허용하지 않는다.
- 예외는 예약명·형식·연락처 차단을 해제하지 않는다. `all + contains`는 넓은 정상 문구까지 막을 수 있어 실제 허용/차단 예문을 먼저 비교한다.
- `죽음`, `심판`, `죄`, `지옥`, `간음`과 `목사님 말씀 감사합니다`는 기존 명세대로 단어 하나만으로 막지 않는다. 성경 본문은 검수 자료나 fixture에 추가하지 않는다.
- 답안은 entry뿐 아니라 행·열의 연속 작성 구간도 검사한다. 한 칸 부분 답안, 빈칸 경계, 교차 구간, 정상 정답 조합에 대한 오탐을 함께 확인한다.
- 새 규칙은 신규 제출에 적용된다. 기존 성공 요청의 같은 key·내용 재시도는 먼저 재생하므로 새 규칙이 과거 제출을 자동 삭제·차단하지 않는다. 과거 자료 조치는 P4-22 관리자 API의 별도 대상·사유 승인으로 처리한다.
- 현재 정책 저장소는 읽기 전용이다. 규칙 등록 API·관리자 시험 화면·seed 도구가 준비됐다고 가정하지 않는다. 사용자는 2026-09-07 지금 목록을 입력하지 않고 후속 관리자 화면에서 제어하는 방안을 승인했다. 이는 implementation 7.6의 관리자 추가·비활성화·시험 문구·exact 예외 요구와 맞는다. Phase 5 필수 범위와 Production 공개 전 완료 게이트로 명시했고, 그때 검수 가능한 등록·되돌림 기능을 구현한 뒤 실제 목록을 입력한다.

## 3. 환경·행위별 승인 범위

아래 행은 독립 승인 단위이며 작업 번호가 아니다. 승인에는 대상 환경, 행위, 정확한 자료/변수 이름, 검증·되돌림 범위를 기록한다. 저장소 읽기·공식 문서 조사·로컬 검사·문서 갱신과 연습용 사이트에서 먼저 시험하는 준비 방향에 동의받았다. 실제 자원 생성·secret·migration·배포는 각 구체 단계에서 따로 확인한다는 기존 안내를 유지한다.

| 대상 | 제안하는 행위 | 현재 승인·선행 조건 |
|---|---|---|
| 격리 로컬 테스트 | 기존 합성 fixture·mock으로 정책·Turnstile 계약 확인 | 가능. 실제 데이터나 실제 비밀값 불필요 |
| 개발 Local D1 | 현재 schema 확인 후 `0001`~`0006` 적용, 검수한 자료만 등록 | 미승인. 기존 개발 DB 보존·대상·데이터 목록·원복 범위를 먼저 확정 |
| Local 설정 | `.env.local`의 공개 site key, `.dev.vars`의 서버 변수·비밀값 | 미승인. 기존 파일 존재/설정 여부만 확인하고 값 출력·덮어쓰기 금지. 테스트 키 도입도 실제 연동 검증과 구분 |
| Preview 현황 조회 | D1 이력/구조·버전/설정 이름 조회 | 공식 로그인 후 직접 조회 가능. D1 후검사 완료, 최신 저장 버전 runtime 6개 누적 확인. build 변수 직접 조회·Access 상세 검수는 배포 전까지 남음 |
| Preview Turnstile 자원 | 아래 값으로 widget 1개 생성 | 사용자 직접 생성·Site key/Secret key 발급 보고(2026-09-04). 앱 연결·배포는 별개이며 재생성하지 않음 |
| Preview 설정·secret | build 변수 1개·runtime 6개 | 저장 완료 기록. 최신 버전 runtime 6개 이름/유형과 Preview DB/hostname 직접 확인. 저장 버전은 아직 활성 배포가 아니며 실제 기능 검수 대기 |
| Preview D1 migration | `0001`→`0006` 순서 적용 | 사용자 진행 승인 후 2026-09-04 적용·후검사 완료. 이력 7개, 앱 표 17개/index 29개 정의 일치, 전체 앱 표 0행·FK 오류 0건. 동일 적용을 다시 요청하지 않음 |
| Preview 정책 데이터 | 검수된 reserved/term/exception 목록 등록 | 미승인. migration 승인에 데이터 등록을 포함하지 않음. 전후 건수·정책 검증·정확한 원복 자료 필요 |
| Preview 검수 자료 | 합성 퀴즈·제출 레코드 및 실브라우저 검수 | 미승인. 실제 설교·참여자 자료와 구분해 대상/정리 방법 먼저 검토 |
| Git·Preview 배포 | 검토한 파일만 commit, `main` push 또는 별도 배포 | 미승인. 기존 Phase 2·7A·3·4 전체 미커밋 변경이 있으므로 P4-23 문서만의 배포로 오인하지 않음 |
| Production 전체 | Worker·D1·R2·도메인·widget·secret·migration·배포 | 범위 제외. D-005의 배포 트리거·운영자 승인·migration·rollback 합의부터 별도 필요 |

## 4. Turnstile 준비 제안

현재 dashboard 관측: Settings는 한 페이지이고 Builds는 중제목이다. 그 아래 Variables and secrets가 build 설정이며, 별도로 Runtime variables and secrets 항목이 있다. 사용자가 Preview runtime 두 설정의 저장에 동의하고 저장된 것으로 보인다고 보고했다. 후속 screenshot에서 hostname 행은 Text이며 값은 biblequiz-app-preview.jinkyu0105.workers.dev, TURNSTILE_SECRET 행은 Secret 및 Value encrypted로 표시됨을 직접 확인했다. 첫 행 이름 전체가 TURNSTILE_EXPECTED_HOSTNAME임을 사용자가 후속 확인했다(2026-09-04). Turnstile 설정 저장 단계는 완료했으며 실제 동작 검수와 구분한다. 비밀값은 수집하지 않았다. 배포 버전·실제 Siteverify/제출 성공은 미확인이다. 동일 두 설정 저장 승인을 다시 묻지 않으며 코드 push·D1 migration·Production 승인으로 확대하지 않는다.

| 항목 | 권장 값·위치 | 상태 |
|---|---|---|
| 첫 실제 widget | `biblequiz-preview-submission` | 생성 전 설정 screenshot 확인, 생성·키 발급은 사용자 보고. 키 값 미수집 |
| 플랜·mode | Free · Managed | 무료 준비 방향 동의, Managed 선택 screenshot 확인. 결제 변경 없음 |
| 허용 hostname | `biblequiz-app-preview.jinkyu0105.workers.dev` | 기존 Preview 주소의 hostname만, scheme/port/path 제외 |
| pre-clearance | 사용 안 함 | 생성 전 스위치 꺼짐 screenshot 확인. Access 보호 유지 |
| action | `quiz_submission` | 이미 browser/server 양쪽 코드에 고정. dashboard에서 새로 정하는 값 아님 |
| 공개 site key | Preview Worker의 `Settings → Builds → Build variables and secrets`에 `VITE_TURNSTILE_SITE_KEY` | Variable로 입력·저장 사용자 보고(2026-09-04), 값 미수집. 새 build 반영·재조회 미검증. Local은 미설정 |
| 서버 secret | Local `.dev.vars`; Preview `biblequiz-app-preview`의 Worker Secret `TURNSTILE_SECRET` | 값은 사용자 비밀 저장소/설정 입력에만 보관. 대화·Git·로그·`VITE_*` 금지 |
| 서버 hostname | Preview runtime `TURNSTILE_EXPECTED_HOSTNAME` = 위 hostname | 현재 서버는 hostname 하나와 exact 비교. Local 키/hostname과 공유하지 않음 |
| 익명 세션 | 환경마다 서로 다른 `SESSION_PEPPER` | 제출 준비에 필수인 서버 비밀값. 32 random bytes → 64자리 소문자 hex. 임의 회전 시 기존 브라우저 소유권 연결이 끊김 |

Local은 기존 mock을 우선 유지하고 공식 테스트 키는 별도 로컬 연동 선택지로 둔다. 공식 테스트 응답 예시는 `hostname=localhost`, `action=test`여서 현재 `quiz_submission` exact 검증과의 호환을 직접 확인해야 한다. 테스트를 통과시키려고 검증을 해제하거나 테스트 키를 Preview 실제 검수의 성공 근거로 쓰지 않는다. 실제 Local widget이 필요해지면 Preview와 분리한 자원·hostname을 다시 제시한다. [공식 테스트 안내](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)

승인 뒤 사용자가 dashboard에서 준비할 때의 순서:

1. Cloudflare dashboard의 **Turnstile → Add widget**을 연다.
2. 위 widget 이름, Preview hostname, **Managed**, pre-clearance 사용 안 함을 입력한다.
3. **Create**는 자원 생성 승인이 있을 때만 누른다. 이후 이름·hostname·mode를 확인하고 site key와 secret을 안전한 개인 저장소에 보관한다. secret이 보이는 화면을 대화에 첨부하지 않는다.
4. 앱 연결 승인 뒤 공개 site key는 해당 Preview의 build 변수에, hostname은 runtime 변수에, 두 서버 비밀값은 Worker Secret에 넣는다. dashboard의 **Deploy**나 일반 `wrangler secret put/delete`는 새 버전 즉시 배포를 동반하므로 배포 승인 없이 실행하지 않는다. 배포 없는 버전 준비 방식을 택할 때도 원격 버전 생성 범위를 먼저 확정한다.
5. 승인된 Preview 배포 후 Access 비로그인 차단, 로그인 뒤 위젯, 서버 검증과 실제 저장 결과를 각각 확인한다. secret 원문 대신 변수 이름·설정 여부·버전·검사 결과만 문서에 남긴다.

공식 근거: [widget 생성](https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/), [hostname 형식·하위 도메인 허용](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/), [build/runtime 변수 구분](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [secret와 즉시 배포](https://developers.cloudflare.com/workers/configuration/secrets/). widget은 등록 hostname의 하위 도메인도 허용하지만 앱 서버의 exact hostname 검증은 그대로 유지한다.

## 5. migration·검수·되돌림 초안

Preview 배포 전에 적용할 파일은 `0001_public_quiz_entries.sql` → `0002_phase4_submission_storage.sql` → `0003_phase4_moderation_policy.sql` → `0004_phase4_leaderboard_snapshot.sql` → `0005_phase4_audit_logs.sql` → `0006_phase4_submission_moderation.sql`이다. 현재 파일들은 새 표·index를 추가하며 실제 정책 seed는 없다. 이미 적용된 migration을 재작성하지 않는다.

1. 승인 범위와 `main`의 전체 배포 diff를 확인한다. 읽기 전용 이력 확인에는 `SELECT name FROM d1_migrations ORDER BY id;`를 사용하고 대상 `biblequiz-d1-preview`를 대조한다(CLI 사용 시 `--remote --env preview`). 일반 migrations list는 관리표를 초기화할 수 있어 순수 조회로 안내하지 않는다. 아래 후속 결과는 0000 한 행이며, 이후 실제 적용 직전 상태가 달라지면 다시 확인한다. 예상과 다르면 적용을 멈추고 설명한다.
2. Access 보호와 기존 배포 버전을 확인하고, DB export 또는 Time Travel 복구 지점의 사용 가능성·보관 위치·복원 시 잃을 변경 범위를 먼저 정한다. 실제 export/restore도 별도 승인 범위다. private R2를 새로 만들지 않는다.
3. 격리 D1 리허설과 `pnpm check` 통과 후, 승인된 순서로 DB 구조를 적용하고 목록·FK·정책 snapshot을 검사한다. `/api/health/database` 성공만으로 Phase 4 전체 표·secret이 준비됐다고 판단하지 않는다.
4. 별도로 검수·승인된 정책 목록을 등록한다. 정규화 중복·실제 오탐 검사 전 실제 자료를 migration/fixture에 넣지 않는다. 승인된 합성 발행 자료가 없으면 실제 제출 end-to-end 검수는 대기로 남긴다.
5. 승인된 설정·배포 뒤 정상 부분 제출, 실제 token의 만료/거절, hostname/action 불일치, 일시 장애 후 재시도, 같은 key·내용의 재생, 다른 key 중복 차단을 검사한다. 실패에는 새 제출 행이 남지 않아야 하고 token·secret·원문 규칙을 응답/로그에 노출하지 않아야 한다. 실제 token은 300초·1회 사용이며 서버 검증이 필수다. [Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
6. DB 구조 적용 실패, 오탐, 정상 token의 반복 실패, 정보 노출, Access 보호 상실 시 다음 단계·참여 개방을 중단한다. 정책은 승인된 대상 행의 이전 상태로 되돌리고, 새 widget은 연결하지 않은 채 보류하거나 별도 삭제 승인을 받는다. 배포는 검증된 이전 버전으로 돌아가되 추가된 표를 임의 DROP하지 않는다.
7. 데이터 복원은 해당 환경의 정확한 복구 지점·손실 범위를 승인받은 뒤 한다. 삭제 이력이 있다면 최신 deletion manifest 재적용과 공개 재개 hard gate를 생략할 수 없다. 실제 외부 manifest 저장은 아직 미연결이므로 그 준비 없이 과거 backup을 복원해 공개하지 않는다. Workers Free의 D1 Time Travel은 최대 7일이다. [복구 범위](https://developers.cloudflare.com/d1/reference/time-travel/)

### SESSION_PEPPER 저장 후 확인

2026-09-04: 사용자가 SESSION_PEPPER를 지금 준비·저장하는 데 동의했고, PowerShell의 RandomNumberGenerator로 32 bytes를 생성해 64자리 소문자 hex로 클립보드에 복사한 뒤 Preview Runtime variables and secrets에 Secret으로 붙여넣어 저장하도록 안내했다. 사용자는 저장 완료를 보고했다. 생성값·저장 화면·배포 버전을 직접 조회하지 않았으므로 사용자 보고로 기록하며, 값 원문은 대화·파일·로그에 수집하지 않았다. 재생성·교체·동일 저장 재승인을 요구하지 않는다. 실제 세션/제출 동작 검수와 코드 배포·D1 migration은 미완료다.

## 6. 비용·연결 의존성·완료 조건

- Turnstile Free는 무료, 계정당 widget 최대 20개·widget당 hostname 10개·challenge 무제한이다. Preview 1개 계획은 월 USD 0 범위이며 유료 플랜이 필요하지 않다. 계정의 기존 사용량은 이번에 조회하지 않았다. [Turnstile 요금](https://developers.cloudflare.com/turnstile/plans/)
- Workers Free는 동적 요청 하루 100,000회·호출당 CPU 10ms, D1 Free는 읽기 하루 500만 행·쓰기 10만 행·저장 총 5GB다. 현재 소규모 계획은 무료 범위를 목표로 하지만 실제 CPU·쿼리/계정 합산 사용량은 Preview에서 확인해야 한다. [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/), [D1 요금](https://developers.cloudflare.com/d1/platform/pricing/)
- `SESSION_PEPPER`는 제출에 필수다. `ARCHIVE_CURSOR_SECRET`은 아카이브 다음 페이지, `ACCESS_TEAM_DOMAIN`·`ACCESS_AUD`는 관리자 API에 필요하다. 이를 Turnstile 승인에 묶어 자동 등록하지 않고 목적별로 구분한다. Cron 연결, 관리자 UI, Top N 출력, 실제 R2 백업, OpenAI·새 의존성은 이번에 추가하지 않는다.
- Phase 4 명세의 WAF rate limit(초기 관찰값 IP당 10초 5회)은 코드·설정에 구현 증거가 없다. 2026-09-04 공식 자료·현재 코드 대조 결과와 대안은 아래 7절에 기록했다. 현재 workers.dev에 사용자 zone WAF를 직접 적용할 수 있는 선행 조건은 충족 증거가 없으며 무료 기능표만으로 완료 처리하지 않는다. Turnstile을 WAF 완료로 세지 않는다. 이 확인은 P4-23 운영 게이트 안에 남기고, 별도 도메인·유료 기능이나 코드 대안이 필요하면 범위·비용을 먼저 설명한다. [WAF 기능표](https://developers.cloudflare.com/waf/rate-limiting-rules/)

P4-23의 Preview 준비·실동작 검수는 완료했다. 2026-09-07 사용자는 실제 교역자 이름·추가 금지 목록을 Phase 5 관리자 화면에서 관리하고, 요청 제한을 Production 공개 전에 무료 범위·공유망 오차단과 함께 구현하는 권장안을 명시적으로 승인했다. 지금 실제 목록을 전달·등록하지 않으므로 자료 제공·최종 검수 담당과 별도 비공개 전달·보관 방식도 이번 단계에서 정할 입력이 아니다. Phase 5 관리 화면을 구현해 첫 목록을 넣기 전에 Access 운영자·검수 책임과 저장·감사·비활성화 절차를 화면/API 검수와 함께 확인한다. 보류 이유·재개 단계·출시 영향이 D-028과 이 문서에 기록됐으므로 **P4-23 완료**다. P4-24는 아직 시작하지 않았다.


## 7. 연결 선행 조건 읽기 전용 점검 — 2026-09-04

### 현재 코드가 사용하는 설정 전체

대상은 기존 `biblequiz-app-preview`다. 다음 표는 현재 코드 기준 전체 목록이며, 미래 Phase의 OpenAI/R2/Workflow/Cron은 포함하지 않는다. 이미 저장한 항목은 반복 입력하지 않는다. 아래 아카이브·관리자용 3개도 후속 사용자 저장 보고를 받았다. 현재 코드의 설정 7개 저장 안내는 끝났고 값 원문/실제 작동을 검수한 것으로 세지 않는다.

| 위치·유형 | 이름 | 프로젝트에서 하는 일 | 현재 상태·값의 출처 |
|---|---|---|---|
| Builds Variable | `VITE_TURNSTILE_SITE_KEY` | 브라우저의 사람 확인 표시 | 저장 사용자 보고. 실제 새 build 반영 미검수 |
| Runtime Text | `TURNSTILE_EXPECTED_HOSTNAME` | 사람 확인을 허용할 사이트 주소 | 값·유형 화면 확인, 전체 이름 사용자 확인 |
| Runtime Secret | `TURNSTILE_SECRET` | 사람 확인 결과의 서버 검증 | 암호화 표시 화면 확인. 실제 검증 미실행 |
| Runtime Secret | `SESSION_PEPPER` | 동일 브라우저의 익명 참여 기록 연결 | 무작위 생성·저장 사용자 보고. 실제 세션 동작 미실행 |
| Runtime Secret | `ARCHIVE_CURSOR_SECRET` | 지난 퀴즈의 다음 페이지 위치 정보 위조 방지 | 독립적인 새 32-byte/64-hex 생성·Secret 저장 사용자 보고. 실제 작동 미검수 |
| Runtime Text | `ACCESS_TEAM_DOMAIN` | 관리자 로그인 발급 기관 확인 | 기존 Access 조직 주소 확보·Text 저장 사용자 보고. 값 원문·실제 작동 미검수 |
| Runtime Text | `ACCESS_AUD` | BibleQuiz용 관리자 로그인인지 확인 | 기존 Preview 보호 앱 AUD 확보·Text 저장 사용자 보고. 값 원문·실제 작동 미검수 |

근거: `workers/app/app.ts`의 `AppBindings`와 사용 경로, `src/features/quiz/TurnstileChallenge.tsx`, `workers/_shared/repositories/archive-cursor.ts`, `workers/_shared/services/access-auth.ts`, `.dev.vars.example`를 대조했다. 아카이브 첫 페이지가 작동해도 다음 cursor 발급/검증이 성공했다는 뜻은 아니다. Access의 외부 로그인 보호만으로 앱 내부 JWT 검증 변수가 자동 연결되지 않는다.

식별 정보 확보 당시 안내는 다음과 같으며 사용자가 완료했다고 보고했다. 공식 문서는 Zero Trust → Access controls → Applications → 기존 앱 Configure → Additional settings에서 AUD를 확인하도록 안내한다. 현재 UI와 기존 앱 대상부터 확인하고 새 앱·로그인 정책을 만들거나 기존 앱을 삭제하지 않는다. JWT/cookie/이메일은 수집하지 않는다. [Access JWT 검증·AUD 위치](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

2026-09-04 후속 저장: 사용자가 기존 Preview Access application의 Additional settings에서 AUD, Zero Trust Settings의 Team name and domain에서 Team domain을 확보했다고 보고했다. 같은 biblequiz-app-preview Runtime에 ACCESS_AUD·ACCESS_TEAM_DOMAIN은 Text, ARCHIVE_CURSOR_SECRET은 Secret으로 입력하도록 안내했다. 아카이브 값은 별도의 RandomNumberGenerator 32 bytes/64자리 소문자 hex 생성·클립보드 복사 명령으로 준비했고, 대상과 세 항목 저장·적용을 설명한 뒤 사용자가 저장 완료를 보고했다. 실제 값·저장 후 화면·배포 버전은 수집/조회하지 않았다. 현재 코드의 설정 7개(build 1개·runtime 6개)는 모두 저장 안내와 사용자 보고 또는 앞선 화면 확인이 있으나 실제 작동 검수는 미완료다. 동일 설정을 재생성하거나 재입력시키지 않는다. 이 세 설정의 저장 보고를 코드 배포·migration·Production 승인으로 확대하지 않는다.

### 요청 횟수 제한의 적용 조건

- 현재 `wrangler.jsonc`는 Preview의 `workers_dev: true`이고 사용자 도메인 route와 `ratelimits` binding이 없다. 앱 코드에도 rate limiter 호출이 없다. Turnstile·Access·D1 UNIQUE는 각각 다른 보호이므로 요청 횟수 제한 완료로 세지 않는다.
- WAF 공식 시작 문서는 Cloudflare에 등록한 도메인(zone)을 전제로 한다. 현재 `workers.dev` 구성에 이 zone 설정을 그대로 적용할 수 있다는 증거는 없다. 이는 공식 문서와 로컬 구성의 대조 판단이며 계정의 모든 zone을 조회한 결과는 아니다. 별도 도메인 구매·연결이나 Production 준비를 시작하지 않는다. [WAF 선행 조건](https://developers.cloudflare.com/waf/get-started/), [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- zone Free 기능표는 규칙 1개, Path/Verified Bot 조건, IP 기준, 집계 10초·차단 지속 10초를 명시한다. Method/Host 조건이나 custom counting expression을 Free에서 지원한다고 가정하지 않는다. JSON 차단 응답 사용자 지정은 Pro 이상이다. 원래 `10초 5회` 정책의 대시보드 적용·브라우저 오류 처리 검수는 남아 있다. [기능표](https://developers.cloudflare.com/waf/rate-limiting-rules/), [차단 응답 제한](https://developers.cloudflare.com/waf/rate-limiting-rules/create-zone-dashboard/)
- 코드 안의 Workers Rate Limiting API는 별도 대안 후보다. 현재 Wrangler 4.125.0은 문서의 최소 4.36.0을 충족한다. 10/60초 주기, 계정 내 namespace, 지역별 비동기 카운터를 사용하며 전역의 정확한 제한은 아니다. 공용 Wi-Fi 사용자를 함께 막을 위험과 429/Retry-After 처리가 검토 대상이다. 이 API는 dashboard에 표시되지 않아 변수 입력으로 연결할 수 없다. 가격 문서에서 API 자체의 명시적 무료 보장을 확인하지 못했으므로 무료 확정·채택·구현으로 기록하지 않는다. [Workers Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/)
- 확정: 기존 Access 보호 Preview와 이미 저장한 Turnstile 설정은 유지한다. 요청 제한을 면제하지 않고 Production 공개 전 기술 게이트로 옮긴다. 공개 도메인 준비 시 WAF와 Workers binding의 무료 범위·제한을 다시 비교하고, IP 단독 판정 없이 route와 안정적인 주체를 조합한 보수적 값을 정해 정상 공유망·429 회귀를 통과해야 공개할 수 있다.

### 조회 결과와 실제 연결 순서

1. 자동 조회 시도: `secret list --env preview --format json`, `d1 execute biblequiz-d1-preview --remote --env preview`의 `SELECT name FROM d1_migrations ORDER BY id;`. 두 명령 모두 CLI 인증 부재로 실패해 원격 이름/이력을 받지 못했다. 새 API token·로그인 연결은 만들지 않았다.
2. Wrangler 4.125.0의 `d1 migrations list` 구현은 `initMigrationsTable`을 호출한다. 읽기 전용 확인에서는 이 명령을 실행하지 않고 기존 이력 표 SELECT를 선택했다. 원격 migration 적용은 하지 않았다.
3. 도구 준비 중 pnpm에 `CI=true`를 전달하면 의존성 확인이 자동 install을 시도해 로컬 저장소 SQLite 오류로 실패했다. CI를 Wrangler 자식 프로세스에만 적용해 재시도했으며 패키지/lockfile 변경은 없다. Wrangler 기본 로그 디렉터리는 읽기 전용이어서 진단 로그만 `/tmp`로 지정했다. 이 로컬 오류를 원격 DB 오류로 해석하지 않는다.
4. 기존 Access 정보 확보와 세 설정 저장은 사용자 보고로 끝났다. 이후는 Preview migration 이력·현재 배포·복구 지점 확인 → 승인된 migration/검수 데이터/코드 배포 → 실제 Turnstile·세션·제출·아카이브/관리자 검사 순이다. 금지 규칙·검수자·비공개 보관 방법과 WAF 결정도 P4-23 안에 남으며 실제 이름 보류는 유지한다.
5. 공개 GET이 lazy 마감 쓰기를 할 수 있으므로 운영 현황 조회 목적으로 공개 퀴즈 API를 임의 호출하지 않는다. 현황은 dashboard/관리 API의 필요한 메타데이터로 확인한다. 정책 실제 데이터·local/remote migration·push·코드 배포·Production 변경은 이번에 하지 않았다.


### Preview D1 이력 수동 확인 결과

2026-09-04 Preview D1 이력 조회: 사용자가 biblequiz-d1-preview의 Console에서 SELECT name FROM d1_migrations ORDER BY id;를 실행하고 name=0000_foundation.sql 한 행을 전달했다. 적용 이력에는 0001~0006이 없다. 이는 사용자 dashboard 조회 결과이며 에이전트 CLI 재조회 성공이나 실제 schema 전체 대조로 세지 않는다. DB 쓰기·migration 적용은 하지 않았다.

기존 0000 적용 기록과 이번 전달 결과는 일치한다. 다음 조회는 Preview의 현재 배포 버전·복구 가능 지점이다. 실제 migration/데이터 등록/배포는 여전히 별도 단계이며, 이력표만으로 DB 구조가 migration 파일과 동일하다고 확정하지 않는다.


### Preview 활성 배포와 설정 저장 버전 구분

2026-09-04 Deployments screenshot 직접 확인: 대상은 biblequiz-app-preview다. Active deployment는 c7b0e710, Deployed는 6 days ago로 표시된다. Version History에는 이후 설정 저장 버전 d226d701(Turnstile 관련), 35e44da4(SESSION_PEPPER), e4f1c9d2(Access/아카이브 관련)가 있으나 Active는 그대로다. 따라서 설정 저장과 활성 배포 적용을 구분하며, 이전 저장·적용 안내를 실제 활성화 완료로 해석하지 않는다. 상대 시각을 절대 배포 시각으로 환산하지 않고 전체 version ID·D1 복구 범위/현재 bookmark는 아래 후속 기록대로 확보했다. 각 버전의 설정 누적 상태·실제 동작·실제 복구 실행 검증은 미확인이다. 버전 제목의 Add secret 문구만으로 Text/Secret 유형이 잘못됐다고 단정하지 않는다.

Version History의 c7b0e710 오른쪽 복사 아이콘으로 전체 ID를 확보했고 아래에 기록했다. Active deployment 텍스트는 클릭되지 않는다. View all deployments 링크는 보이나 아직 열지 않았다. 최신 설정 버전을 임의 배포하거나 과거 버전으로 복원하지 않는다.


### 현재 버전·D1 복구 지점 확보 결과

2026-09-04 현재 버전·복구 범위 확인 완료: 활성 Worker 전체 ID는 `c7b0e710-1e0b-4f54-97f2-8c4b7410d436`(사용자 복사 전달, screenshot 접두사 일치)다. D1 Time Travel screenshot은 최근 7일 복구를 표시하고 Restore window는 화면 표기 기준 28 August 2026, 20:32 ~ 04 September 2026, 20:32다. 화면에 시간대가 없어 UTC/KST로 단정하지 않는다. 사용자가 Get current Bookmark ID를 눌러 현재 D1 bookmark `00000008-00000000-000050dc-3592f11fcbd99d9b48bf3625a5ef7aae`를 전달했다. 이는 복구 지점 식별이며 실제 restore 성공 검증은 아니다. bookmark는 영구 backup이 아니므로 실제 변경 직전 유효 범위와 현재 상태를 다시 확인한다. Restore/Rollback/Deploy·migration·데이터 쓰기는 실행하지 않았다.

다음은 로컬 0001~0006 파일의 적용안·복구 절차 검토다. migration/코드 배포 전에 대상 DB의 구조·이력 변화와 유효한 복구 지점을 확인하고, 필요한 격리 리허설·검사 결과와 실제 쓰기 범위를 제시한다. 현재 bookmark를 장기 보관 가능한 export로 취급하거나 실제 restore를 시험 삼아 실행하지 않는다.


## 8. 0001~0006 로컬 검토·실행안 — 2026-09-04

이번에 완료한 범위는 SQL 검토, 격리 로컬 D1 리허설, 전체 코드 검사다. 실제 Preview DB 적용 승인을 받은 것이 아니다. 개발 Local D1·원격 D1·실제 데이터·설정·배포는 변경하지 않았다.

### 검토한 변경

| 순서 | 파일 | 추가하는 표 | 명시적 index 수 |
|---|---|---|---|
| 1 | `0001_public_quiz_entries.sql` | `quiz_entries_public` | 1 |
| 2 | `0002_phase4_submission_storage.sql` | `anonymous_sessions`, `quiz_solutions`, `submissions` | 5 |
| 3 | `0003_phase4_moderation_policy.sql` | `moderation_exceptions`, `moderation_terms`, `reserved_names` | 6 |
| 4 | `0004_phase4_leaderboard_snapshot.sql` | `leaderboard_snapshot_entries`, `leaderboard_snapshots` | 2 |
| 5 | `0005_phase4_audit_logs.sql` | `audit_logs` | 2 |
| 6 | `0006_phase4_submission_moderation.sql` | `moderation_actions` | 1 |

총 11개 표·17개 명시적 index를 추가한다(기존 0000은 6개 표·12개 index). 모든 실행문은 CREATE TABLE/INDEX이며 기존 행 수정·삭제·실제 정책 seed는 없다. 외래키의 ON DELETE 동작은 이후 삭제 시 적용되는 제약이고 이번 migration의 삭제 작업이 아니다. 0004는 참조 대상 표를 같은 파일 뒤에서 생성하며 로컬 D1 적용/FK 검사를 통과했다. 파일 순서나 기존 SQL을 바꿀 필요는 발견하지 못했다.

검토 파일 SHA-256(원격 적용 직전 동일성 확인용):

```text
58f8fa7d7ad40a635af9bca7cd508ceaeacd285e998fff745a1f17453b6f1a9a  0000_foundation.sql
e0308a4d02cd89f4a41a7ce7f3684a2e3b19126423f4f8dee493fa6db89b36d7  0001_public_quiz_entries.sql
537bc3571fb8f81ef43b5b88d7a2dafff67d616a8e751d0c5a67bde63a74d682  0002_phase4_submission_storage.sql
5184d2b7acb08d190a62eb755db78fddb7051ecc46a9f6e23e921bedbfd230f8  0003_phase4_moderation_policy.sql
b4ac1a8596f200ff0d3955962b9b0b74ed8c163180c0fd04516cbeb9e364d8b5  0004_phase4_leaderboard_snapshot.sql
fcd42e32b58062f346ca606012f90e2754b548127833eec2a31ca02a6ebd9e20  0005_phase4_audit_logs.sql
5df9f1211a7f0a00709c8ccd21d2dc457bfaa4394495f08e41cc82044a49c46e  0006_phase4_submission_moderation.sql
```

### 격리 리허설과 검사

재실행: 프로젝트 루트에서 `pnpm exec node scripts/check-migration-upgrade.mjs`. [검사 스크립트](../scripts/check-migration-upgrade.mjs)는 매번 별도 임시 설정·무작위 DB ID·`/tmp` 저장 경로를 만들고 Wrangler를 항상 `--local`로 호출한다. 기존 개발 DB와 실제 설정값을 사용하지 않으며 finally에서 임시 DB를 제거한다. 새 의존성은 없다.

- 0000만 적용한 DB에 기존 합성 fixture의 기초 표 6개 각 1행을 넣고 시작했다. 원격 자료를 복사하지 않았다.
- 임시 복사본 0002의 마지막에 의도적인 실패를 넣었다. 0001은 유지되고 0002의 표/이력은 남지 않으며 0003~0006은 실행되지 않았다. 기존 6행도 동일했다.
- 정상 0002로 되돌린 뒤 나머지 적용 성공. 기초 6개 표의 행·표/index 정의가 동일하고 새 11개 표는 모두 0행이다. 이력은 0000~0006 정확히 7개, foreign_key_check 0행, quick_check=ok다.
- 다시 apply했을 때 schema·기초 데이터·전체 이력(적용 시각 포함)이 변하지 않았다.
- `pnpm check` 성공: lockfile·Cloudflare 설정·Drizzle·lint·typecheck, unit 22 files/223 tests, Worker 19 files/154 tests, production build. E2E 목록/실제 브라우저 E2E는 이번에 실행하지 않았다. 실제 Turnstile·Access·Preview 동작 성공으로 세지 않는다.
- 최초 제한 환경에서 하위 프로세스 EPERM 및 Worker 테스트의 localhost listen EPERM이 발생했다. 로컬 검사에 한정한 권한 확장 실행으로 리허설과 전체 검사를 완료했다. 자동 승인 거절은 없었고 원격 권한을 사용하지 않았다.

### 실제 적용 전 확인과 실행 순서

구조 대조 결과: 2026-09-04 사용자가 전달한 Preview Console TSV 19행을 대조했다. 앱 표 6개·명시적 index 12개와 d1_migrations 1개이며, 앱 정의 18개는 로컬 0000을 메모리 SQLite에 적용해 얻은 정의와 따옴표 안의 문자열을 보존하고 바깥 공백만 무시한 토큰 비교에서 일치했다. 전달 결과 안에는 추가 앱 표/index/trigger/view가 없다. 이는 사용자 제공 조회 결과의 구조 대조이며 원격 직접 재조회·데이터 내용/건수 검증은 아니다. 원본 첨부 SHA-256은 `4b5e82d72533601b615ea08480bc7373ccfc01f28ff9c42252a0132c63873f5e`다. 0000만 적용됐다는 이력과 모순이 없고 0001~0006 적용·새 표 생성은 아직 하지 않았다. 같은 구조 조회를 즉시 다시 요구하지 않는다.

1. **읽기 전용 구조 대조는 위 사용자 제공 결과로 완료했다.** 다음은 사용한 조회문이며 변경 직전 실제 상태가 달라졌을 때 재확인한다. 기존 사용자 로그인 dashboard의 D1 `biblequiz-d1-preview` → Console에서 아래 구조 조회를 한다. 이미 확보한 0000 이력·버전 ID를 즉시 다시 요구하지 않는다. 반환된 정의를 0000과 비교해 예상치 못한 표·index·trigger·view가 있으면 설명하고 중단한다. 데이터 행·정답·이메일·비밀값은 조회하지 않는다.

   ```sql
   SELECT type, name, tbl_name, sql
   FROM sqlite_schema
   WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
   ORDER BY type, name;
   ```

2. 적용 직전 대상은 DB ID `cb044032-7e26-452b-afae-b0cae3d93678`, Worker `biblequiz-app-preview`, 환경 `preview`로 다시 대조한다. 파일 hash·이력 변경 유무·Access 보호·현재 활성 버전·유효한 Time Travel 범위를 확인한다. 기존 bookmark가 최근 쓰기보다 앞선다면 새 bookmark를 확보한다. 복원 시 해당 시점 이후의 DB 변경을 잃는 범위를 확인한다. 최신 설정 저장 버전의 누적 runtime 항목은 후속 직접 조회로 확인했다. build site key·Access 상세 검수는 아래 최신 결과의 이유로 코드 배포 전 게이트에 남기며 실제 DB 빈 표 추가와 구분한다.
3. 모든 사전 대조가 끝나면 **기존 Preview DB에 위 6개 파일로 빈 표 11개와 index를 추가하고 migration 이력을 기록하는 범위**를 사용자에게 구체적으로 제시한다. 잠시 DB 요청이 실패할 수 있음을 설명한다. 정책/검수 데이터 등록, 코드 push/배포, 복원, Production은 이 적용에 포함하지 않는다. 최초 요청의 원격 migration 승인 경계에 따른 마지막 실행 승인이다.
4. CLI 인증은 후속 공식 로그인으로 준비됐다. DB 적용에 대한 구체 승인 전에는 실행하지 않는다. SQL 파일을 dashboard에 임의로 나누어 붙이거나 이력 행을 수동 작성해 우회하지 않는다. 인증 준비가 필요하면 값 원문을 수집하지 않는 공식 로그인 방식을 별도 안내한다. 다음은 인증·사전 대조·승인 후 사용할 기존 명령이며 이번에 실행하지 않았다.

   ```sh
   WRANGLER_LOG_PATH=/tmp/biblequiz-preview-migration.log WRANGLER_SEND_METRICS=false pnpm run db:migrate:preview
   ```

   package script는 `wrangler d1 migrations apply biblequiz-d1-preview --remote --env preview`다. 예상 대기 파일 0001~0006 외의 파일이 보이면 확인을 중단한다. `drizzle-kit push`, 최상위 Production 설정, 일반 `deploy`를 사용하지 않는다. Wrangler가 파일별 적용과 이력 기록을 처리한다. 전체 6개가 하나의 트랜잭션이라고 가정하지 않는다. [D1 migration 관리](https://developers.cloudflare.com/d1/reference/migrations/)
5. 적용 직후 `SELECT name FROM d1_migrations ORDER BY id;`가 0000~0006인지, 위 구조 조회가 총 17개 앱 표와 예상 index인지 대조한다(시스템·이력 표 제외). `PRAGMA foreign_key_check;`가 0행인지 확인하고 새 11개 표의 COUNT(*)가 0인지 확인한다. 이 단계는 구조 적용 확인이며 실제 정책/제출 검수 완료가 아니다.
6. **DB 먼저, 코드 배포는 그 다음 별도 단계다.** 현재 Phase 2~4 코드가 미커밋이라 main push는 이번 검사 스크립트 외에도 누적 변경 전체를 Preview에 배포한다. 배포할 정확한 commit·전체 diff·Preview build/검사 결과·runtime 설정 유지·이전 버전 복귀 조건을 검토한 뒤 승인받는다. 실자료/합성 검수자료 등록도 검토 산출물과 해당 환경 승인이 있어야 한다. WAF·실제 규칙 미완료 상태에서 참여 공개/Production 준비로 확대하지 않는다.

### 실패·중단·복구 기준

| 상황 | 처리 |
|---|---|
| 예상과 다른 구조/이력/파일 또는 사전 검사 실패 | 쓰기 전에 중단, 차이 설명 후 적용안을 다시 검토 |
| 파일 적용 실패/통신 중단 | 다음 단계·코드 배포 중단. 실제 이력과 schema를 조회해 성공한 파일과 실패한 파일 구분. 자동 반복·이력 수동 수정·표 DROP 금지 |
| 앞 파일은 성공, 뒤 파일 실패 | 앞 파일까지 남을 수 있다. 기존 활성 코드 유지, 원인을 고쳐 격리 리허설 후 남은 파일 적용 범위를 다시 확인 |
| DB 추가 성공, 새 코드 검수 실패 | 참여 개방 중단. 검토된 이전 Worker 버전으로 복귀하는 범위를 확인. Worker 복귀는 D1을 되돌리지 않으며 새 표를 자동 삭제하지 않음. 이전 버전의 설정/secret 호환성도 확인 |
| DB 손상·자료 유실로 실제 복원이 필요 | 현재 쓰기와 공개 재개를 멈추고, 정확한 bookmark·유효 기간·그 이후 잃을 변경·삭제 기록 재적용을 검토해 복원 승인. Time Travel은 DB 전체 상태를 되돌리므로 시험 삼아 누르지 않음 |

로컬 실패 주입은 현재 Wrangler/로컬 D1의 파일 경계를 검증한 것이며 원격 장애·실제 Time Travel 복원을 시험한 것은 아니다. Free의 7일 범위와 실제 dashboard 복구 가능 시점을 적용 직전에 대조한다. 삭제 자료가 있다면 외부 deletion manifest가 미연결인 상태에서 과거 DB를 복원해 공개하지 않는다. [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)


### 후속 로그인 연결 준비와 자동 승인 검토 결과

2026-09-04 후속: 사용자가 안내된 계정 조회·D1·Worker 관리 권한(Preview 외 자원에도 적용 가능)과 이 컴퓨터의 로그인 저장 범위를 명시적으로 허용했다. 네 scope account:read·user:read·d1:write·workers_scripts:write로 동일한 공식 device login 명령을 재시도했고 이번에는 실행 허용 후 연결 URL/일회용 확인 코드가 발급됐다. 현재 사용자의 Cloudflare 브라우저 허용 대기이며 로그인 성공·인증 저장 완료로 세지 않는다. 코드는 5분 유효하고 문서에 저장하지 않는다. 범위를 추가 확장할 때는 별도 확인한다. 실제 DB/설정 변경·배포·Production은 승인/실행하지 않았다. 아래 거절 기록은 명시적 범위 승인 이전 이력이며 현재는 사용자 브라우저 허용을 기다린다.

2026-09-04 사용자가 수동 클릭을 줄이기 위한 로그인 방법을 제안했다. 설치된 Wrangler 4.125.0과 공식 문서에서 device flow와 선택 scope를 확인했다. account:read·user:read·d1:write·workers_scripts:write만 요청하는 공식 로그인 명령을 준비했으나, 실행 전 자동 승인 검토가 거절했다. 이유는 Preview에 한정되지 않은 D1/Worker 쓰기 권한과 사용자 인증 저장소에 지속되는 로그인에 대해 구체적 범위 승인이 부족하다는 것이다. 프로세스 생성 전 거절이므로 로그인 URL/코드 발급·인증 저장·원격 설정/DB 변경은 없었다. 우회 실행이나 사용자에게 같은 명령을 대신 실행시키지 않는다.

예정 명령은 `pnpm exec wrangler login --device --browser=false --scopes account:read user:read d1:write workers_scripts:write`다. 설치된 버전의 선택 scope에는 D1 읽기 전용 scope가 없으며 기본 로그인 전체 권한 대신 위 네 scope만 골랐다. 로그인 정보는 Wrangler 표준 사용자 인증 저장소에 유지된다. 이 WSL에서는 OS keyring용 secret-tool이 발견되지 않아 암호화 keyring 저장이 된다고 약속하지 않는다. 비밀번호/API token을 사용자에게 복사해 보내도록 요구하지 않는다.

재개에는 **Preview 밖에도 적용될 수 있는 D1·Worker 관리 권한으로 이 컴퓨터의 Wrangler 로그인 연결을 허용하는지** 구체 확인이 필요하다. 로그인 승인은 실제 자원 변경 승인이 아니다. 승인 후 요청을 생성하고 사용자가 공식 Cloudflare 페이지에서 연결을 허용하면, 토큰/이메일 원문을 출력하지 않는 방식으로 인증 성공·선택 권한과 기존 Preview 대상 접근부터 검증한다. 이후에도 실제 migration·설정 변경·push/배포·Production은 기존 행위별 승인 경계를 유지한다. 로그인 연결을 하지 않는다면 이미 승인된 dashboard 조회와 로컬 준비는 계속 가능하다.

공식 근거: [Wrangler login·선택 scope·device flow·인증 저장](https://developers.cloudflare.com/workers/wrangler/commands/general/#login). 로그인 명령이 계정 전체 자원을 대상으로 실행하는 작업 자체를 승인하거나 자동으로 수행하는 것은 아니다.


### 로그인 완료와 Preview 자동 조회 결과

2026-09-04 사용자 브라우저 허용 뒤 공식 device login 프로세스가 Successfully logged in과 종료 코드 0을 반환했다. whoami --json의 OAuth 인증과 user:read·account:read·d1:write·workers_scripts:write, 로그인 유지를 위한 offline_access를 확인했다. 신규 서비스 권한을 추가하지 않았고 토큰·개인 이메일·계정 이름을 출력하거나 문서에 저장하지 않았다.

직접 읽기 전용 점검 성공: Preview D1 이력 SELECT는 0000_foundation.sql 한 행이며 사용자 전달 결과와 일치한다. 최신 저장 Worker 버전 e4f1c9d2-5349-43a9-a15e-0530542b2710에 runtime 6개(ACCESS_AUD/ACCESS_TEAM_DOMAIN/TURNSTILE_EXPECTED_HOSTNAME=plain_text, ARCHIVE_CURSOR_SECRET/SESSION_PEPPER/TURNSTILE_SECRET=secret_text)와 DB binding이 함께 존재한다. DB ID와 hostname은 기존 Preview 대상으로 일치했다. 배포 목록의 최신 배포 75e92309-8afe-4101-9121-0750d46829f5는 2026-08-29T10:31:23.432447Z에 생성됐고 c7b0e710-1e0b-4f54-97f2-8c4b7410d436에 100%를 배정한다. 설정 저장 버전은 여전히 활성 배포가 아니다.

공개 build 변수 VITE_TURNSTILE_SITE_KEY는 기존 사용자 저장 보고 상태이며 이번 runtime 버전 조회로 build 반영을 검증하지 않았다. 암호화 값 내용/길이와 실제 Access·Turnstile·세션 동작도 미검수다. 로그인은 완료됐으므로 같은 로그인·수동 조회 복사를 반복 요구하지 않고 가능한 메타데이터 조회는 도구로 수행한다. 실제 DB 적용·정책 자료·설정 변경·push/배포·Production은 이번에 수행하지 않았다.

읽기 명령은 whoami --json, Preview의 migration 이력 SELECT, versions list/view, deployments list만 실행했다. 각 JSON 응답은 프로세스 메모리에서 필요한 항목만 골라 출력했다. 공식 OAuth 로그인 외 원격 변경은 없으며 앞선 자동 승인 거절은 사용자의 명시적 범위 승인 뒤 해소됐다. 같은 권한 승인을 재요청하지 않는다. 최신 runtime 설정이 모두 확인됐으므로 누적 설정 입력을 다시 시키지 않는다. 위 실행안의 CLI 인증 부재는 이제 해소됐지만 실제 migration 실행 승인을 받은 것은 아니다.


### DB 적용 직전 확인 결과와 승인할 작업

2026-09-04 P4-23 DB 적용 사전 점검 완료: 현재 Preview DB 이름/ID와 wrangler --env preview 대상이 일치하고 Production placeholder는 유지된다. 0000~0006 SHA-256은 리허설 때와 동일하며 앱·테스트·설정·검사 스크립트도 마지막 pnpm check 이후 변경되지 않았다. 직접 조회 이력은 0000_foundation.sql 한 행, foreign_key_check는 0행, 기초 앱 표 6개는 모두 0행이다. d1 info는 앱 표 6개+이력 표 1개, 크기 135168 bytes, APAC를 반환했다.

현재 Time Travel bookmark는 0000000b-00000000-000050dc-d3348f6b231dedf7ec342ce0c4187921이며, 2026-09-04T12:10:20Z(조회 당시 30분 전)의 bookmark 00000005-00000002-000050dc-3e3b95e824a7c78b046fa5969cefba30도 조회 성공했다. 이전 수동 bookmark와 ID가 달라 새 값을 기록했으며 차이만으로 사용자 데이터 쓰기가 있었다고 추정하지 않는다. 실제 restore는 실행하지 않았다. 보관 기간 7일은 앞선 dashboard 근거를 유지하며 이번 d1 info 응답에 기간 필드는 없었다. 승인 뒤 실제 적용 명령 직전에 최신 bookmark와 이력/파일 변경 여부를 재확인한다.

비로그인 Preview 루트 HEAD/GET은 HTTP 403을 반환했으나 Access 로그인 리다이렉트/식별 표시는 확인하지 못했다. 공개 접근이 차단된 관측이며 Access 정책 상세 재검수 성공으로 세지 않는다. 기존 Access 보호 화면 기록을 유지하고 정책/로그인 실동작 검수는 코드 배포 전에 남긴다. Builds 환경변수 API는 Workers CI Read/Write 권한을 요구하며 현재 승인된 OAuth scope에 없으므로 호출/권한 확장/새 token 생성은 하지 않았다. VITE_TURNSTILE_SITE_KEY는 저장 사용자 보고 상태로 유지한다. 이 변수와 정책 상세 검수는 DB의 빈 표 추가에 사용되지 않으므로 실제 코드 배포 전 게이트로 구분하며 P4-23 안에 계속 남긴다. [Builds 변수 조회 권한](https://developers.cloudflare.com/api/resources/workers_builds/subresources/triggers/subresources/environment_variables/methods/list/)

처음 이력·FK·행 수 통합 조회와 이후 6개 UNION 행 수 조회가 too many terms in compound SELECT: SQLITE_ERROR(code 7500)로 실패했다. 단일 SELECT의 여섯 하위 COUNT 조회로 바꿔 모두 0행임을 확인했으며 DB 오류/손상으로 해석하지 않는다. 오류 기록 과정에서 WRANGLER_LOG_PATH=/dev/null이 디렉터리로 취급돼 EEXIST가 발생해 /tmp의 .log 경로로 정정했다. 향후 Wrangler 진단은 정상 .log 경로와 제한된 출력만 사용한다.

이번 사용자 확인에 제시할 범위는 **biblequiz-d1-preview에 검토한 0001~0006을 순서대로 적용해 빈 앱 표 11개·명시적 index 17개와 해당 migration 이력을 추가**하는 것이다. 기존 6개 앱 표의 구조/자료는 수정·삭제하지 않는다. 적용 중 잠시 DB 요청이 실패할 수 있다. 정책/검수 데이터 입력·설정 변경·코드 push/배포·Production·복원은 포함하지 않는다.

승인 후 최신 파일 hash/대상/이력/bookmark가 동일한 상태인지 확인하고 기존 `pnpm run db:migrate:preview`로 실행한다. 전체 파일을 한 트랜잭션으로 취급하지 않는다. 오류 시 후속 파일·배포를 중단하고 실제 이력/구조를 다시 읽는다. 성공 뒤 이력 7행·앱 표 17개·기존 정의 보존·신규 표 0행·FK 0행을 확인한다. 카운트는 6개 이상 UNION 방식 대신 단일 SELECT 하위 조회를 쓴다. 실제 Time Travel 복원이 필요하면 복구 시점 이후의 손실 범위를 다시 제시해 별도 승인받는다.

이번에는 위 쓰기 승인을 요청할 준비까지만 완료했다. 문서 4개 공백·링크·기존 변경 보존 검사를 통과했고 앱 코드가 바뀌지 않아 pnpm check/E2E를 반복 실행하지 않았다. 기존 리허설·unit 223/Worker 154·build 성공 근거와 현재 파일 동일성을 함께 확인했다. 시작 사용량 5시간 74%/주간 96%, 종료 조회 67%/95% 남음. P4-23 진행 중·세션 유지.


### Preview D1 0001~0006 실제 적용·후검사 완료

2026-09-04 사용자에게 제시한 Preview DB의 빈 표 11개 추가 범위에 대해 후속 진행 요청을 받아 0001~0006을 실제 적용했다. 적용 직전 검토 SQL hash·정확한 DB ID/--env preview 명령·0000 한 행 이력을 다시 대조했고, Wrangler의 대기 목록이 승인된 6개 파일과 일치함을 확인한 뒤 실행했다. pnpm run db:migrate:preview는 여섯 파일 모두 성공·종료 코드 0을 반환했다.

후검사(2026-09-04T12:49:15.735592+00:00): 원격 적용 이력은 0000~0006 정확히 7행, 앱 표 17개·명시적 index 29개다. 원격 표/index 정의 46개가 로컬의 검토된 SQL과 따옴표 안의 문자열을 보존한 토큰 비교에서 일치한다. 기존 6개 표의 정의가 유지됐고 모든 앱 표가 0행이며 foreign_key_check는 0행이다. 따라서 새 빈 표 11개·index 17개 추가와 이력 기록까지 완료했다.

적용 직전 복구 bookmark는 0000000c-00000000-000050dc-b845f73877fa247e31d17c68fc4670db(2026-09-04T12:47:43Z 조회)다. 성공했으므로 rollback/restore는 실행하지 않았다. 이 bookmark로 실제 복원하면 이번 구조 추가와 이후 DB 변경을 잃으므로 복원 필요 시 정확한 대상·손실 범위를 다시 확인해야 한다. 7일 보관 범위 밖의 영구 backup으로 취급하지 않는다.

이번 원격 쓰기는 승인된 Preview schema/index와 migration 이력뿐이다. 실제 정책/합성 검수 자료·사용자 자료 등록, 환경 설정/secret 변경, 개발 Local D1 적용, commit/push·코드 배포·Production 작업은 하지 않았다. 코드·SQL·검사 스크립트는 지난 pnpm check 이후 그대로라 전체 앱 테스트/E2E를 재실행하지 않았으며, 기존 리허설·unit 223/Worker 154·build 성공과 이번 원격 후검사를 구분한다.

실행 로그는 `/tmp/biblequiz-p4-23-remote-apply.log`, 후검사 요약은 `/tmp/biblequiz-p4-23-after-apply.json`이다. 일시 파일이며 위 문서 기록을 지속 근거로 삼는다. 로컬 변경은 STATUS·HANDOFF·운영안·implementation 4개 문서이며 공백·로컬 링크·나머지 기존 파일 hash 보존을 확인했다. P4-23의 DB 준비 하위 단계는 완료했고 부모는 진행 중이다.

다음은 같은 P4-23에서 **배포할 누적 변경 범위·build/runtime 설정 반영·Access 검수·합성 검수 자료 계획을 묶어 준비**하는 것이다. 기존 main push가 Phase 2~4 누적 변경 전체를 Preview에 배포하므로 전체 diff와 검수 조건을 먼저 확인한다. DB 적용 승인을 코드 배포·실자료 등록 승인으로 확대하지 않는다. 실제 금지 규칙/검수자/비공개 보관과 WAF 적용 방식은 계속 미확정이며 실제 이름 보류는 유지한다. 이미 끝난 로그인·설정 입력·DB 조회·migration을 사용자에게 반복 요구하지 않는다.


## 9. 합성 검수 자료 실행 게이트 — 2026-09-05

사용자 승인 후 기존 `biblequiz-d1-preview`에 합성 문제 1개를 등록했다. 사전 대조는 DB ID `cb044032-7e26-452b-afae-b0cae3d93678`, migration 0000~0006, 기존 콘텐츠/제출 0건, 고정 ID/slug 충돌 0건, FK 오류 0건이었다. 등록 전 bookmark는 `00000010-00000000-000050dd-8688f5896790f70ab66de86fa77e271d`, 등록 후 bookmark는 `00000010-00000006-000050dd-ada994e28c964562ea0edcc75ec2e2f7`이며 restore는 실행하지 않았다.

등록 후 번역·설교·quiz set·어린이 variant·solution 각 1행과 공개 단서 6행을 확인했다. 자막·제출·site_state·moderation 정책은 0행이고 foreign_key_check 0행·quick_check=ok다. 기간은 2026-09-05T10:29:38.355Z~2026-09-12T10:29:38.355Z다. 고유 주소의 비로그인 GET은 기존 Access 로그인 302를 유지한다. 실제 브라우저 Turnstile/세션/제출은 다음 검수다.

재부팅 뒤 Wrangler OAuth 로그인과 활성 Preview version 94f0f994의 100% 상태를 읽기 전용으로 재확인했다. `/tmp` 일시 근거만 사라졌고 사용자 설정·배포·D1 상태는 유지됐다. 재로그인이나 기존 설정 재입력은 필요하지 않다.

원격 등록 전에 다음 산출물을 완성했다.

| 산출물 | 역할 |
|---|---|
| `tests/fixtures/preview-acceptance.sql` | 실제 콘텐츠·사람 정보 없이 고유 주소 `2026-09-05-p423qa`의 5×5 어린이 합성 문제 1개 등록 |
| `tests/fixtures/preview-acceptance-cancel.sql` | 제출이 0건일 때만 합성 문제 관련 행 제거. 제출이 있으면 아무것도 삭제하지 않음 |
| `scripts/check-preview-acceptance-fixture.mjs` | `/tmp` 격리 D1에서 등록·API·비공개 정답·충돌·취소 안전성 자동 검사 |

`pnpm run check:preview-fixture`는 등록 완결성/실제 solution hash, 두 번째 등록의 UNIQUE 중단, 공개 API 21칸·6단서, server-only 정답 비노출, 가짜 제출 1건이 있을 때 취소 거부, 제출 제거 뒤 무제출 취소, foreign_key_check 0행과 quick_check=ok를 통과했다. 이 검사는 원격 계정이나 기존 개발 DB를 사용하지 않으며 `pnpm check`의 필수 단계에 포함한다.

전체 `pnpm check`도 새 fixture 검사와 lockfile·Cloudflare·Drizzle·lint·typecheck, unit 22 files/223건, Worker 19 files/154건, production build까지 성공했다. 실제 브라우저 E2E/원격 Turnstile 검수는 자료 등록 뒤 수행한다.

승인된 범위는 **기존 `biblequiz-d1-preview`에 위 합성 문제 1개를 등록해 실행 시점부터 7일간 고유 주소에서 검사 가능하게 하는 것**이었으며 완료했다. 홈페이지 대표 문제는 바꾸지 않았다. 실제 설교·성경 본문·자막·요약·사람/관리자 정보와 moderation 규칙, Secret·설정·migration·코드 배포·push·Production은 변경하지 않았다.

사전/사후 대조는 위 결과대로 완료했다. 다음은 실제 브라우저에서 Turnstile→세션→부분 제출→재방문 결과→본인 삭제를 검사한다. 제출이 생긴 뒤에는 취소 SQL로 문제를 지우지 않고 기존 보존/삭제 절차를 따른다. 실제 이름 목록과 WAF 결정은 별도 운영 정책 항목으로 계속 남긴다.
