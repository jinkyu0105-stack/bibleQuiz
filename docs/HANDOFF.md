# 다음 작업 인수인계

## 현재 작업과 Git

**P9-23 제목 정보 묶음·말풍선 경계 — 로컬 완료.** `/home/onegem/work/bibleQuiz`, main `f8b62f6`/clean에서 재개했다. 이번 로컬 커밋 제목은 `Compact workspace metadata and unify callout borders`다. 정확한 최종 해시/작업 폴더는 `git log -1`·`git status --short`로 확인한다. 다음 화면 피드백도 같은 P9-23에서 처리한다.

## 현재 구현

- `WorkspaceMeta.tsx`와 `weekly.module.css`: 제목 오른쪽에 하나의 유리 박스와 달력/상태/보관 버튼3개. PC32px·터치44px, 내부 구분선1px. 날짜·요일은 달력 말풍선에 표시하며 hidden time/접근성 이름·설명·저장/보관 정보는 보존한다. 초안/발행 설정 공통이다. 현재/완료/잠금 및 이동 받침은 직전 공통 `AdminMenu` 그대로다.
- `admin-help.module.css`: 작은/큰 말풍선 모두 같은1px 중립 전체 경계다. 아래로 뜨는 꼬리도 같은 색이며 위쪽 우선/초점·터치/Escape 동작을 유지한다. 공개/관리자 안내·경고·인용의 한쪽 굵은 선도 전체 경계로 바꿨다. 의미색 바탕/문구/배지·확인/저장을 보존한다. 현황 선택은 이름 굵기/색으로 표시하고 기존 인덱스의 사용자 승인 상단 띠·초점·격자선은 유지한다.
- 노을 `--glass-solid #f7e9df`, `--dusk-action #8a432f`, `--dusk-action-bg #f9e4d9` 및 기존 투명 외곽/불투명 본문 기준은 유지한다.
- [정본](spec/design.md#p9-23-후속--균일한-말풍선-경계), [작업 기록](work/P9-23.md#제목-정보-묶음과-말풍선-경계), [자산 재현](design/phase-9/admin-workspace/README.md).

## 검증과 남은 범위

- Chromium PC/모바일·Firefox workspace/help/input-notice E2E39건, 공개 제출/삭제/참여/layout15건 통과. lint/typecheck/build 및 합성 workspace/boards 촬영 각1건 통과. 기존500kB 청크 경고는 남는다.
- 실제5173 합성 GET18경로×4시간대×1440/390/320px216상태, 투명도 감소/강제 색상18상태, 기존 연습 DB24상태에서 넘침·오류·자료 쓰기0. 마지막 현황12상태·날짜 말풍선12상태·큰 도움말3폭을 확인했다. PC/모바일 화면을 직접 대조했다.
- 증거는 ignored `.wrangler/releases/p9-23/metadata-*`: E2E/lint/types/build/capture 로그, `metadata-visual.json`, `metadata-demo.json`, `metadata-final.json`. 최종42개 이미지 응답/디코딩/원본 링크와3폭 확대창/실제 노을 연결도 통과했고 `metadata-delivery.json`에 기록했다. 마지막 CSS 보정 후 빌드도 통과했다. 설명용PNG와 비교 화면을 최신 실제 렌더링+합성 자료로 갱신했다. 사용자 Windows 표시 확인과 HTTP/디코딩은 구분한다.
- Windows Computer Use의 Node REPL은 `sandboxCwd is not a local file URI: file:///home/onegem/work/bibleQuiz`로 시작 전에 실패했다. recovery 지침을 읽고 기존 WSL Playwright와 앱 열기 도구로 이어갔다. 로컬 `open-dusk.html`은 탭의 시간대만 노을로 설정하고 기존 실제 초안으로 이동한다. Playwright에서 실제 주소/노을을 확인했지만 `open_in_codex` 반환은 queued다. Windows 조작 성공으로 쓰지 않는다.
- Mercury Veins는 사용자가 준 공개 미리보기에서 두 시점/포인터 이동을 시각 확인했다. 흐르는 금속 명암·밝은 경계·입자를 독립 WebGL 효과로 구현 가능하다는 판단이며, 아직 제작/성능 검증은 하지 않았다. 구매·유료 소스 취득·실제 배경 변경 없이 조사만 했다. [관찰과 범위](work/P9-23.md#제목-정보-묶음과-말풍선-경계).
- 전체check/전체E2E·Safari·실기기/화면 읽기 프로그램은 이번 후속 범위에서 실행하지 않았다. 필수 구현은 완료했고 사용자 화면 피드백을 기다린다.

폐기한 접근: 날짜를 상시 긴 글자로 표시하기, 정보 아이콘마다 별도 상자를 만들기, 작은 말풍선에 진한 윗선을 상속하기, 배경 사이트 질문을 실제 배경 교체 승인으로 해석하기. 기존 데이터·유료 결과·공개/저장 기능·투명 콘셉트를 유지했다.

## 실행과 다음 첫 작업

- 노을 실제 초안 연결(로컬 확인용): http://localhost:5173/.wrangler/releases/p9-23/open-dusk.html
- 실제 퀴즈 관리: http://localhost:5173/admin (기존 초안 편집·발행 설정 링크 이용)
- 초안6단계·설정 실제 비교: http://localhost:5173/docs/design/phase-9/admin-boards/review#workspace
- 새 노을 실제 화면: http://localhost:5173/docs/design/phase-9/admin-boards/review#sunset
- 시간대별 색상표: http://localhost:5173/docs/design/phase-9/admin-sidebar/palette
- 도구 비교: http://localhost:5173/docs/design/phase-9/admin-boards/review#tools
- 도움말 시안/실제 비교: http://localhost:5173/docs/design/phase-9/admin-boards/review#manual

5173을 유지했고 `.wrangler/ui-demo-state` 자료를 바꾸지 않았다. 꺼지면 루트에서 `pnpm dev:demo --port 5173 --strictPort`. Node24.18.0/pnpm11.14.0. PATH에 없으면 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 현재PATH에만 추가한다. E2E는 별도4173격리 서버이며 동시에 실행하지 않는다. [합성 촬영](design/phase-9/admin-workspace/README.md).

실행은 검증된 `/bin/bash`, `login:false`, 명시workdir, `require_escalated` 승인 검토 경로를 쓴다. 시작 전ENOENT를 WSL단절로 판단하거나 승인 거부를 우회하지 않는다. 이미지는 확인된HTTP/첨부로 보여주며 WSL경로 Markdown만 보내지 않는다. Python 기본환경에Pillow가 없어 브라우저/기존 도구를 쓴다. 긴 실제 화면 검사 중 소스/HTML/자산을 편집하면 Vite가 재탐색할 수 있으므로 촬영과 편집은 순서대로 한다. 이모지 글꼴은 캡처에서만 설치된 Windows 글꼴을 메모리로 읽고 배포하지 않는다.

시작 Pro잔여68% × 사용자 지정10 =680%, 별도5시간 창 없음. 다음 구현 전 사용량을 확인한다. 읽기 순서: AGENTS → PROJECT_CONTEXT → DECISIONS → STATUS → HANDOFF → implementation 관련 명세 → P9-23 → Git상태/diff/log.

새 의존성·새 이미지 생성·유료 구매·실제 퀴즈AI·자료 쓰기·원격 변경·push/배포 없음. Preview는 P9-14 소스 `0fbde84` / version `cd6efb0e-2c05-4401-b0bf-692bdf18c5b1`, Production은 P9-04 소스 `37b7254` / version `7aea6843-5288-42da-9bef-bc673e1d9dfe` 그대로다.

**현재 P9-23 로컬 완료 · 부모 관리자 이해 돕기 로컬 완료 · 다음 사용자 화면 확인/피드백 · 세션 유지 · 다음 추천 GPT-6-astra/max** — 공통 화면의 시각적 균형과 동작을 함께 대조하는 후속 보정에 적합하다.
