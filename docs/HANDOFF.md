# 다음 작업 인수인계

## 현재 작업과 Git

**P9-23 광원 조절·달빛·효과 메뉴 — 구현·로컬 검수 완료, Preview 반영 중.** `/home/onegem/work/bibleQuiz`, main `f841cea`/clean에서 재개했다. 시작 시 origin/main `0fbde84`보다37커밋 앞섰다. 사용자가 이번 검사 후 push를 명시 승인했으며 누적 UI 변경과 이번 수정이 함께 Preview 자동 배포에 들어간다. Production 배포·원격 자료 변경·AI·migration 승인은 아니다. 정확한 Git 상태는 `git status --short`·`git log -3`으로 재확인한다.

## 현재 구현과 코드 진입점

- 홈의 `ThemeControl` → `HomeEffectsControl.tsx`/`home-effects-control.css`. ‘효과’ 글자를 없애고 같은 `GlassMenu`의 유리 받침과 spring을 재사용한다. 펼침360ms, 이탈180ms, PC60×214·모바일176×44px,44px 선택 영역. 반사/빛줄기 독립 선택과 체크·pressed를 유지한다.
- `VeilControls.tsx`는 화면 안에 고정하는 포털 패널이다. 너비/밝기/퍼짐65/55/60 기본값, 즉시 반영·브라우저 저장·초기화·꺼졌을 때 켜기를 지원한다. `veil-settings.ts`가 잘못된 저장값을 정리한다. 열린 패널은 포인터 이탈로 닫지 않으며 Escape·외부 클릭·초점 이탈과 초점 복귀를 처리한다.
- `hero-effects.ts`는 한 캔버스·한 루프에서 반사/빛줄기를 선택한다. 광원을 넓은 띠로 바꾸고 밤에는 실제 달 이미지의 cover 크롭 좌표에서 왼쪽 아래로 번지는 은빛을 사용한다. 모바일의 화면 밖 달을 억지로 옮기지 않는다. 최종 버퍼 최대640×480/DPR1/30fps. 멈춤 중 수치 변경은 한 정지 프레임만 갱신한다.
- 메인 첫 구역 영상 위·제목 아래만 적용한다. 화면 밖·탭 숨김 정지, 선명하게/접근성 우선, GPU 복구/미지원 대안을 유지한다. 새 의존성·유료 원본·외부 서비스는 없다.
- [정본](spec/design.md#효과-선택기와-veil-rays), [중간 실패·성공·성능·배포 확정 기록](work/P9-23.md#광원-조절과-달빛-후속).

## 검사와 남은 범위

관련 E2E39항목 성공을 여러 실행에서 확인했다. 최초33통과·6실패·6제외 뒤 테스트 동기화5건을 고치고 모바일 스크롤1건과 함께 최종9건을 통과했다. Firefox GPU전용6항목은 제외하며 실패 없는 단일45항목 실행이라고 보고하지 않는다. 전체 `pnpm check`2548건·lint/typecheck/build 통과. 최종640×480 상한에서도 GPU12건과 전체check2548건·lint/typecheck/build를 재통과했다. Lighthouse 효과 없음/혼합55/33, TBT250/1590ms로 소프트웨어 GPU의 합성 부담은 남으며 픽셀 감소를 실행 성능 개선으로 단정하지 않는다. 기존500kB fontkit·정적/동적 import 경고는 남는다.

실제5173의 네 시간대×1440/390/320px에서 재생·정지·빛줄기/혼합·조절·범위 양 끝과 유리 받침 이동을 확인했다. 가로 넘침·GPU/pageerror·자료 쓰기0. 실기기·Safari·화면 읽기 프로그램과 Access 로그인 뒤 실제 원격 저장은 검증하지 않는다. Lighthouse는 소프트웨어 GPU의 모바일 모의값이며 실기기 성능 보장값이 아니다.

증거는 ignored `.wrangler/releases/p9-23/light-*`의 로그·JSON·PNG다. 대표 실제 이미지만 `docs/design/phase-9/home-effects/`에 보존한다. `.wrangler` HTTP는403이므로 사용자에게 링크하지 않는다.

## 실행과 다음 첫 작업

- 실제 홈: http://localhost:5173/ — 재생 아래 별 모양 아이콘 → 빛줄기 → 조절. 빛줄기만 보려면 반사를 끈다.
- 실제 밤 화면: http://localhost:5173/docs/design/phase-9/home-effects/night-controls.png
- 실제 모바일: http://localhost:5173/docs/design/phase-9/home-effects/mobile-controls.png
- 관리자 비교: http://localhost:5173/docs/design/phase-9/admin-boards/review#workspace

홈과 대표 이미지의HTTP200/PNG를 확인했으며 사용자 화면에 표시됐다는 확인과 구별한다.5173과 `.wrangler/ui-demo-state`를 보존했다. 꺼지면 프로젝트 루트에서 `pnpm dev:demo --port 5173 --strictPort`. Node24.18.0/pnpm11.14.0이며 필요할 때만 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 현재PATH에 추가한다. E2E는 별도4173이고 동시에 여러 번 실행하지 않는다.

명령은 검증된 `/bin/bash`, `login:false`, 명시workdir, `require_escalated` 승인 검토 경로를 쓴다. 도구 시작 실패 시 `codex-exec-recovery`에 따라 다른 허용 경로를 검증하며 승인 거부는 우회하지 않는다. Windows Node REPL의 WSL경로 실패를 반복하지 않고 WSL Playwright를 사용했다.

시작 Pro잔여63%×사용자 지정10=630%, 별도5시간 창 없음. 다음 구현 전 현재 사용량을 확인한다. AGENTS → PROJECT_CONTEXT → DECISIONS → STATUS → HANDOFF → implementation 관련 정본 → P9-23 → Git상태/diff/log 순서다.

배포 전 Preview는 소스 `0fbde84` / version `cd6efb0e-2c05-4401-b0bf-692bdf18c5b1`이다. 이번 push 후 실제 버전을 확인해 이 절을 갱신한다. Production은 소스 `37b7254` / version `7aea6843-5288-42da-9bef-bc673e1d9dfe`를 유지한다.

폐기한 접근: 밤의 상단 중앙 광원, 모바일 달을 가상으로 이동, 효과마다 새 루프, overflow 영역 안의 조절 패널, spring 중간 좌표를 도착 위치로 검사하기. 새 구현은 같은 P9-23의 사용자 피드백으로만 진행한다.

**현재 P9-23 Preview 반영 중 · 부모 홈 효과 보정 로컬 완료 · 다음 push/자동 검사·배포 확인 · 세션 유지 · 다음 추천 GPT-6.1-sol/medium** — 자동 검사와 소스/버전 대조에 적합하다.
