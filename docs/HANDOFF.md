# 다음 작업 인수인계

## 현재 작업과 Git

**P9-23 현황·Live 5:5와 연결된 인덱스 — 로컬 완료.** `/home/onegem/work/bibleQuiz`, main `c2e4fa3` / clean에서 재개했다. 이번 커밋 제목은 `Connect admin indexes to boards and balance overview`다. 정확한 마지막 해시와 작업 폴더는 `git log -1`·`git status --short`로 확인한다. 후속 보정은 같은 P9-23에서 처리한다.

## 변경과 검사

- Dashboard 현황/Live를5:5로, 현황은 초록·파랑·노랑 상시 바탕으로 바꿨다. 전체 칸 호버·선택 선·시간대 의미색·1100px 이하 위아래 배치를 유지한다.
- AdminListTools의 기존 필터를 `AdminIndexedBoard`로 확장했다. Dashboard/PrivacyInbox의 선택 탭과 목록을 같은 바탕으로 연결하고 중간 여백·중복 테두리를 제거했다. 조회/빈 상태도 같은 본문을 쓴다. 비선택 탭의 이동·기존 필터/검색/문의 입력 유지·참여 목록의 외곽은 보존한다. 관련 CSS3개와 E2E 연결 검사를 함께 수정했다.
- 관련 PC/모바일 E2E14건은 최초12통과·2실패. 색 전환 도중 측정한 검사만 전환 완료를 기다리도록 고쳐 해당2건 모두 통과했다. 최종 lint/typecheck·합성 캡처1건 통과. 실제5173 퀴즈/문의 네 시간대·1440/390/320px·접힘/펼침36상태, 현황12개 호버·중간 폭6종·낮/밤 감소/강제 색상4상태에서 넘침/오류/쓰기0. PC 두 영역의 폭 차이1px 미만이며 새로고침 중심·입력 유지·키보드를 확인했다.
- 비교용 낮/밤6장과 설명용3장을 합성 GET으로 촬영했다. 퀴즈/문의 비교4장과 설명용2장이 변경됐으며 나머지는 동일하다. 기존 시안2장은 보존한다. 비교 페이지의 낮/밤 전환·8개 PNG HTTP/디코딩·원본 링크·320px 확인을 사용자 기기 표시와 구별한다.
- DESIGN/디자인 정본/결정/상태·작업 기록/자산 목록을 갱신했다. [현재 기록](work/P9-23.md#동등한-현황live와-본문에-연결된-인덱스), ignored 증거 `.wrangler/releases/p9-23/folder-index-*`. 이번에는 build/전체check/전체E2E·Firefox/Safari·실기기/화면 읽기 프로그램을 반복하지 않았다. 이전 검증 이력은 작업 기록을 따른다.

폐기한 접근: 비대칭 현황/Live, 무채색의 기본 현황, 카테고리와 본문의 틈/중복 테두리, 선택 탭까지 띄우는 호버. 필터 재시도·접기/입력 유지·매뉴얼·공통 버튼과 밤 회청색 본문은 보존한다.

## 실행과 다음 첫 작업

- 퀴즈 관리: http://localhost:5173/admin
- 참여 기록: http://localhost:5173/admin/submissions (퀴즈 선택)
- 문의 요청: http://localhost:5173/admin/privacy-requests
- 실제 UI/시안 비교: http://localhost:5173/docs/design/phase-9/admin-boards/review

5173과 기존 `.wrangler/ui-demo-state` 자료를 유지했다. 꺼지면 루트에서 `pnpm dev:demo --port 5173 --strictPort`. Node24.18.0/pnpm11.14.0. pnpm이 PATH에 없으면 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 현재 PATH에만 추가한다. E2E는 별도4173 격리 서버이며 동시에 실행하지 않는다. [촬영 재현](design/phase-9/admin-guide/README.md).

도구는 검증된 `/bin/bash`, `login:false`, 명시 workdir, `require_escalated` 승인 검토 경로를 쓴다. 시작 전 ENOENT를 WSL 단절로 판단하거나 승인 거부를 우회하지 않는다. 이미지는 확인된HTTP/첨부로 보여주며 WSL 경로 Markdown만 보내지 않는다.

시작 Pro 잔여82% × 사용자 지정10 =820%, 별도5시간 창 없음. 다음 구현 전 사용량을 확인한다. 읽기 순서: AGENTS → PROJECT_CONTEXT → DECISIONS → STATUS → HANDOFF → implementation 관련 명세 → P9-23 → Git 상태/diff/log.

push/배포·실제 자료 쓰기·AI 호출·새 의존성은 없다. Preview는 P9-14 소스 `0fbde84` / version `cd6efb0e-2c05-4401-b0bf-692bdf18c5b1`, Production은 P9-04 소스 `37b7254` / version `7aea6843-5288-42da-9bef-bc673e1d9dfe` 그대로다.

**현재 P9-23 로컬 완료 · 부모 관리자 이해 돕기 로컬 완료 · 다음 사용자 화면 확인/피드백 · 세션 유지 · 다음 추천 GPT-6.1-sol/medium** — 공통 규칙 안의 작은 보정에 적합하다.
