# P4-23 Preview 배포 검토안

> 2026-09-07. 결과 비교 수정 version fc10f77d-ca54-4dfd-a94a-9fb3cffcf482의 Preview 100% 활성화와 설정·DB·Access 후검사, 로그인 브라우저의 제출·두 격자·참여 현황·본인 삭제·재방문과 D1 후검사 완료. 관리자 정책 화면·Production 요청 제한 후속 게이트도 확정했다. push 없음.
> P4-23은 완료했고 P4-24는 시작하지 않았다. 이전 클릭별 기록 대신 완료 근거는 이 문서를 기준으로 한다.

## 1. 이번에 확인한 배포 범위

기준은 `main`의 `0ab476e`와 현재 미커밋·미추적 파일이다. Preview는 Phase 2~4 누적 구현과 D-027의 두 격자 결과 비교를 포함한 fc10f77d 버전을 활성화했다. 아래 표가 활성화한 코드 범위다.

2026-09-07 사용자 승인으로 Preview build·strict dry-run 뒤 version `fc10f77d-ca54-4dfd-a94a-9fb3cffcf482`를 올렸다. runtime 일반 설정 3개·암호화 설정 3개와 기존 Preview D1 binding을 확인한 뒤 deployment `f568ded9-57d7-423a-a119-f96f5fcd0d02`에서 100% 활성화했다. 활성화 전후 session 1건과 visible submission 1건, 외래키 오류 0건이 유지됐고 비로그인 고유 주소는 Access 302다. DB·secret·migration·Git push·Production 작업은 하지 않았다. 직전 `94f0f994-1146-4a34-b6ac-eba950d33a6f`는 되돌림 지점이다.

로그인 브라우저 재검수에서 `내가 제출한 답` 격자의 첫 칸 `가`와 나머지 빈칸, 옆 `정답` 격자의 모든 활성 칸 `가`와 정답 배경이 함께 표시됐다. 접힌 `다시 볼 칸 N개` 없이 두 격자를 바로 비교하는 D-027 동작을 통과했다. 정확한 점수 카드 위치 등 전체 화면 순서는 Phase 7B에서 조정할 수 있다.

이어 `참여 현황 보기`에서 공개된 `검수참여자` 이름과 첫 칸 `가`가 있는 제출 답안 격자를 사용자 확인했다. 본인 삭제는 이 이름·답안을 실제 제거하고 같은 session의 재제출을 막으므로 별도 승인 뒤 마지막에 검수한다.

사용자가 삭제 효과를 확인하고 승인한 뒤 `내 제출 삭제`를 실행했다. 화면은 삭제 완료·되돌릴 수 없는 재제출 제한과 2026-09-07 13:57 KST를 표시했다. 원격 D1에서 deleted tombstone, 이름·한줄평·답안 null, 삭제 시각, PII 없는 `self_service_delete` 감사 1건, moderation action 0건, visible 제출 0건과 FK 정상 상태를 확인했다. 첫 read는 일시 인증 오류, 두 번째 read는 잘못된 감사 열 이름으로 중단됐으며 세 번째 정확한 read가 성공했다. 두 실패는 D1 쓰기를 수행하지 않았다.

같은 브라우저를 강력 새로고침한 뒤에도 삭제 완료 안내와 동일 시각이 복원됐고, 재제출 안내와 비활성 버튼이 표시됐다. 삭제 정보와 결과가 다시 나타나지 않아 Preview 일반 사용자 실동작 검수를 완료했다.

| 범위 | 포함되는 동작 | 확인 근거 |
|---|---|---|
| 공개 화면 | 최신 퀴즈·고유 주소·지난 퀴즈, 한글 입력·임시 저장·난이도 전환 | `src/features/quiz`, `src/features/archive`, `src/features/hangul-input` |
| 제출 | 익명 세션, Turnstile 검증, 서버 채점, 중복 차단, 본인 결과·삭제 | `workers/app/app.ts`, 관련 service/repository·shared API |
| 결과 | 참여 현황, 마감 snapshot, 정답 공개, 지난 퀴즈 연습 | 공개/lazy 마감 경로와 테스트 |
| 관리자 API | Access JWT 검사, 즉시 마감·숨김·복구·삭제·감사 | 관리자 화면은 아직 scaffold. API 구현과 UI 완성을 구분 |
| DB | 0000~0006, 앱 표 17개·명시적 index 29개 | Preview 적용·정의 대조·빈 표·FK 검사 완료. 재적용 불필요 |
| 빌드 안전 보완 | 저장된 runtime 변수 유지, Site key 누락 시 Preview build 중단 | `wrangler.jsonc`, `scripts/check-preview-build-env.mjs`, `scripts/check-cloudflare-config.mjs`, `package.json` |

실제 Cron 연결·private R2 backup·Top N 출력·새 Production 자원은 이 배포에 포함되지 않는다. 디자인 reference와 테스트 파일은 Git 검토 대상이지만 배포용 JS에 그대로 포함되는 자료는 아니다. 원격 fixture 자동 등록이나 migration 자동 실행을 build에 추가하지 않았다.

### 설정 유지 보완

Wrangler의 `keep_vars` 기본값은 false다. 현재 runtime 일반 변수는 대시보드에서 저장했으므로 최상위에 `keep_vars: true`를 추가했다. Cloudflare 설정 검사에도 이를 확인하는 조건을 넣었다. 이 옵션은 환경 내부가 아닌 최상위 설정이다. [공식 설정 설명](https://developers.cloudflare.com/workers/wrangler/configuration/)

`build:preview`는 Vite와 같은 production-mode 환경변수 로딩을 사용해 `VITE_TURNSTILE_SITE_KEY`의 누락·빈 값·공백을 먼저 검사한다. 값 자체는 출력하지 않는다. 이 검사는 실제 widget 소유권·유효성·서버 Secret과의 짝까지 확인하지 않는다.

`keep_vars`만으로 **비활성 저장 버전의 설정이 새 코드에 전부 이어진다**고 보증하지 않는다. 활성화 직전 새 버전의 runtime 6개와 DB binding을 직접 대조해야 한다. 누락 시 배포를 중단하고 어느 저장 버전을 기준으로 이어받았는지 확인한다. 이미 저장한 Secret을 재생성하거나 회전시키지 않는다.

## 2. 검사 결과

| 검사 | 2026-09-04 결과 |
|---|---|
| `pnpm check` | 성공. unit 22 files/223건, Worker 19 files/154건, lint·typecheck·migration/설정 검사·production build 성공 |
| Preview build 입력 검사 | 누락·공백 값은 종료 코드 1, 일반 공개 문자열은 0. 값 원문 출력 없음 |
| `deploy:preview:dry-run` | 최초 공개 테스트 키 검사 뒤, 사용자가 제공한 **실제 공개 Site key**로 다시 build·dry-run 성공. 원격 업로드 없음 |
| 생성된 배포 설정 | `biblequiz-app-preview`, D1 `cb044032-7e26-452b-afae-b0cae3d93678`, `keep_vars: true` 확인 |
| 배포 JS의 개발 흔적 | `PRIVATE_E2E_CANARY`, `/dev/quiz` 등 검사한 개발 표시 없음. 모든 비밀 유출 가능성을 증명하는 전수 검사는 아님 |
| 실제 브라우저 E2E | Chromium·모바일 Chromium·Firefox: **88건 성공/2건 정상 skip**. WebKit 시스템 라이브러리 누락으로 미검수 |

사용자가 제공한 실제 공개 Site key로 다시 build하여 이전 테스트 키 산출물을 교체했다. 실제 업로드 전 아래 파일 hash를 대조하며 이후 소스나 dist가 바뀌면 다시 build·검사한다. 일반 build/dry-run을 실제 Turnstile 검수 성공으로 세지 않는다.

최초 전 프로젝트 실행은 기존 브라우저 파일이 없어 116건 실패/4건 성공했다. 테스트 코드를 바꾸지 않고 `/tmp/biblequiz-p4-23-browsers`에 프로젝트 버전의 브라우저를 다시 준비했다. Chromium·Firefox 실제 실행을 확인한 뒤 아래 명령으로 재검사해 **88건 성공/2건 정상 skip**을 얻었다. skip은 coarse pointer가 없는 데스크톱의 터치 교체 경로 두 건이며 모바일 Chromium에서는 검사한다. WebKit 실행 probe는 libgtk-4·GStreamer 등 시스템 라이브러리 누락으로 실패했고 시스템 패키지는 설치하지 않았다. 기존 macOS·Android 실기기 검수와 WebKit 외부 게이트를 유지한다.

```sh
TMPDIR=/tmp TEMP=/tmp TMP=/tmp PLAYWRIGHT_BROWSERS_PATH=/tmp/biblequiz-p4-23-browsers WRANGLER_LOG_PATH=/tmp/biblequiz-p4-23-e2e-retry.log WRANGLER_SEND_METRICS=false pnpm test:e2e --project=chromium --project=mobile-chromium --project=firefox --workers=2 --reporter=line
```

재검사 로그는 `/tmp/biblequiz-p4-23-e2e-retry-output.log`다. 이 검사는 격리된 로컬 D1·일부 mock 응답/DEV 테스트 주입을 사용하므로 실제 Cloudflare Access·Turnstile 운영 검수를 대신하지 않는다. `test:e2e:list`만 실행한 결과가 아니다.

일시 검사 로그: `/tmp/biblequiz-p4-23-deploy-prep-check-output.log`, `/tmp/biblequiz-p4-23-dry-run-output.log`, `/tmp/biblequiz-p4-23-e2e-output.log`. 영구 검수 근거는 이 문서의 요약이며 일시 파일 유지에 의존하지 않는다.

## 3. 초기 활성화 결과와 후속 실동작 완료

이 절 앞부분은 2026-09-04 최초 활성화 직후 남았던 조건의 시간순 기록이다. 이후 합성 문제 등록과 2026-09-05~07 실제 Turnstile·세션·부분 제출·결과·참여 현황·삭제·재방문 검수를 모두 완료했다. 아래 마지막 표가 P4-23 종료 시점의 상태다.

2026-09-04 사용자 승인으로 정확한 Preview 버전 94f0f994-1146-4a34-b6ac-eba950d33a6f를 100% 활성화했다. 새 deployment는 cad4c68b-cf18-4ad9-9de5-219ff33d5c69(2026-09-04T14:08:16.611923Z 생성)이며 14:08:58 UTC 후조회에서 대상 버전 100%를 확인했다. 새 업로드·DB 쓰기·Secret 변경·Git push·Production 작업은 없다.

활성화 직전 기존 검사 후 소스 불변, 정확한 새 버전의 runtime 6개/DB와 0000~0006 적용 이력을 재대조했다. 이후 비로그인 GET /, /api/health, /api/health/database는 모두 HTTP 302와 Cloudflare Access 로그인 주소를 반환했다. 이전의 403 관측과 달리 이번에는 로그인 리다이렉트를 직접 확인했다. 인증 뒤 health JSON 200·앱 화면·실제 제출/Turnstile 성공을 검증한 것은 아니다. 로그인 주소의 인증 매개변수·cookie/JWT는 기록하지 않았다.

실행한 명령:

```sh
WRANGLER_WRITE_LOGS=false WRANGLER_SEND_METRICS=false pnpm exec env CI=true wrangler versions deploy 94f0f994-1146-4a34-b6ac-eba950d33a6f@100 --config dist/biblequiz_app/wrangler.json --name biblequiz-app-preview --message 'P4-23 approved Preview activation' --yes
```

명시적 --yes는 사용자의 해당 버전 활성화 승인에 따라 제공했다. 이 명령은 기존 저장 버전을 활성화하며 새 코드/Secret을 업로드하지 않는다. 실행 출력은 비버전 설정의 logpush=false와 observability enabled=true/head_sampling_rate=1 동기화도 보고했다. 기존 설정에서 예상한 값이며 새 로그 서비스는 추가하지 않았다.

- 사전 대조: `/tmp/biblequiz-p423-activate-preflight.json`
- 실행 출력(이메일 가림): `/tmp/biblequiz-p423-activate-output.log`
- 배포·비로그인 HTTP 후검사: `/tmp/biblequiz-p423-activate-postcheck.json`

2026-09-04 사용자가 Preview에 정상 로그인한 뒤 “아직 공개된 퀴즈가 없습니다” 화면이 잘 표시된다고 확인했다. 비로그인 Access 302는 도구로 직접 확인했고 로그인 뒤 화면은 사용자 보고로 구분한다. 이로써 새 버전 배포·접근 보호·빈 퀴즈 화면의 기본 확인 묶음을 마쳤다. 실제 Turnstile/세션/제출·관리자 API/인증 후 health JSON·운영 규칙/WAF 검수 완료를 뜻하지 않는다.

현재 한도 5시간 15%/주간 87% 남음. AGENTS의 10~19% 기준에 따라 새 구현·검수 자료 생성을 시작하지 않고 이번 검수 결과만 기록했다. 다음 재개는 한도 복구 뒤 같은 P4-23의 합성 검수 자료 SQL/등록 취소안 준비와 격리 D1 검증이다. 원격 자료 등록은 그 산출물 검토/승인 뒤 실행한다. 실제 이름 목록 보류는 유지하며 이미 완료한 키 입력·업로드·활성화·빈 화면 확인을 반복 요구하지 않는다.

코드·설정·SQL은 이전 검사 후 동일하므로 pnpm check 377건, 실제 브라우저 88건 성공/2건 skip 및 WebKit 미검수·실제 공개키 build/dry-run 근거를 유지하고 반복 실행하지 않았다. 이번 변경은 문서 5개이며 공백·로컬 링크·기존 변경 보존을 확인한다. 시작 사용량 5시간 21%/주간 88%, 후검사 조회 18%/87% 남음. 10~19% 구간이므로 새 구현/검수 자료 작성은 시작하지 않고 진행 중 검수·기록만 수행한다. P4-23 진행 중·P4-24 미시작·세션 유지·추천 Sol/High(로그인 뒤 실동작 확인).


| 항목 | P4-23 종료 근거 | 후속 경계 |
|---|---|---|
| D1 | 0000~0006 적용·정의 대조, 합성 문제와 제출·삭제 tombstone·PII 없는 감사, FK 정상 확인 | 다른 환경이나 새 migration은 별도 사전 대조·승인 |
| runtime 6개 + DB | 활성 버전에서 이름/타입·일반값 3개·DB를 대조하고 실제 세션·Turnstile 제출 성공 | Secret 원문은 계속 읽거나 기록하지 않음 |
| build Site key | 실제 공개키 build·배포 뒤 공식 widget 완료와 Siteverify 저장 성공 | Production은 별도 widget·키·hostname 승인 필요 |
| Access | 비로그인 302와 로그인 뒤 전체 일반 사용자 흐름 확인 | 관리자 정책 UI/API의 Access 검수는 Phase 5 |
| 실제 규칙 | 기본 예약 명칭·입력 형식·연락처 검사 유지, 빈 정책 표 정상 | 실제 이름·추가 금지 목록은 Phase 5 관리자 화면에서 입력·시험 |
| 요청 횟수 제한 | 현재 workers.dev/zone과 Workers binding 조건 조사, D-028 확정 | 월 USD 0·공유망 오차단을 확인해 Production 공개 전 구현·429 회귀 |

빌드용 Site key는 브라우저에 공개되는 식별자다. `TURNSTILE_SECRET`, `SESSION_PEPPER`, `ARCHIVE_CURSOR_SECRET`, Access 인증 cookie/JWT는 대화로 받지 않는다. Builds API를 읽기 위해 새 계정 권한이나 token을 만드는 방법보다 공개 Site key 하나를 전달받아 로컬 build에만 사용하는 방법이 현재 연결 범위에서는 간단하다. 키 원문을 문서/Git에 넣지 않는다.


### 실제 공개키 빌드 완료와 실행할 명령

2026-09-04 사용자가 실제 공개 Site key를 제공했고 해당 프로세스 환경에만 넣어 Preview build·deploy dry-run·versions upload dry-run을 모두 성공했다. 실제 키가 client JS 한 파일에 반영됐고 이전 테스트 키·검사한 DEV 표시가 없으며 Preview Worker/D1·keep_vars=true·preview_urls=false를 확인했다. 키 원문은 소스·문서·환경 파일에 저장하지 않았고 일반 검사 로그에서도 가렸다. 생성된 공개 client 산출물(dist, Git 제외)에는 정상적으로 포함된다. 실제 Turnstile/Siteverify 성공으로 세지 않는다.

설치된 Wrangler 4.125.0의 `versions upload --help`에서 옵션을 확인한 뒤 아래 명령에 `--dry-run`을 붙여 성공했다. 공식 문서도 버전 업로드와 트래픽 활성화를 분리한다. [Cloudflare 배포 관리](https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/)

**아래 strict 명령은 사용자 승인 후 실행했으나 구성 충돌로 중단됐다. 새 버전은 생성되지 않았다.**

```sh
WRANGLER_LOG_PATH=/tmp/biblequiz-p423-version-upload.log WRANGLER_SEND_METRICS=false pnpm exec env CI=true wrangler versions upload --config dist/biblequiz_app/wrangler.json --name biblequiz-app-preview --keep-vars --strict --tag p4-23-review --message 'P4-23 Preview code and saved bindings review'
```

명시적 config는 이미 Preview용으로 생성됐고 이름과 DB ID를 대조했다. source의 기본 Production placeholder 설정으로 올리지 않는다. GitHub push·트래픽 전환·DB migration/자료 등록·Secret 신규 생성/회전은 이 명령의 승인 범위에 포함하지 않는다. 실제 업로드 후 새 version ID에서 runtime 이름/타입 6개와 DB를 확인하고 현재 배포 트래픽이 바뀌지 않았는지 조회한다. 이 조회 결과를 내기 전 활성화하지 않는다.

- build/dry-run 로그: `/tmp/biblequiz-p423-real-key-build.log`
- 정확한 업로드 명령의 dry-run 로그: `/tmp/biblequiz-p423-version-dry-run-output.log`
- build 산출물 12파일 hash 목록: `/tmp/biblequiz-p423-real-key-artifacts.json`
- 이 목록을 key 정렬한 JSON으로 직렬화한 SHA-256: `453a9f5a88d93d4b130c3299d030fd1ee5b8a5f4bc049ad84e46078fb5b76dc8`
- 이 목록은 산출물 동일성 확인용이며 계정/Secret 정보가 없다. 임시 파일이 없어졌으면 검수 산출물을 다시 만들고 대조한다.
- 이번에는 앱·설정·SQL 변경이 없어 직전 `pnpm check` 377건과 브라우저 88건 성공/2건 skip을 반복 실행하지 않았다. WebKit 미검수는 유지한다.

### 최신 실행 결과: 비활성 업로드·후검사 완료

비활성 Preview 업로드·후검사 완료: version 94f0f994-1146-4a34-b6ac-eba950d33a6f(number 10, 생성 2026-09-04T13:44:23.878373Z). 후검사 2026-09-04T13:45:51.705379+00:00에 runtime 6개와 DB의 이름/타입, 일반 설정 3개 값의 이전 저장 버전과 일치, DB ID 일치를 확인했다. 암호화 Secret 3개는 원문을 조회하지 않고 존재/타입과 업로드의 보존 동작을 확인했다.

활성 배포는 75e92309-8afe-4101-9121-0750d46829f5, 이전 코드 c7b0e710-1e0b-4f54-97f2-8c4b7410d436에 100%로 유지된다. 별도 script settings/subdomain 읽기 전용 조회에서 기존 observability enabled=true·redact_query_string=false와 previews_enabled=false를 확인했다. 새 버전 활성화·DB 쓰기·Secret 생성/교체·push·Production 작업 없음.

처음 두 strict 시도는 구성 차이 검사에서 업로드 전에 중단됐다. 새 버전 부재를 확인한 뒤 네 차이를 대조했고 승인된 새 코드/정적 파일·동일 DB 관리 정보·기존 변수 보존 범위에 해당함을 설명했다. 최신 원격 저장 버전과 산출물 불변을 재확인하고 사용자에게 이미 승인받은 비활성 업로드 범위 안에서 이번 명령의 strict 자동 중단만 생략하여 완료했다. keep-vars는 유지했으며 프로젝트 기본 배포 스크립트/strict 설정·로그인 권한은 변경하지 않았다. 자동 승인 리뷰 거절은 없었다.

| strict에서 발견한 차이 | 대조 결과 |
|---|---|
| `assets: {}` 추가 | 승인된 새 React 정적 파일 연결. 정적 파일과 Worker를 새 비활성 버전에 업로드 |
| 일반 변수 3개가 로컬 vars에 없음 | 키 원문을 Git에 쓰지 않은 구성이다. `--keep-vars`로 보존 요청. 실제 새 버전의 ACCESS_AUD·ACCESS_TEAM_DOMAIN·TURNSTILE_EXPECTED_HOSTNAME 값이 이전 저장 버전과 같음을 메모리 비교로 확인 |
| D1 관리 정보 추가 | database_name·preview_database_id·migrations_dir는 동일한 DB를 관리하는 정보. 새 버전의 DB는 기존 Preview ID와 일치하며 DB 생성/migration 없음 |
| 원격 redact_query_string=false 미명시 | 현재 script settings 조회에서 기존 enabled=true·redact_query_string=false 확인. 비활성 버전 조회 API 자체는 observability를 반환하지 않아 그 버전별 값까지 읽었다고 주장하지 않음 |

완료한 명령은 아래와 같다. 재실행 명령이 아니며 같은 버전을 중복 업로드하지 않는다.

```sh
WRANGLER_WRITE_LOGS=false WRANGLER_SEND_METRICS=false pnpm exec env CI=true wrangler versions upload --config dist/biblequiz_app/wrangler.json --name biblequiz-app-preview --keep-vars --tag p4-23-review --message 'P4-23 Preview code and saved bindings review'
```

버전 조회 결과:

| 설정 | 새 버전 확인 |
|---|---|
| ACCESS_AUD / ACCESS_TEAM_DOMAIN / TURNSTILE_EXPECTED_HOSTNAME | plain_text, 각각 이전 저장값과 동일 |
| ARCHIVE_CURSOR_SECRET / SESSION_PEPPER / TURNSTILE_SECRET | secret_text, 존재/타입 유지. 실제 암호화 원문 내용/동작은 미검수 |
| DB | d1, cb044032-7e26-452b-afae-b0cae3d93678 일치 |
| 새 버전 | number 10, 94f0f994-1146-4a34-b6ac-eba950d33a6f |
| 현재 트래픽 | 기존 c7b0e710 버전 100%, 새 버전 활성화 없음 |
| 별도 버전 URL | previews_enabled=false 유지 |

일시 근거는 `/tmp/biblequiz-p423-upload-result.json`, `/tmp/biblequiz-p423-upload-postcheck-final.json`, `/tmp/biblequiz-p423-script-settings-postcheck.json`이다. 오류 진단은 원문 설정값/이메일을 가린 파일만 남겼고 Wrangler 자동 로그를 껐다. API 확인에 쓴 기존 인증 토큰은 메모리의 인증 헤더에만 사용했다. 인증 범위 추가나 새 로그인은 없다.

이후 별도의 사용자 승인으로 위 3절의 정확한 버전 활성화를 완료했다. 비활성 업로드만으로 활성화까지 승인된 것으로 해석하지 않았다. 실제 Turnstile·Access/세션·제출 검수 및 승인된 합성 자료 준비·운영 규칙/WAF 결정은 같은 P4-23에 남는다. 실제 인물 이름 목록 보류는 유지한다. DB 준비·공개키 입력·동일 코드 업로드를 다시 요구하지 않는다.

이번 변경은 상태 문서 5개뿐이며 코드·빌드·SQL은 이전 검사 이후 동일하다. 기존 코드 검사 377건·실제 브라우저 88건 성공/2건 skip·WebKit 미검수와 실제키 build/두 dry-run 근거를 유지하고 반복 테스트는 하지 않았다. 공백·링크·파일 보존을 확인한다.

### 권장 실행 묶음: 먼저 비활성 코드 버전 준비

현재 연결된 Wrangler를 활용해 **검토한 코드의 비활성 Preview 버전 업로드 → 설정 대조 → 활성화**로 나누는 안이다. GitHub main push는 즉시 Preview 자동 배포를 일으키므로 설정 상속을 확인하기 전에 실행하는 첫 방법으로 택하지 않는다. 비활성 업로드와 설정 대조는 위 결과대로 완료했다. 아래 순서는 실행 이력과 남은 활성화 경계를 함께 설명한다.

1. 실제 공개 Site key 확보 후 동일한 소스로 Preview build·dry-run을 다시 실행한다. 테스트 키가 포함된 기존 `dist`를 재사용하지 않는다.
2. 승인받은 경우에만 명시적 Preview 대상의 비활성 버전을 올린다. 해당 Wrangler 명령의 설정 리다이렉트·대상을 직전에 확인한다. 업로드도 원격 쓰기이므로 무단 실행하지 않는다.
3. 새 version ID, runtime 이름/타입 6개, DB ID, hostname 일치 여부를 조회한다. Secret 원문·Access 값은 출력하지 않는다. 예상과 다르면 트래픽을 전환하지 않는다.
4. 이 대조 결과와 코드 변경 범위를 제시하고 실제 활성화 승인을 받는다. 이후 동일 범위를 반복 승인받지 않는다.
5. 활성화 후 실제 검사와 결과 기록까지 같은 묶음으로 수행한다. `main` push는 별도 Git 반영으로 검토하며 직접 배포를 Git 동기화 완료로 기록하지 않는다.

현재 활성 버전은 `fc10f77d-ca54-4dfd-a94a-9fb3cffcf482`다. 직전 버전 `94f0f994-1146-4a34-b6ac-eba950d33a6f`은 두 격자 수정 전의 검수 완료 버전이다. 오류 시 해당 버전으로 되돌릴 수 있으며 DB를 과거로 돌리거나 새 표를 DROP하는 동작은 포함하지 않는다. 실제 되돌림 직전 활성 버전/트래픽과 DB 호환을 재확인한다.

## 4. 합성 검수 자료 계획

사용자 승인으로 [등록 SQL](../tests/fixtures/preview-acceptance.sql)을 정확한 Preview D1에 실행했다. 기존 `tests/fixtures/published-quiz.sql`은 로컬 누출 검사 canary를 포함하므로 사용하지 않았다. [무제출 취소 SQL](../tests/fixtures/preview-acceptance-cancel.sql)과 [격리 검사](../scripts/check-preview-acceptance-fixture.mjs)도 준비돼 있다. `pnpm run check:preview-fixture`는 `/tmp` D1에서 등록·공개 API·정답 비노출·중복 충돌·참여 기록 보존·무제출 취소·FK/quick_check를 모두 통과했다. 이 검사는 package의 `pnpm check`에도 포함된다.

원격 실행 전 DB ID·migration 0000~0006·기존 콘텐츠/제출 0건·고정 ID/slug 충돌 0건·FK 오류 0건과 최신 bookmark를 확인했다. 등록 성공 후 번역·설교·세트·어린이 variant·solution 각 1행, 단서 6행, 자막·제출·site_state·정책 0행이며 FK 오류 0건·quick_check=ok다. 열림 기간은 2026-09-05T10:29:38.355Z부터 2026-09-12T10:29:38.355Z까지다. 비로그인 고유 주소는 Access 302를 유지한다.

2026-09-05 전체 `pnpm check`도 성공했다. 새 fixture 검사와 lockfile·Cloudflare·Drizzle·lint·typecheck, unit 22 files/223건, Worker 19 files/154건, production build를 통과했다. 실제 브라우저 E2E와 원격 Turnstile은 자료 등록 전이라 실행하지 않았다.

등록안은 `p423-preview-` ID와 `2026-09-05-p423qa` slug를 사용하고 실행 시점부터 7일간 연다. 실제 설교·성경 본문·자막·요약·사람/관리자 정보가 없으며 homepage의 `site_state`를 수정하지 않는다. 고유 주소에서만 확인한다. 기존 ID가 하나라도 있으면 덮어쓰지 않고 중단한다.

| 항목 | 검토할 등록 범위 |
|---|---|
| 용도·표시 | `기능 확인용 연습 문제 — 실제 설교 아님`으로 명시. 성경 본문·실제 설교/자막·실제 사람 이름 없음 |
| 고정 식별자 | `p423-preview-` 접두어의 번역 참조·설교·퀴즈·어린이 variant 각 1개, slug `2026-09-05-p423qa`. 기존 ID 충돌 시 덮어쓰지 않고 중단 |
| 퍼즐 | 5×5 공개 geometry·6개 시험 단서·별도 서버 채점 자료. 한국어 음절 조합 검사이며 성경 내용 생성 아님 |
| 공개 요약·자막 | 요약 null, 성경 본문 null, 실제 자막 등록 없음. 가능한 nullable transcript 연결 사용 |
| 기간 | 실행 시점 기준 짧은 검수 기간을 SQL에 명시. 과거 날짜/2099년 무기한 설정 사용 금지 |
| 목록 연결 | 현재 featured 상태를 읽어 보관하고 기존 값을 임의 교체하지 않음. 고유 주소 위주로 검수 |
| 제출 | 검수 담당이 지정한 가상 표시 이름으로 최대 3개 브라우저 세션. 실제 사람 개인정보를 시험 자료로 요구하지 않음 |
| 마감 | 정상 제출·중복·삭제·관리자 동작을 마친 뒤 시험 퀴즈 한 개를 마감해 정답/아카이브 전환 확인 |
| 종료·정리 | 제출은 기존 삭제 절차로 내용 제거. 관리자 동작은 감사에 관리자 신원이 기록된다는 점을 승인 범위에 포함. SQL로 감사 기록을 무단 삭제하지 않음 |

새 SQL 생성 전에 repository의 공개 DTO/채점 검증과 맞는지 확인한다. 단순 FK 성공만으로 실제 앱 검수 자료의 타당성을 보증하지 않는다. 제출·snapshot·moderation action의 참조가 생긴 뒤에는 quiz row 삭제를 임의 cascade/purge로 해결하지 않는다. 사전 등록 취소 SQL과 실제 참여 후 보존/삭제 절차는 서로 다르다.

실제 브라우저 검수는 정상 Turnstile → 세션 → 부분 제출 → 같은 요청 재시도/중복 방지 → 재방문 결과 → 본인 삭제 순서다. 별도 세션의 제출로 관리자 숨김/복구·마감·아카이브를 확인한다. 만료·거절 token에는 새 제출이 남지 않는지, 응답에 private 자료가 없는지 확인한다. 실제 token/JWT는 저장하지 않는다. 관리자 UI가 없으므로 로그인한 브라우저의 API 호출 등 가능한 검수 도구를 먼저 준비하며 사용자에게 화면에 없는 버튼을 누르게 하지 않는다.

## 5. 남은 운영 결정안과 종료 조건

### 규칙·보관 제안 — 미확정

- 초안 작성과 정규화·중복·오탐 검사는 에이전트가 준비하고 운영자가 최종 확인하는 방식을 제안한다. 별도 검수자 지정을 강요하지 않는다.
- 기본 예약 명칭 10개는 기존 코드 그대로 사용한다. 보호할 실제 이름은 사용자가 나중에 정하기로 했으므로 지금 다시 묻지 않는다. 실제 참여 공개 전 명단 확정 또는 명시적인 제외 결정이 필요하다.
- 초기 금지 목록은 명백한 욕설·직접적인 성적 모욕·혐오/위협 표현으로 좁게 작성하고, 원문·scope·exact/contains·허용 시험 문구를 한 표로 검토한다. 완성된 목록을 보지 않고 포괄 승인을 요구하지 않는다.
- `죽음`, `심판`, `죄`, `지옥`, `간음`, `목사님 말씀 감사합니다`는 개별 표현만으로 차단하지 않는다. 예외는 exact로 제한하고 URL/제어문자 같은 기본 검증을 해제하지 않는다.
- 실명 목록·정책 원문은 공개 저장소에 넣지 않고 운영자가 관리하는 기존 비공개 저장 위치를 제안한다. 위치가 미정이면 실명 수집/등록을 시작하지 않는다. 새 유료 서비스를 만들지 않는다.

### 요청 횟수 제한 제안 — 미확정

| 선택지 | 현재 판단 |
|---|---|
| 기존 명세의 zone WAF | 연결된 사용자 도메인/zone이 없어 현재 Preview에 그대로 적용하는 실행안이 성립하지 않음. 별도 도메인 구매·Production 생성은 진행하지 않음 |
| Workers Rate Limiting API | 현재 workers.dev에서 검토할 후보. 10초/60초, 지역별 비동기 카운터로 정확한 전역 제한은 아님. 설치된 Wrangler는 요구 버전 충족. API 자체의 명시적 무료 보장은 아직 미확인 |
| Access로 제한된 검수만 먼저 수행 | 운영자의 명시적 결정이 있으면 정책/횟수 제한 완료와 분리해 검수 가능. P4-23 완료나 공개 참여 개방으로 간주하지 않음 |

근거: [WAF 시작 조건](https://developers.cloudflare.com/waf/get-started/), [Workers Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/). 무료 적용 가능 여부를 확인하지 않은 채 무료라고 말하거나 유료 플랜으로 전환하지 않는다. IP는 교회 Wi-Fi의 여러 사람을 함께 가리킬 수 있으므로 사람별 1회 제출 제한은 기존 세션/D1 고유 제약으로 유지한다.

P4-23의 남은 완료 묶음은 **(1) 승인한 Preview 연결·실동작 검수, (2) 운영 규칙·요청 제한의 결정 및 승인 범위 적용**이다. 새 기능·새 서비스·새 설정이 필요해지면 이 두 범위와 어떤 관련인지 먼저 설명한다. 미확정 항목을 임의 면제하거나 P4-24로 넘겨 완료 처리하지 않는다.

## 6. 이번 변경·보존 확인

- 변경: `package.json`, `wrangler.jsonc`, `scripts/check-cloudflare-config.mjs`, 새 `scripts/check-preview-build-env.mjs`와 문서 6개(이 문서·README·STATUS·HANDOFF·운영안·implementation).
- 단계 시작의 기존 195개 파일 중 의도한 8개 수정 외 187개는 SHA-256 동일. 새 파일 2개이며 기존 untracked 자료·코드·시안·SQL은 보존했다. HEAD `0ab476e`, commit/push 없음.
- `git diff --check`와 변경 문서의 로컬 링크를 확인했다. 생성 검사 결과는 위와 같고 실제 배포/자료 등록은 남아 있다. 승인되지 않은 접근인 테스트 키 실제 배포, 로컬 canary fixture의 원격 복사, 설정 상속 확인 전 main push를 채택하지 않았다.
- 사용량: 시작 5시간 57%/주간 93%, 마무리 조회 44%/91% 남음. reset 사용 없음. P4-23 진행 중·P4-24 미시작·세션 유지, 다음 추천 Sol/High(설정 상속·배포 영향·운영 정책 검수).
