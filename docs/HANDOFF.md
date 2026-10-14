# 다음 작업 인수인계

## 현재 작업과 Git

**P9-23 효과 선택기·Veil Rays — 로컬 완료.** `/home/onegem/work/bibleQuiz`, main `594a970`/clean에서 재개했다. 이번 커밋 제목은 `Add expandable home effect controls and veil rays`다. 정확한 최종 해시/작업 폴더는 `git log -1`·`git status --short`로 확인한다. 다음 화면 피드백도 같은 P9-23에서 처리한다.

## 현재 구현과 코드 진입점

- 홈의 `ThemeControl`에서 재생 버튼 아래에 `HomeEffectsControl.tsx`·`home-effects-control.css`를 연결한다. 원형 ‘효과’가 시간대 선택기와 같은 유리 캡슐로220ms 동안 펼쳐진다. PC는 세로60×164px, 모바일은 가로132×44px다.44px 입력 영역을 지키고 위의 시간대/재생 버튼을 끌어올리지 않는다. 낮은 PC 화면은 조작부 내부 스크롤을 허용한다.
- ‘반사’/‘빛줄기’는 독립 토글이며 이름·아이콘·체크·pressed 상태를 공유한다. 초기에는 기존 반사만 켠다. 각각 브라우저에 저장하고 저장 거부 시 현재 화면에서 계속 쓸 수 있다. 마우스 진입/이동, 터치, Enter/Space/아래 화살표, Tab/Escape/외부 클릭·초점 이탈을 지원한다. 키보드 시작 시 이전 닫기 타이머를 취소한다.
- `HeroMercury`/`hero-mercury`는 `HeroEffects`/`hero-effects`로 바뀌었다. 한 캔버스에서 반사와 Veil Rays 공개 미리보기를 참고한 독립 빛줄기를 선택/혼합한다. 둘 다 끄면 숨기고 그리기를 중단한다. 최대960×720·DPR1·30fps, 화면 밖/탭 숨김·기존 멈춤/선명하게·OS 접근성·GPU 복구 정책을 재사용한다. 메인 첫 구역의 영상 위·글자 아래에만 적용한다.
- 기존 관리자/말풍선/자료와 실제 하늘 영상은 유지했다. 유료 원본 소스/자산·새 의존성·외부 서비스는 추가하지 않았다.
- [현재 정본](spec/design.md#효과-선택기와-veil-rays), [이번 구현·실패/성공·성능 한계](work/P9-23.md#효과-선택기와-veil-rays).

## 검증과 남은 범위

- 관련36항목 최초 실행은30통과·1실패·5제외. Firefox의 포인터 복원 시 enter 누락을 실제 재현해 move도 연결했다. 선택기9건 재검사는8통과·1실패였고, 이전100ms 닫기 예약이 새 키보드 열기를 닫는 순서를 실제 Firefox에서 재현해 수정했다. 최종 선택기9건은 Chromium PC/모바일·Firefox 모두 통과했다.
- 변경 없는 GPU10건과 공통 홈/선택/스크롤12건의 최초 성공을 합쳐 관련31개 항목의 성공을 확인했다. 단일 전체 실행 무실패라는 뜻은 아니다. Firefox GPU 전용5건은 명시적으로 제외했다. 최종 lint/typecheck/build 통과. 기존500kB 청크·일부 정적/동적 import 중복 경고는 유지한다.
- 실제5173 네 시간대×1440/390/320px×빛줄기 단독/혼합24화면, 다른 경로12상태 및320×667px를 확인했다. 가로 넘침·GPU/pageerror·자료 쓰기0이며 모바일 본문 버튼과 하단 설정이 겹치지 않는다. 다른 페이지에는 효과/선택기가 없고 아래 주간 구역에서 그리기가 멈춘다. 대표 PC/네 시간대/모바일 PNG를 직접 검토했다. 마지막 입력 보정에는 CSS/셰이더 변경이 없어 위9개 E2E로 검증했다.
- Lighthouse13.5.0/SwiftShader 모바일 모의, 같은 빌드·합성 GET 응답에서 효과 없음/두 효과 켬 성능52/48, LCP8.31/8.64초, TBT381/483ms, CLS0.00011이었다. 접근성 점수100/100과 별도로 기존 선명하게 버튼의 보이는 이름/접근성 이름 차이 진단이 남는다. 단회 소프트웨어 GPU 측정으로 실기기 성능을 보장하지 않는다.
- 증거는 ignored `.wrangler/releases/p9-23/veil-*`. 중간 E2E 실패는 `veil-e2e.txt`·`veil-control-final-e2e.txt`, 최종9건은 `veil-control-verified-e2e.txt`, 최종 lint/typecheck/build·실제24상태는 `veil-final-*`·`veil-visual.json`·PNG, 성능은 `veil-lighthouse-{baseline,mixed}.json`이다. 임시4187 서버는 종료했고 실제5173은 유지했다.
- 전체check/전체E2E·Safari·실기기/화면 읽기 프로그램은 이번 후속 범위에서 실행하지 않았다. 새 의존성·실제 AI·구매·자료 쓰기·원격 변경·push/배포 없음.

폐기한 접근: 효과마다 캔버스/루프를 늘리기, 모바일 세로 메뉴로 본문 가리기, hover만 지원하기, 키보드 조작보다 오래된 이탈 타이머를 우선하기. 공개 Veil Rays를 브라우저로 관찰했으며 유료 원본의 동일 구현이라고 주장하지 않는다.

## 실행과 다음 첫 작업

- 실제 메인: http://localhost:5173/ — 재생 아래 ‘효과’를 열고 ‘빛줄기’를 켠다. ‘반사’를 끄면 새 효과만 볼 수 있다. 기존 ‘선명하게’가 켜져 있으면 장식은 숨겨진다.
- 실제 관리자: http://localhost:5173/admin
- 기존 시안/실제 비교: http://localhost:5173/docs/design/phase-9/admin-boards/review#workspace
- 시간대 색상표: http://localhost:5173/docs/design/phase-9/admin-sidebar/palette

홈HTTP200을 확인했다. 이미지 사용자 표시는 첨부 또는 검증된HTTP로 하며 `.wrangler`의 HTTP는403이므로 해당 경로를 사용자 이미지 링크로 주지 않는다. 이번 캡처는 ignored 증거로만 유지한다.

5173과 `.wrangler/ui-demo-state`를 보존했다. 꺼지면 루트에서 `pnpm dev:demo --port 5173 --strictPort`. Node24.18.0/pnpm11.14.0. PATH에 없으면 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 현재PATH에만 추가한다. E2E는 별도4173격리 서버이며 동시에 실행하지 않는다.

명령은 검증된 `/bin/bash`, `login:false`, 명시workdir, `require_escalated` 승인 검토 경로를 쓴다. 이번 프로세스 시작 실패는 없었다. 직전 Windows Node REPL의 `sandboxCwd is not a local file URI: file:///home/onegem/work/bibleQuiz` 실패를 반복하지 않고 기존 WSL Playwright를 썼다. ENOENT를 WSL단절로 단정하거나 승인 거부를 우회하지 않는다. 촬영과 소스/자산 편집은 순서대로 한다.

시작 Pro잔여64%×사용자 지정10=640%, 별도5시간 창 없음. 다음 구현 전 사용량을 확인한다. 읽기 순서: AGENTS → PROJECT_CONTEXT → DECISIONS → STATUS → HANDOFF → implementation 관련 명세 → P9-23 → Git상태/diff/log.

Preview는 P9-14 소스 `0fbde84` / version `cd6efb0e-2c05-4401-b0bf-692bdf18c5b1`, Production은 P9-04 소스 `37b7254` / version `7aea6843-5288-42da-9bef-bc673e1d9dfe` 그대로다.

**현재 P9-23 로컬 완료 · 부모 관리자 이해 돕기 로컬 완료 · 다음 사용자 화면 확인/피드백 · 세션 유지 · 다음 추천 GPT-6-astra/max** — 효과와 조작부의 시각적 균형·입력 동작을 함께 대조하는 후속 보정에 적합하다.
