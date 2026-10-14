# 다음 작업 인수인계

## 현재 작업과 Git

**P9-23 도구 읽기 바탕·메뉴 효과·도움말 스크롤 — 로컬 완료.** `/home/onegem/work/bibleQuiz`, main `f75bb1d`/clean에서 재개했다. 이번 로컬 커밋 제목은 `Unify admin tool surfaces and menu feedback`다. 정확한 최종 해시·작업 폴더는 `git log -1`·`git status --short`로 확인한다. 후속 보정은 같은 P9-23에서 처리한다.

## 현재 구현과 검증

- 도움말의 읽기 바탕을 `interior.css`의 공통 `--admin-sheet`·경계·여백으로 옮겼다. 수정·보관 도구/필터/비용 페이지는 `data-admin-tool-page`, 본문·필터 목록·비용 상태/상세창·도움말은 `data-admin-sheet`를 쓴다. 기존AdminTool만 같은 면을 공유하고 다른 퀴즈 제작 화면까지 넓히지 않는다. 밤 회색 본문·고딕700 제목·구분선·기존 공통 버튼을 사용한다. 성경 장절/설교 편집기의 큰 중첩 바탕을 정리하고 모바일 설교 단계 안내를 두 열로 줄였다.
- `AdminMenu`는 아이콘 받침을 선택 배경 안에 넣어 동일한 변환으로 움직인다. 목적지 아이콘이 먼저 칠해지는 CSS호버를 없앴다. 받침은 윗빛·가장자리 음영·작은 그림자를 쓰며 공식 아이콘/의미색/현재 위치/키보드·감소 모션은 보존한다.
- `ManualReader.choose`는 새 제목 초점을 유지하며 페이지를0으로 이동한다. 실제 아래쪽 메뉴에서 남던76px 스크롤을 재현하고 수정했다.24개 주제·서비스와 모바일 선택/다음 안내를 유지한다.
- 관련 E2E 두 묶음 각27건(중복 제외48개 시나리오), 최종 PC 안내2건·합성 촬영2건, lint/typecheck/build 통과. 필터 저장/실패 재시도·비용 경고·키보드 모달·도움말/말풍선/확대창·입력 보존을 확인했다.
- 실제5173 네 시간대·1440/390/320px84상태, 열린 도구18상태, 도움말72회 전환, 메뉴10개 호버, 감소/강제 색상24상태를 확인했다. 마지막 설교 보정은1440/1024/768/390/320px×네 시간대20상태와 높이844px 모바일8화면으로 확인했다. 넘침·페이지 오류·API 쓰기0. 초기 스크립트의 토글 이름과 PC원형36px/터치44px 가정 오류는 바로잡은 뒤 최종 재실행했다.
- 합성GET만으로 도구 낮·밤6장을 추가하고 도움말3장·설명용filters/operations2장을 갱신했다. 비교 페이지22회 이미지HTTP/PNG디코딩/원본 확대 링크·320px 넘침 없음 확인. 사용자 Windows 표시 확인과 구분한다. 기존 생성 시안·로컬 자료는 보존한다.
- [현재 명세](spec/design.md#p9-23-후속--도구-읽기-면과-메뉴-동기화), [세부 기록](work/P9-23.md#도구-읽기-면메뉴-호버도움말-스크롤-통일), ignored `.wrangler/releases/p9-23/tool-surfaces-*`가 증거다. 최종 시각 보고서는 `tool-surfaces-visual.json`과 `tool-surfaces-final.json`이며 초기 실패 파일과 구별한다. 전체check/전체E2E·Safari·실기기/화면 읽기 프로그램은 이번 후속 범위에서 실행하지 않았다. 기존 fontkit500kB 청크 경고가 남는다. 남은 필수 구현은 없다.

폐기한 접근: 세 화면별 읽기 토큰 복제, 도구 안의 큰 중첩 바탕, 제목이 보이면 중간 스크롤을 남기기, 아이콘과 행의 독립 호버 바탕. 둥근 모서리에서 가늘어지는 한쪽 강조선 금지·기존 연결 탭 기준은 유지한다.

## 실행과 다음 첫 작업

- 실제 도구: http://localhost:5173/admin/tools
- 이름·문구 필터: http://localhost:5173/admin/moderation
- 비용·백업: http://localhost:5173/admin/operations
- 도움말: http://localhost:5173/admin/manual
- 새 도구 낮·밤 비교: http://localhost:5173/docs/design/phase-9/admin-boards/review#tools
- 도움말 시안/실제 비교: http://localhost:5173/docs/design/phase-9/admin-boards/review#manual

5173을 유지했고 `.wrangler/ui-demo-state` 자료를 바꾸지 않았다. 꺼지면 루트에서 `pnpm dev:demo --port 5173 --strictPort`. Node24.18.0/pnpm11.14.0. PATH에 없으면 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 현재PATH에만 추가한다. E2E는 별도4173격리 서버이며 동시에 실행하지 않는다. [합성 촬영](design/phase-9/admin-guide/README.md) · [도구 촬영](design/phase-9/admin-tools/README.md).

실행은 검증된 `/bin/bash`, `login:false`, 명시workdir, `require_escalated` 승인 검토 경로를 쓴다. 시작 전ENOENT를 WSL단절로 판단하거나 승인 거부를 우회하지 않는다. 이미지는 확인된HTTP/첨부로 보여주며 WSL경로 Markdown만 보내지 않는다. Python 기본환경에Pillow가 없어 브라우저/기존 도구를 쓴다. 긴 실제 화면 검사 중 소스/HTML/자산을 편집하면 Vite가 재탐색할 수 있으므로 촬영과 편집은 순서대로 한다. Chromium고정 메뉴의 캡처 누락과 실제 동작을 구별하고 필요하면 새 문서에서 전체 뷰포트로 촬영한다.

시작 Pro잔여75% × 사용자 지정10 =750%, 별도5시간 창 없음. 다음 구현 전 사용량을 확인한다. 읽기 순서: AGENTS → PROJECT_CONTEXT → DECISIONS → STATUS → HANDOFF → implementation 관련 명세 → P9-23 → Git상태/diff/log.

새 의존성·새 이미지 생성·실제 퀴즈AI·자료 쓰기·원격 변경·push/배포 없음. Preview는 P9-14 소스 `0fbde84` / version `cd6efb0e-2c05-4401-b0bf-692bdf18c5b1`, Production은 P9-04 소스 `37b7254` / version `7aea6843-5288-42da-9bef-bc673e1d9dfe` 그대로다.

**현재 P9-23 로컬 완료 · 부모 관리자 이해 돕기 로컬 완료 · 다음 사용자 화면 확인/피드백 · 세션 유지 · 다음 추천 GPT-6-astra/max** — 공통 화면의 시각적 균형과 동작을 함께 대조하는 후속 보정에 적합하다.
