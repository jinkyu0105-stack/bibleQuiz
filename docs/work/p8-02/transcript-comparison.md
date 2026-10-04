# P8-02 자막 과거/현재 비교 — 2026-10-04

사용자가 과거 코드 비교·별도 실험과 Cloudflare 브라우저 소규모 시험을 승인했다. 후속 요청에서 운영 앱의 과거 경로 시험도 승인했다. DB 변경, 유료 전환, AI 호출, main push는 하지 않는다.

## 과거 실행본을 찾았으며 추측 복원은 불필요

비공개 영속 `recovery-2026-09-25/caption-provider.mjs`가 실제 당시 실행본이다. SHA-256은 `78e4d7e9a47367d4bc22cbbaa24544e03df48f315c6120a6a5630d63d5c900cd`다. 9월29일 보관 project의 TS 사본 해시 `47d025b184d68420b1b2e27ec2ac489ef61d9f6b2447cbf193a9a8160b51f4e4`가10월3일 첫 fetch 수정 전 source-before 지문과 같다. 번들에서 해당 모듈을 추출하고 esbuild의 var/const·class 할당·지역 변수명·Zod import 별칭만 정규화하면 이 TS와 정확히 같다. 과거 전체 실행본의 바이트가 현재 파일과 같다는 뜻은 아니다.

따라서 기존 성공 로직은 첫 운영 오류 수정 전까지 유지됐다. 첫 운영 실패는 `options.fetcher`의 native receiver 문제로 네트워크 요청 전 실패한 것이고, 이후 YouTube challenge와 구별한다.

복구 전 코드에서 달라졌던 부분은 (1) fetch 함수 참조를 분리한 native 호출 수정, (2) watch 내 player JSON 우선 사용/없을 때만 기존 POST, (3) 차단 전 기본 정보 보존, (4) 제목 없는 차단 결과의 oEmbed 제목 보완이다. 한국어 track 선택과 자막 파싱/저장 형식은 유지됐다.

## 같은 새 영상의 실제 결과

| 환경 | 과거 로직 | 복구 전 watch 우선 로직 |
|---|---|---|
| 로컬 WSL Node24.18 | 성공,1,181ms,768구간/12,993자 | CAPTION_TRACK_EMPTY,783ms,자막 응답0bytes |
| Cloudflare 임시 remote Worker | 성공,576ms,768구간/12,993자 | CAPTION_TRACK_EMPTY,555ms,자막 응답0bytes |

로컬은 보관된 실제 번들을 사용했다. 원격의 과거 로직은 native fetch 호출을 `(…args)=>fetch(…args)`로 전달해 이미 알려진 receiver 오류만 배제했다. 두 경로는 같은 임시 Worker에서 각각 한 번 수행했으며 기존 운영 앱/DB/Secret에 연결하지 않았다. 원격 성공 결과와 로컬 성공 결과의 모든 시간 구간/텍스트 및 SHA가 같다. 현재 로직은 추가 player POST 없이 watch 제공 자막 주소를 사용했고 빈 본문을 받았다. 한 번씩의 비교는 이번 경로 차이를 보이나 장기 성공률이나 이전 challenge가 영구 해결됐음을 뜻하지 않는다.

Python 요청 두 번과 GET 확인은 Cloudflare preview 입구403/1010으로 실행 코드에 도달하지 않았다. Node fetch의 GET405로 정상 접근을 확인한 뒤 두 POST는 각각200이었다. 사용자 에이전트 조작·로그인/쿠키 수집·프록시/차단 우회는 하지 않았다. 임시 remote 실행은 종료했다. 원문은 Git 제외 `.wrangler/releases/p8-02-transcript-comparison-20261004`에 보존했고 기존 자막 파일을 덮지 않았다.

## Cloudflare Browser Run 실제 시험

[단일 직접 요청 실행기](../../../scripts/transcript-probe/direct.mjs), [브라우저 실행기](../../../scripts/transcript-probe/cloud-browser.mjs)는 기존 Playwright를 사용한다. Cloudflare CDP 세션 생성 → 영상 열기 → 설명 펼치기 → 스크립트 표시 → 행 읽기/비공개 보존 → 명시 종료 순서다. 자동 재시도·AI·운영 DB 쓰기는 없다. 60초 keep-alive/연결 후60초 watchdog과 단계 timeout을 둔다.

사용자가 최소 account:read/browser:write 전용 프로필 인증을 완료했다. 기존 기본 Wrangler 인증은 유지했다. 앞선 넓은 범위 OAuth 요청의 자동 승인 거절은 최소 별도 프로필로 해결했다. 실제 Cloudflare 브라우저 시험 두 번 모두 watch200, 설명/스크립트 버튼 클릭 성공, 자막 행 대기 시간 초과였다. 첫 시험26,730ms, 구형/신형 행 선택자와 실패 화면 수집을 보완한 두 번째22,519ms다. 두 세션 모두 명시 종료를 확인했다. 두 번째 화면에는 영상/설명과 Show transcript가 있었지만 자막 행이나 명시적인 차단/오류 문구는 없었다. 이를 YouTube challenge로 단정하지 않는다. 브라우저 자막 취득은 아직 실패이며 운영 연결도 하지 않았다.

두 시험의 전체 경과시간 합계49.249초는 브라우저 실행 시간의 상한이며 Free 하루600초보다 작다. 계정 전체의 일일 사용량/최종 청구액을 증명한 수치는 아니다. 추가 유료 플랜·상시 서비스·의존성은 만들지 않았다. 진단/화면은 Git 제외 비교 폴더의 cloud-browser-live/와 cloud-browser-diagnostic/에 보존한다.

## 운영 앱 복구와 검사

사용자가 운영 앱에서도 과거 코드로 시험하도록 요청했다. watch → 기존 player POST → 한국어 자막 조회 순서를 복구하고, native fetch 참조 분리·일치 video ID의 metadata 보존·제목 없는 차단 미리보기의 oEmbed 보완은 유지한다. 기존 한국어 track/파싱/저장·중복 처리·차단 자동 재시도 금지는 변경하지 않는다. watch에 오래된 caption URL이 있어도 새 player 응답을 사용하는 회귀 검사를 추가했다. 관련90개와 전체 `pnpm check`가 통과했다(unit308/Worker2165/Workflow4/복구CLI2/Node14/Python6·lint/typecheck/Drizzle/build). 소스 커밋 `a5d46765705f24446b9a8c083a33339015c42096`에서 운영 앱 `ad9ebbf0-be59-4941-af42-ea063e97f984`100%를 배포했다. 직전 `033e9ead-1e0c-4c37-b9e1-75e7b9cbdfbf`는 호환 rollback 후보다. Production build/strict·후보binding/runtime 대조·공개200/관리자4경로302가 통과했다. 모든vars/Secret명·content/backup/Preview/예약과 참가1/제출2/call7/usage7/860448microUSD/migration39/FK0을 보존했다. 소스657개 중2개변경·산출물73개를 고정했고 기본dist/deploypointer를 복구했다. 사용자가 운영 관리자 조회 결과를 제공했다. 제목·설교일·성경 장절·책 선택은 정상이며 자막은 player challenge로 실패했다. 아래 실제 운영 검수 결과를 따른다. agent의 인증된 조회 성공으로 쓰지 않는다. 배포 근거는 Git 제외 `.wrangler/releases/p8-02-transcript-restoration-20261004`다.

과거 직접 요청의 임시 Worker 성공은 사실이나 운영 앱의 재현 성공을 뜻하지 않는다. 운영 직접 요청과 Browser Run 모두 현재 자동 원본 취득에 실패했으므로 같은 경로의 반복 배포/사용자 재시도 대신 아래 대안을 검토한다.

공식 근거: [CDP/Playwright](https://developers.cloudflare.com/browser-run/cdp/playwright/), [요금](https://developers.cloudflare.com/browser-run/pricing/), [한도](https://developers.cloudflare.com/browser-run/limits/), Context7 `/cloudflare/cloudflare-docs`. 실행된 Wrangler4.125.0의 browser create/list/close 및 auth create 구현도 대조했다.

## 운영 검수 결과와 다음 자동 취득 후보 — 2026-10-04

사용자 진단 시각 `2026-10-04T12:41:45.590Z`에서 복구 앱은 `TRANSCRIPT_SOURCE_BLOCKED`, player/challenge, HTTP200 JSON 6,988bytes, 총853ms(watch706ms/player147ms)였다. track 선택 전에 실패했다. 이 code는 현재 provider에서 `LOGIN_REQUIRED`와 “Sign in to confirm you're not a bot” 응답 조합으로만 나온다. HTTP200을 자막 취득 성공으로 해석하지 않는다. 제목·일자·장절·책 dropdown 자동 입력은 사용자가 정상 확인했다. 게시일은 미확인이다. 기본 정보 조회와 자막 원본 취득을 분리한다.

운영/임시 Worker 모두 같은 watch→ANDROID player POST→timedtext 순서와 요청 본문을 쓴다. 운영 호출은 전역 fetch를 직접 전달하고 내부에서 참조를 분리하며 관리자 요청의 cookie/Authorization을 YouTube에 전달하지 않는다. 임시 Worker는 전역 fetch wrapper였다. 임시 성공 시각과 이번 운영 실패 시각/실행 요청 위치가 다르므로 IP 평판·출발 위치·시간 중 어느 것이 원인인지는 입증되지 않았다. Cloudflare 브라우저도 해당 사이트의 접근 허용을 보장하지 않는다. [Cloudflare FAQ](https://developers.cloudflare.com/browser-run/faq/).

사용자는 채널을 시청할 수만 있고 영상/자막 편집 권한이 없다고 확인했다. [공식 captions.download](https://developers.google.com/youtube/v3/docs/captions/download)는 편집 권한이 필요하므로 현재 해결 후보에서 제외한다. 로그인 cookie 수집이나 반복 challenge 재시도를 새 해결책으로 추가하지 않는다.

### 검토 가능한 작은 시험 제안 — 아직 채택/호출하지 않음

운영 서버 단독 자동화를 우선하려면 **Supadata의 기존 자막 전용 무료 시험 1건**을 후보로 제안한다. [공식 요금](https://supadata.ai/pricing)은 Free 월100credits/카드 불필요, 기존 자막 취득1건=1credit, Free 소진 시 추가 요청 차단이다. 주1편·미리보기1회/원본저장1회라면 월4~5편은8~10credits라는 계산이며 실패/재요청은 별도다. 유료 최저안은 Basic 월환산USD5지만 연USD60 결제이며 자동 도입하지 않는다. 새 외부 서비스이므로 사용자의 채택 결정 전 가입/키 저장/실제 영상 전달/운영 연결을 하지 않는다.

승인 시 먼저 무료 계정과 API 키를 준비하고, 운영 DB와 분리한 Cloudflare 시험에서 `GET /v1/transcript`에 같은 공개 영상 URL·`mode=native`·`lang=ko`·`text=false`로 한 번 요청한다. 외부에 전달할 자료는 공개 영상 URL이며 기존 원문·AI 결과·관리자 인증은 전달하지 않는다. 기본 mode=auto는 AI 전사로 전환될 수 있으므로 사용하지 않는다. 응답의 실제 언어가 한국어인지 확인하고, 시간 구간/전체 텍스트/빈 결과/기존 보관 자막과의 대조를 수행한다. 다른 언어가 fallback될 수 있으므로 요청 lang만으로 한국어 성공이라 판정하지 않는다. 202라면 job ID를 보존하고 새 생성 요청 없이 같은 job 상태만 확인한다. 수신 결과는 비공개 보존하며 이 시험 자체는 등록/원본 DB를 수정하지 않는다. [API 계약](https://docs.supadata.ai/get-transcript).

이 후보의 해당 영상 성공은 아직 미검증이다. 무료 시험 성공 뒤에만 기존 관리자 provider/불변 원본 저장에 연결할 구현 범위를 정한다. 별도 SDK는 필수 아님(기존 fetch 사용 가능). 서비스 종료/무료 한도/접근 제한이라는 의존성이 생긴다.

새 서비스 없이 가려면 이미 성공한 로컬 브라우저 프로그램을 관리자 화면과 연결할 수 있다. 프로그램이 자막을 읽어 운영 서버로 보내므로 사용자 수동 복사는 필요 없으나 사용자 PC가 켜져 있어야 하며 설치/실행·인증 연결 구현이 남는다. 서버만으로 실행된다는 목표와는 다른 운영 조건이므로 자동 채택하지 않는다. 이번 설교만 진행하려면 이미 저장한 원본을 재사용할 수 있으나 매주 서버 자동 취득 문제가 해결됐다고 쓰지 않는다.

공식 Cloudflare FAQ와 Context7 `/cloudflare/cloudflare-docs`를 대조했다. Context7의 일반 네트워크/Challenge 문서는 이번 YouTube 차단 원인의 증거로 사용하지 않았다.

이번 turn은 실제 검수 결과·대안 문서만 갱신했다. 운영 코드/배포/DB/서비스/Secret/AI 호출 변경0이며 기존 필수 검사와 입력/PDF 결과를 재사용한다. 문서 링크·JSON·diff 검사 후 로컬 커밋한다. P8-02/Phase8은 자막 자동 취득 미해결로 진행 중이다.

### 무료 시험 승인과 준비

사용자가 무료 한 편 시험을 승인하고 키를 기존 숨김 입력 도구로 저장했다. `receive-quality-secret.py supadata`는 기존 OpenAI/Access와 다른 `supadata.key`를0600으로 저장한다. 키 값은 대화/로그/Git에 표시하지 않는다. 별도 [시험 Worker](../../../scripts/transcript-probe/supadata-native.mjs)는 native/ko/text=false를 고정하며 다른 언어·빈 자막·잘못된 시간 순서·3만 자 초과를 거부한다. 임시 Worker에 난수 인증과 no-store를 적용하고 운영 DB/Worker/라우트에는 연결하지 않는다. 202는 job ID만 보존하고 새 자막 요청을 자동 재전송하지 않는다.

합성 Node4개·비밀값 저장 Python7개·변경 JS ESLint가 통과했다. 새 의존성/제품 TypeScript/배포 단위 변경이 없어 전체 pnpm check와 입력/PDF 검사는 반복하지 않는다. 실제 무료 호출 결과는 아래 후속 기록을 따른다.
