# 다음 작업 인수인계

## 현재 작업과 Git

**P9-23 초기 로딩·반사 조절 — 로컬 구현/검수 완료, main push와 Preview/CI 확인 대기.** 실제 `/home/onegem/work/bibleQuiz`의 main/origin **aa422c4**·clean에서 시작했다. 관련 없는 변경은 없었다. 이번 기능 커밋의 정확한 소스는 `git log -3`, 작업 상태는 `git status --short`·`git rev-list --left-right --count origin/main...HEAD`로 확인한다. 사용자 앞선 main push 승인은 유지되며 Preview 자동 반영만 포함한다. Production·원격 자료·AI·migration·Secret/Access는 변경하지 않는다.

## 구현과 코드 진입점

- `sky-v2/components/glass.js`: 화면80px 안에 가까운 유리만 정확한 굴절 지도를 준비한다. 두 정규화 메뉴 지도를 공유하고 CPU 캔버스로 직렬화해 GPU 대기를 줄였다. 기존 RGB 수식/지도 크기/CSS 재질·키보드·스크롤 뒤 복원을 보존한다.
- `world.js`/`sky-banks.js`/`sky-video.js`: 첫 화면의 완전 투명 구름5장은 하강 때 준비하며 영상/포스터 대기 중 잠깐 쓰일 보조 GPU는 만들지 않는다. 영상 제외/실패 대안은 유지한다. `HeroEffects`는 첫 화면을 그린 뒤 GPU를 초기화하고 `home-page`는 실제 풀이 진입 때 코드를 읽는다.
- `HomeEffectsControl`/`EffectControls`/`mercury-settings`/`hero-effects`: 반사도 누르면 켜지고 옆에 제어판을 연다. 밝기10~100·물결 크기0~100·흐름 속도0~100, 기본50/50/50은 이전 승인 모습이다. 속도0은 흐름 정지이며 속도 조절 순간 무늬가 튀지 않는다. 두 효과는 공통 제어판을 사용하되 저장은 독립이다. 닫기/Escape는 효과를 유지하고 해당 버튼으로 초점을 돌린다. 열린 버튼을 다시 누르면 해당 효과만 끈다.
- [정본](spec/design.md#초기-로딩과-기존-재질-보존--p9-23) · [진단·측정·실패/보정·검사](work/P9-23.md#초기-로딩과-반사-조절-후속). 앞선 작은 마지막 목록·스크롤/빛줄기 조작은 같은 작업 문서의 이전 절에 보존한다.

## 확정 검사와 한계

최종 앱의 `pnpm check`2550건(unit317/Worker2206/Workflow4/recoveryCLI2/Node14/Python7), lint/typecheck·구성·migration·build 통과. 마지막 검사 조건 보정 뒤 lint/typecheck도 통과했다. 첫 PC/모바일54항목은51통과·1제외·2실패, 관리자 공통 유리를 포함한 재검사10항목은8통과·1제외·1실패다. 스크롤 재질 비교/사전 범위를 보정했고, 마지막 실패는 기존 Router 위치 복원으로 첫 화면을 벗어난 검사 조건이었다. 앵커만 추가한 반복1통과·3실패 뒤 새 탭의 초기 표시와 구분한 최종 반복4통과다. 앱의 위치 복원 정책/가시성 검증은 유지했다. Firefox12통과·Chromium 전용2제외·재시도0. 세부 로그는 작업 문서를 따른다. 원격 전체CI는 이번 push 뒤 확인한다.

실제5173에서 네 시간대×1440/390/320px의 영상 재생·반사 제어·초점·범위·아래 유리/잔디·푸터12상태를 확인했다. 넘침·pageerror·쓰기API0. PC/모바일의 같은 정지 장면4장을 직접 대조했고 기본 반사/빛줄기 출력과 헤더 굴절 지도 해시가 각각 일치했다. 대표PNG6장의HTTP200/image/png/바이트 일치와 브라우저 디코딩, 비교 페이지 PC/모바일 넘침0을 확인했다.

같은 빈 캐시·390×844·10Mbps/40ms·CPU4배 지연·영상/두 효과 켬·SwiftShader에서 전후 각3회 중앙값 LCP2408→1824ms, 첫 영상 프레임 콜백5390→3827ms, 최초5초 긴 작업 대기1893→730ms, 전체 전송량5,703,556→5,244,397B다. 영상 제외 자산은42% 감소지만 영상 포함은8%다. 실제 모니터 출력/Windows 기기 성능 보장은 아니다. 별도 Lighthouse65/접근성100·LCP4.1초/TBT600ms/CLS0은 다른 측정 조건이며 이전 점수와 직접 비교하지 않는다. 초기 영상·JS 부담, 기존 fontkit 큰 청크/선명하게 접근성 이름 진단, Safari/실기기/화면 읽기 프로그램·Access 로그인 뒤 원격 UI 미검증 한계는 남는다.

## 측정 자료와 실행

- [실제 메인](http://localhost:5173/): 재생 아래 별 아이콘 → 반사 또는 빛줄기.
- [전후 화면·수치·반사 제어판](http://localhost:5173/docs/design/phase-9/home-effects/loading-review.html) · [회차별 수치/화면 검수 JSON](design/phase-9/home-effects/loading-metrics.json). HTTP 검사와 사용자 Windows 표시 확인을 구분한다.
- ignored `.wrangler/releases/p9-23/initial-*`가 원자료다. `initial-before/client`는 변경 전 배포용 빌드, `initial-probe.mjs compare`는 최종 전후 측정, `initial-visual.mjs`·`initial-report.mjs`는 실제 캡처/비교표다. `initial-check.log`, `initial-e2e.log`, `initial-recheck.log`, `initial-cold-tab-final.log`, `initial-firefox.log`를 구분한다.
- 읽기 전용 임시4187/4188은 이전/최종 빌드를 제공한다. 종료 때 이 두 서버만 닫고5173과 `.wrangler/ui-demo-state`를 보존한다.5173이 꺼지면 프로젝트 루트에서 `pnpm dev:demo --port 5173 --strictPort`.
- Node24.18.0/pnpm11.14.0. 필요 시 PATH에 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 추가한다. 검증된 명령 경로는 `/bin/bash`·`login:false`·명시workdir·`require_escalated` 검토다. 시작 실패는 codex-exec-recovery를 따르고 승인 거부를 우회하지 않는다. E2E는 별도4173에서 한 번씩 실행하며 성능 측정 중 다른 빌드/검사를 돌리지 않는다.

## 원격 확인 기준

이번 push 전 Preview는 문서 소스aa422c4/version **7b9a76d6-7a5a-4871-8e40-685de211c16c**, 이전 기능 소스는c677d93이다. Production app은 **7aea6843-5288-42da-9bef-bc673e1d9dfe**·100%, Preview binding16개·AI_GENERATION_ENABLED=false다. main push 뒤 GitHub CI와 Workers Builds check의 소스SHA/version을 실제 Cloudflare deployments와 대조하고 기록한다. Builds 목록 커넥터는12004이므로 반복/우회하지 않고 GitHub check의 명시적 연결을 쓴다. PreviewHTTP302 Access는 인증 후 원격UI 검수 완료가 아니다.

결과 문서만의 후속 커밋은 기능 소스와 구별한다. 필수 전체검사를 실행한 앱/검사/워크플로와 차이가 없을 때 문서 커밋에만 `[skip actions]`를 쓰되 Cloudflare 자동 빌드 결과를 확인한다.

시작 사용량은 Pro잔여51%×사용자 지정10=510%, 별도5시간 창 없음. 새 구현 전 현재 값을 확인한다. 읽기 순서는 AGENTS→PROJECT_CONTEXT→DECISIONS→STATUS→HANDOFF→implementation의 관련 정본→P9-23→Git 상태/diff/log다.

폐기한 접근: 원본 영상 화질/해상도·효과 밀도 줄이기, 유리 수식을 단순화하기, 측정 숫자를 위한 시간 지연, 다른 조건의 수치를 전후 개선율로 표현하기, 새 탭의 초기 준비 검사에서 이전 탭의 복원 위치를 첫 화면으로 오인하기.

**현재 P9-23 로컬 검수 완료 · 부모 초기 로딩/반사 조절 Preview 반영 대기 · 다음 main push와 원격 결과 확인 · 세션 유지 · 다음 추천 GPT-6.1-sol/high** — 검사 소스와 자동 배포의 대응을 확인한다.
