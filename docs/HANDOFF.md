# 다음 작업 인수인계

## 현재 작업과 Git

**P9-23 광원 조절·달빛·효과 메뉴 — 검수·푸시·Preview 반영 완료.** /home/onegem/work/bibleQuiz의 main f841cea/clean에서 재개했고 당시 origin/main 0fbde84보다37커밋 앞섰다. 사용자의 명시 승인으로 누적 UI 변경과 이번 수정을 main에 push했다. 기능 구현은7dce3c2, CI 보정까지 검증한 소스는 **8842413a907822ca78d6f83561eae60b7d42663a**다. 결과만 담는 마지막 문서 커밋은 기능 소스와 구별한다. 정확한 HEAD/원격 동기 상태는 git status --short·git log -3·git rev-list --left-right --count origin/main...HEAD로 확인한다.

## 현재 구현과 코드 진입점

- ThemeControl → HomeEffectsControl.tsx/home-effects-control.css. ‘효과’ 글자를 없애고 시간대 선택기와 같은 GlassMenu의 유리 받침/spring을 재사용한다. 펼침360ms, 이탈180ms, PC60×214·모바일176×44px,44px 선택 영역. 반사/빛줄기를 독립 선택하며 체크·pressed를 유지한다.
- VeilControls.tsx는 화면 안에 고정하는 포털 패널이다. 너비/밝기/퍼짐65/55/60 기본값, 즉시 반영·브라우저 저장·초기화·꺼졌을 때 켜기를 제공한다. veil-settings.ts가 잘못된 저장값을 정리한다. 열린 패널은 포인터 이탈로 닫지 않으며 Escape·외부 클릭·초점 이탈/복귀를 처리한다.
- hero-effects.ts는 한 캔버스·한 루프에서 반사/빛줄기를 선택한다. 넓은 광원 띠와 밤의 실제 달 이미지/cover 크롭 좌표에서 왼쪽 아래로 번지는 은빛을 사용한다. 모바일의 화면 밖 달을 억지로 옮기지 않는다. 최대640×480/DPR1/30fps이며 멈춤 중 수치 변경은 한 정지 프레임만 갱신한다.
- 메인 첫 구역 영상 위·제목 아래만 적용한다. 화면 밖·탭 숨김 정지, 선명하게/접근성 우선, GPU 복구/미지원 대안을 유지한다. 새 의존성·유료 원본·외부 서비스는 없다.
- [정본](spec/design.md#효과-선택기와-veil-rays), [중간 실패·성능·배포 확정 기록](work/P9-23.md#광원-조절과-달빛-후속).

## 확정 검사와 한계

[최종 CI38663527117](https://github.com/jinkyu0105-stack/bibleQuiz/actions/runs/38663527117)는 **success**다. 원격 pnpm check2548건·lint/typecheck/build, PC/모바일 Chromium **283통과·기존 조건3제외·실패/재시도0(17.6분)**을 확인했다. 같은 전체 브라우저 검사의 로컬 결과도283통과·3제외·실패/재시도0이다. 제한된 CPU2개에서 GPU/스크롤14건과 Firefox 스크롤1건을 별도 통과했다. 앞선 관련39항목 성공·Firefox GPU전용6제외와 보정 과정은 작업 문서에 보존한다.

첫 원격 실행은15분 작업 한도로 취소됐고, 두 번째는 GPU 준비 대기 실패와 스크롤 측정의 재시도가 있었다. CPU2개에서 재현한 뒤 home-mercury.spec.ts의 실제 준비 상태 대기20초/시나리오90초, sky-controls-polish.spec.ts의 전체 이동 시간+실제 중간 위치 검사로 보정했다. 기능·픽셀·450ms 이상 이동 조건은 유지한다. 최종 전체 CI에는 재시도가 없으며 browser 작업 한도는25분이다.

실제5173에서 네 시간대×1440/390/320px의 재생·정지·빛줄기/혼합·조절·범위 양 끝과 유리 받침 이동을 확인했다. 가로 넘침·GPU/pageerror·쓰기API 요청0이다. 실기기·Safari·화면 읽기 프로그램·Access 로그인 뒤 원격 화면/저장은 미검증이다. Lighthouse 효과 없음/혼합55/33·TBT250/1590ms는 소프트웨어 GPU의 모바일 모의값이며 픽셀 수 감소를 실행 성능 개선으로 단정하지 않는다. 기존500kB fontkit·정적/동적 import 경고도 남는다.

근거는 ignored .wrangler/releases/p9-23/light-*의 로그·JSON·PNG다. 원격 최종 결과는 light-ci-{validate,browser}-final.txt, 기능 소스/Preview 연결은 light-preview-final-verification.json이다. 대표 실제 이미지만 docs/design/phase-9/home-effects/에 보존한다. .wrangler HTTP는403이므로 사용자에게 링크하지 않는다.

## Preview와 후속 문서

검증한 기능 소스8842413의 Workers Builds **d302bf8d-39c1-45c0-864e-4387776d1dec**는 success다. Preview version **be5a860f-00e3-4051-8e74-718e7f0a5cd6**·100%·2026-10-15 10:04:43KST를 실제 deployments/version과 대조했다. UI 코드는7dce3c2와 같고 binding 이름/타입16개·Preview D1/Workflow·AI 비활성을 유지한다. Production app은 기존 version **7aea6843-5288-42da-9bef-bc673e1d9dfe**다. 원격 자료·AI·migration·Secret/Access 설정은 변경하지 않았다.

결과만 담는 마지막 문서 커밋은 git diff --check·링크·사실 대조 후 push한다. 이미 통과한 기능/검사 코드는 동일하므로 이 문서 커밋에만 GitHub의 [skip actions]를 사용한다. 기능 커밋의 전체 성공을 문서 커밋에서 재실행했다고 보고하지 않는다. Cloudflare 자동 빌드 설정은 바꾸지 않으며 문서 push의 실제 결과는 light-docs-push-* 로그에서 별도로 확인한다.

## 실행과 다음 첫 작업

- 실제 홈: http://localhost:5173/ — 재생 아래 별 아이콘 → 빛줄기 → 조절. 빛줄기만 보려면 반사를 끈다.
- 실제 밤: http://localhost:5173/docs/design/phase-9/home-effects/night-controls.png
- 실제 모바일: http://localhost:5173/docs/design/phase-9/home-effects/mobile-controls.png
- 관리자 비교: http://localhost:5173/docs/design/phase-9/admin-boards/review#workspace

홈과 대표 이미지의HTTP200/PNG를 확인했으며 사용자 Windows 화면의 표시 확인과 구별한다.5173과 .wrangler/ui-demo-state를 보존했다. 꺼지면 프로젝트 루트에서 pnpm dev:demo --port 5173 --strictPort. Node24.18.0/pnpm11.14.0이며 필요할 때만 /home/onegem/.nvm/versions/node/v24.18.0/bin을 현재PATH에 추가한다. E2E는 별도4173이고 동시에 여러 번 실행하지 않는다.

명령은 검증된 /bin/bash, login:false, 명시workdir, require_escalated 승인 검토 경로를 쓴다. 도구 시작 실패 시 codex-exec-recovery에 따라 다른 허용 경로를 검증하며 승인 거부는 우회하지 않는다. Windows Node REPL의 WSL경로 실패를 반복하지 않고 WSL Playwright를 사용했다.

마지막 확인 Pro잔여56%×사용자 지정10=560%, 별도5시간 창 없음. 다음 구현 전 현재 사용량을 다시 확인한다. AGENTS → PROJECT_CONTEXT → DECISIONS → STATUS → HANDOFF → implementation 관련 정본 → P9-23 → Git상태/diff/log 순서다.

폐기한 접근: 밤의 상단 중앙 광원, 모바일 달을 가상으로 이동, 효과마다 새 렌더 루프, overflow 영역 안의 조절 패널, spring 중간 좌표를 도착 위치로 검사하기. 다음 구현은 사용자의 실제 화면 피드백 범위에서 진행한다.

**현재 P9-23 완료 · 부모 홈 효과 보정/Preview 반영 완료 · 다음 사용자 실제 화면 피드백 · 세션 유지 · 다음 추천 GPT-6.1-sol/medium** — 기존 화면의 작은 보정과 관련 검증에 적합하다.
