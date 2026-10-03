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

사용자가 운영 앱에서도 과거 코드로 시험하도록 요청했다. watch → 기존 player POST → 한국어 자막 조회 순서를 복구하고, native fetch 참조 분리·일치 video ID의 metadata 보존·제목 없는 차단 미리보기의 oEmbed 보완은 유지한다. 기존 한국어 track/파싱/저장·중복 처리·차단 자동 재시도 금지는 변경하지 않는다. watch에 오래된 caption URL이 있어도 새 player 응답을 사용하는 회귀 검사를 추가했다. 관련90개와 전체 `pnpm check`가 통과했다(unit308/Worker2165/Workflow4/복구CLI2/Node14/Python6·lint/typecheck/Drizzle/build). 소스 커밋 후 앱만 배포하고 실제 관리자 조회를 검수한다.

과거 직접 요청이 Cloudflare에서 성공했으므로 두 방식 모두 실패했다는 조건은 성립하지 않는다. 별도 서비스 도입보다 기존 경로 복구를 우선하며 장기 성공률은 보장하지 않는다.

공식 근거: [CDP/Playwright](https://developers.cloudflare.com/browser-run/cdp/playwright/), [요금](https://developers.cloudflare.com/browser-run/pricing/), [한도](https://developers.cloudflare.com/browser-run/limits/), Context7 `/cloudflare/cloudflare-docs`. 실행된 Wrangler4.125.0의 browser create/list/close 및 auth create 구현도 대조했다.
