# 다음 작업 인수인계

## 현재 작업과 Git

**P9-23 시안 기준 탭·공통 메뉴·도움말 — 로컬 완료.** `/home/onegem/work/bibleQuiz`, main `a0cea15` / clean에서 재개했다. 이번 로컬 커밋 제목은 `Align admin tabs and manual surfaces with design references`다. 정확한 해시와 작업 폴더는 `git log -1`·`git status --short`로 확인한다. 사용자 후속 보정은 같은 P9-23에서 처리한다.

## 현재 구현과 검증

- `AdminIndexedBoard`의 탭은 사용자 주석의 문의 원본을 기준으로 재구성했다. 비선택 테두리/윗띠를 제거하고 선택 탭만5px 강조선과 같은 불투명 본문 바탕으로 연결한다. 모든 탭의 높이/패딩/글자 굵기와 실제 글자 기준선을 맞췄다.
- 새 `AdminMenu`/CSS·`AdminMenuIcon`을 `AdminNavigation`/`ManualReader`에서 공유한다. 밝은 선택 면·윗빛·작은 그림자, 밤 회색 `#56616b`. 왼쪽 선/굵은 외곽선/유리 렌즈는 없다. 그룹 크기 변경에도 키보드 초점 배경이 유지된다.
- 도움말은 새 가로 시안 한 장에 맞춰 투명 목차와 불투명 본문 한 장으로 구성했다. 고딕 제목/분류 라벨/경계/여백을 적용했으며 기존14주제/10서비스·자료·공식 아이콘·의미색·모바일/키보드·말풍선/확대창은 보존한다.
- 최종 관련 E2E39건(Chromium PC/모바일·Firefox), lint/typecheck/build, 게시판/도움말 합성 캡처 각1건 통과. 최초25통과/1실패의 메뉴 초점/크기 변경 문제를 고친 뒤 최종검사했다. 실제36상태·84탭 조합·24주제×세 폭·투명도 감소/강제 색상6상태를 확인했다. 넘침/페이지 오류/API 쓰기0. 대비 표본 최저4.98:1은 전체 앱 인증과 구분한다.
- 게시판 실제6장·설명용3장 갱신, 새 도움말 실제3장·시안1장 추가. 기존 생성 시안은 보존했다. 도움말 잘라 찍기에서 고정 메뉴가 누락되는 촬영 현상은 전체 뷰포트로 해결했다. 비교12종 PNG·설명용3종의 HTTP/디코딩·확대·낮/밤·320px 검증과 사용자 표시 확인은 구분한다.
- [현재 기록](work/P9-23.md#시안-기준-탭과-공통-메뉴도움말-재구성), [디자인 정본](spec/design.md#p9-23-후속--선택-표면과-도움말-읽기-영역), ignored `.wrangler/releases/p9-23/reference-alignment-*`. 실제36상태 보고서와 추가PC24주제 보고서는 별개다. 전체check/전체E2E·Safari·실기기/화면 읽기 프로그램은 이번 범위에서 반복하지 않았다. 기존 fontkit500kB 청크 경고가 남는다. 남은 필수 구현은 없으며 사용자 미감 확인은 다음 피드백에서 이어간다.

폐기한 접근: 탭 좌표만으로 시안 일치라고 판단하기, 모든 탭의 강한 경계/윗띠, 사이드바와 도움말 선택 스타일 복제, 읽기 본문까지 투명하게 두기. 둥근 모서리에서 가늘어지는 한쪽 강조선 금지 기준은 유지한다.

## 실행과 다음 첫 작업

- 실제 도움말: http://localhost:5173/admin/manual
- 새 시안/실제 낮·밤 비교: http://localhost:5173/docs/design/phase-9/admin-boards/review#manual
- 퀴즈 관리: http://localhost:5173/admin
- 참여 기록: http://localhost:5173/admin/submissions (퀴즈 선택)
- 문의 요청: http://localhost:5173/admin/privacy-requests
- 도구·설정: http://localhost:5173/admin/tools · http://localhost:5173/admin/moderation · http://localhost:5173/admin/operations

5173을 유지했고 `.wrangler/ui-demo-state`의 기존 자료를 바꾸지 않았다. 꺼지면 루트에서 `pnpm dev:demo --port 5173 --strictPort`. Node24.18.0/pnpm11.14.0. pnpm이 PATH에 없으면 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 현재 PATH에만 추가한다. E2E는 별도4173 격리 서버이며 동시에 실행하지 않는다. [합성 촬영 재현](design/phase-9/admin-guide/README.md) · [도움말 촬영](design/phase-9/manual-reader/README.md#p9-23-투명-목차와-불투명-읽기-영역).

도구는 검증된 `/bin/bash`, `login:false`, 명시 workdir, `require_escalated` 승인 검토 경로를 쓴다. 시작 전 ENOENT를 WSL 단절로 판단하거나 승인 거부를 우회하지 않는다. 이미지는 확인된HTTP/첨부로 보여주며 WSL 경로 Markdown만 보내지 않는다. Python 기본 환경에 Pillow가 없으므로 이미지 검사에 브라우저/기존 도구를 사용한다. 긴 실제 화면 검사 도중 HTML/자산을 편집하면 Vite가 다시 탐색할 수 있으므로 촬영과 편집은 순서대로 한다.

시작 Pro 잔여78% × 사용자 지정10 =780%, 별도5시간 창 없음. 다음 구현 전 사용량을 확인한다. 읽기 순서: AGENTS → PROJECT_CONTEXT → DECISIONS → STATUS → HANDOFF → implementation 관련 명세 → P9-23 → Git 상태/diff/log.

사용자가 요청한 디자인 시안1장 이외에 실제 퀴즈 AI·자료 쓰기·원격 변경·새 의존성·push/배포는 없다. Preview는 P9-14 소스 `0fbde84` / version `cd6efb0e-2c05-4401-b0bf-692bdf18c5b1`, Production은 P9-04 소스 `37b7254` / version `7aea6843-5288-42da-9bef-bc673e1d9dfe` 그대로다.

**현재 P9-23 로컬 완료 · 부모 관리자 이해 돕기 로컬 완료 · 다음 사용자 화면 확인/피드백 · 세션 유지 · 다음 추천 GPT-6-astra/max** — 시안과 실제 화면의 시각적 균형을 대조하는 후속 보정에 적합하다.
