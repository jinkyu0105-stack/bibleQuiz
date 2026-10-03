# P8-02 자막 과거/현재 비교 — 2026-10-04

사용자가 과거 코드 비교·별도 실험과 Cloudflare 브라우저 소규모 시험을 승인했다. 기존 앱/DB 연결, 유료 전환, AI 호출, main push는 이번 시험에서 하지 않는다.

## 과거 실행본을 찾았으며 추측 복원은 불필요

비공개 영속 `recovery-2026-09-25/caption-provider.mjs`가 실제 당시 실행본이다. SHA-256은 `78e4d7e9a47367d4bc22cbbaa24544e03df48f315c6120a6a5630d63d5c900cd`다. 9월29일 보관 project의 TS 사본 해시 `47d025b184d68420b1b2e27ec2ac489ef61d9f6b2447cbf193a9a8160b51f4e4`가10월3일 첫 fetch 수정 전 source-before 지문과 같다. 번들에서 해당 모듈을 추출하고 esbuild의 var/const·class 할당·지역 변수명·Zod import 별칭만 정규화하면 이 TS와 정확히 같다. 과거 전체 실행본의 바이트가 현재 파일과 같다는 뜻은 아니다.

따라서 기존 성공 로직은 첫 운영 오류 수정 전까지 유지됐다. 첫 운영 실패는 `options.fetcher`의 native receiver 문제로 네트워크 요청 전 실패한 것이고, 이후 YouTube challenge와 구별한다.

현재 코드와 달라진 부분은 (1) fetch 함수 참조를 분리한 native 호출 수정, (2) watch 내 player JSON 우선 사용/없을 때만 기존 POST, (3) 차단 전 기본 정보 보존, (4) 제목 없는 차단 결과의 oEmbed 제목 보완이다. 한국어 track 선택과 자막 파싱/저장 형식은 유지됐다.

## 같은 새 영상의 실제 결과

| 환경 | 과거 로직 | 현재 로직 |
|---|---|---|
| 로컬 WSL Node24.18 | 성공,1,181ms,768구간/12,993자 | CAPTION_TRACK_EMPTY,783ms,자막 응답0bytes |
| Cloudflare 임시 remote Worker | 성공,576ms,768구간/12,993자 | CAPTION_TRACK_EMPTY,555ms,자막 응답0bytes |

로컬은 보관된 실제 번들을 사용했다. 원격의 과거 로직은 native fetch 호출을 `(…args)=>fetch(…args)`로 전달해 이미 알려진 receiver 오류만 배제했다. 두 경로는 같은 임시 Worker에서 각각 한 번 수행했으며 기존 운영 앱/DB/Secret에 연결하지 않았다. 원격 성공 결과와 로컬 성공 결과의 모든 시간 구간/텍스트 및 SHA가 같다. 현재 로직은 추가 player POST 없이 watch 제공 자막 주소를 사용했고 빈 본문을 받았다. 한 번씩의 비교는 이번 경로 차이를 보이나 장기 성공률이나 이전 challenge가 영구 해결됐음을 뜻하지 않는다.

Python 요청 두 번과 GET 확인은 Cloudflare preview 입구403/1010으로 실행 코드에 도달하지 않았다. Node fetch의 GET405로 정상 접근을 확인한 뒤 두 POST는 각각200이었다. 사용자 에이전트 조작·로그인/쿠키 수집·프록시/차단 우회는 하지 않았다. 임시 remote 실행은 종료했다. 원문은 Git 제외 `.wrangler/releases/p8-02-transcript-comparison-20261004`에 보존했고 기존 자막 파일을 덮지 않았다.

## Cloudflare Browser Run 시험 준비와 인증 대기

[단일 직접 요청 실행기](../../../scripts/transcript-probe/direct.mjs), [브라우저 실행기](../../../scripts/transcript-probe/cloud-browser.mjs)를 추가했다. 기존 Playwright를 사용하므로 의존성 추가는 없다. 브라우저는 Cloudflare CDP에서 세션 생성 → 영상 열기 → 설명 펼치기 → 스크립트 표시 → 행 읽기/비공개 보존 → 명시 종료한다. 자동 재시도·AI·운영 DB 쓰기 없음. 60초 keep-alive/연결 후60초 watchdog과 단계 timeout을 둔다. 실측 시간은 별도 보고하며 월 청구액 검증으로 확대하지 않는다.

공식 Browser Run은 Free에서 하루10분/동시3개다. 기존 Wrangler 인증으로 세션 목록이401이었고 읽기 전용 요청으로 OAuth 갱신 후에도401이다. 기존 scopes에 browser:write가 없다. 기존 넓은 쓰기 scopes를 보존해 로그인하려던 명령은 자동 승인 검토가 과도한 권한으로 거절했고 실행하지 않았다. 최소 account:read/browser:write 전용 프로필 경로는 승인됐으나 login --profile은 CLI가 지원하지 않아 auth create로 수정했다. 실제 인증 승인을 기다리다 첫 링크가 만료됐다. 기본 인증 범위/운영 설정은 변경하지 않았다. Browser Run 세션은 아직 생성하지 않았으며 YouTube 성공/차단·사용시간은 미검증이다. 사용자 인증 후 이 프로그램을 한 번 실행한다. 인증 실패를 YouTube 실패로 세지 않는다.

## 검사와 다음 동작

두 실행기 Node 문법 검사, ESLint(브라우저 evaluate의 document 전역 주석 보완 후), 프로젝트 lint/typecheck가 통과했다. 제품 TypeScript/의존성/migration 변경이 없어 기존 전체 pnpm check/입력/PDF 검사를 반복하지 않았다. 이번 변경 diff/문서 링크를 확인하고 로컬 커밋한다. 기존 런타임657개 지문 보존을 대조한다.

과거 로직의 Cloudflare 성공을 근거로 새 외부 서비스를 필수로 도입할 이유는 없다. 기존 경로의 복귀/수정이 더 작은 운영 해결 후보이며, 실제 운영 앱 연결·장기 안정성은 아직 완료가 아니다. 사용자가 요청한 브라우저 비교 시험은 인증 후 이어간다. 두 방법 모두 실패한 조건은 현재 성립하지 않는다.

공식 근거: [CDP/Playwright](https://developers.cloudflare.com/browser-run/cdp/playwright/), [요금](https://developers.cloudflare.com/browser-run/pricing/), [한도](https://developers.cloudflare.com/browser-run/limits/), Context7 `/cloudflare/cloudflare-docs`. 실행된 Wrangler4.125.0의 browser create/list/close 및 auth create 구현도 대조했다.
