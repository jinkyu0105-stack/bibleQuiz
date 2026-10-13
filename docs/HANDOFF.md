# 다음 작업 인수인계

## 현재 작업과 Git

**P9-23 관리자 게시판·공통 디자인·전체 검수 — 로컬 완료.** main `65f3137` / clean에서 재개했다. 이번 로컬 커밋 제목은 `Unify admin record boards and design rules`다. 경로는 `/home/onegem/work/bibleQuiz`; 정확한 최종 해시·작업 폴더는 `git log -1`·`git status --short`로 확인한다. push/배포는 없고 기존 자료·원격 버전은 보존했다.

다음은 사용자 로컬 화면 확인/피드백이다. 같은 P9-23에서 한정된 보정을 진행하며 새 번호나 원격 반영 승인을 만들지 않는다. P9-22와 이전 P9-23의 매뉴얼/사이드바/공식 로고/말풍선 완료 범위도 유지한다. [최신 구현·검사·한계](work/P9-23.md#게시판과-관리자-전체-검수).

## 이번 변경과 진입점

- `AdminRecord`/CSS, `records.module.css`, Submissions/PrivacyInbox: 개별 카드를 연속 게시판으로 변경. 종류와 상태는 오른쪽 분할 표시, 이름16px 고딕·본문 중립색, 짧은 날짜/점수/버전. PC 참여 기록의 접힌 행은 해당 예시에서 약340→173px. 답안/관리/이력은 한 행에 한 패널만 열며 닫힌 폼도 마운트 상태로 보존한다. 다른 행을 강제로 닫지 않는다. 삭제 확인·API·문의 저장 버전 보호는 유지한다.
- `AdminListTools`/CSS: 목록 공통44px 원형 새로고침과 대칭20px 화살표. 퀴즈/문의는 같은4px 모서리·3px 윗선·전체 밑줄의 필터. 이름·문구 필터의 목록 새로고침도 같은 버튼이다. 비용 있는 사용량 갱신/AI 작업은 글자 설명을 유지한다.
- `AdminGuide`, `Workspace`, `AdminSermonInput`, `interior.css`: 도움말/화면 예시의 중복 여백 축소,16px 고딕 도구 제목·18px 내부 제목·보통 설명, 공통44px/8px 버튼·실행색·중앙 정렬. 실화면에서 발견한 문제 정정 폼 체크박스와 사유 입력 배치를 고쳤다. 독립 선택칸과 버튼이 붙지 않도록12px 간격을 둔다.
- 새 시안2장은 사용자 명시 요청에 따라 `imagegen-frontend-web`으로 각각 생성했다. [시안과 실제 적용 차이](design/phase-9/admin-boards/README.md). 실제 제품에 없는 아바타/정오답 장식은 적용하지 않았다. `last30days` 실제 엔진과 공식 문서를 조사해 Refero Styles + Carbon/Geist를 참고하고 공통 규칙을 [디자인 정본](spec/design.md#p9-23-후속--게시판과-관리자-공통-규칙)에 고정했다. 새 의존성/설치/유료 계정 연결은 없다.
- 매뉴얼 PNG8종은 최종 React UI와 합성 연습 자료로 모두 재촬영했다. 실제 운영 자료를 정적 자산에 넣지 않았다. [크기/재현](design/phase-9/admin-guide/README.md). Windows Segoe UI Emoji는 촬영 메모리에만 사용하며 앱/저장소에 배포하지 않는다.

## 검사와 한계

- 최초 관련 PC/모바일50건 통과. 최종 전체 관리자132항목:128통과·2실패·명시 실행용 캡처2건너뜀. 실패는 밤 보조 버튼 글자를 이전 흰색으로 고정한 PC/모바일 기대값이다. 새 실행색 기준으로 보정 후 관련10건 재검사 모두 통과했다. Firefox3건도 통과했다.
- 최종 lint/typecheck/build, 캡처1건(8이미지), 문서 링크/diff 검사 통과. 중간 미사용 import lint/TS 오류도 실제 새로고침 버튼 교체 후 해결했다. 기존 router POP·fontkit/chunk 크기 경고는 보존한다.
- 실제5173의11경로 ×1440/390px ×4시간대88상태, 각 경로320px, 마지막 간격 변경4경로32상태를 확인했다. 비용 상세 창/정정 폼도 PC·모바일로 열어 확인했다. 가로 넘침·pageerror·기존 자료 쓰기0. `/admin/new`는 보존된 기존 초안으로 이동했다. 시안2/설명용PNG8 HTTP200·image/png·바이트 일치, 실제 캡처 대조를 완료했다.
- 원자료와 증거는 ignored `.wrangler/releases/p9-23/boards-*`, 조사 원본은 같은 경로 `research/`. 촬영 스크립트 최초의 hidden option 대기 시간 초과는 attached 대기로 보정했다.
- WebKit의 기존 OS 라이브러리 누락으로 Safari·실기기·화면 읽기 프로그램·Windows 사용자 화면 직접 표시·원격 인증은 미검증이다. Phase/배포 경계가 아니므로 전체 `pnpm check`와 비관리자 E2E를 반복하지 않았다. 앱의 실제 AI·데이터 변경·push·배포는 없다.

## 화면과 실행 환경

- 실제 참여: http://localhost:5173/admin/submissions
- 실제 문의: http://localhost:5173/admin/privacy-requests
- 퀴즈 관리/매뉴얼: http://localhost:5173/admin / http://localhost:5173/admin/manual
- 갱신 실제 UI 예시: http://localhost:5173/images/admin-guide/submissions.png / http://localhost:5173/images/admin-guide/privacy.png
- 시안: http://localhost:5173/docs/design/phase-9/admin-boards/submissions-reference.png / http://localhost:5173/docs/design/phase-9/admin-boards/inquiries-reference.png
- 기존 의미 색상 비교: http://localhost:5173/docs/design/phase-9/admin-sidebar/palette

기존5173을 유지했다. 꺼지면 기존 자료를 재생성하지 않고 루트에서 `pnpm dev:demo --port 5173 --strictPort`로 켠다. Node24.18.0/pnpm11.14.0. 필요 시 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 현재 셸 PATH에 추가한다. E2E는 별도4173 격리 서버이며 명령을 동시에 실행하지 않는다.

검증된 도구 경로: `/bin/bash`, `login:false`, 명시 workdir, `require_escalated` 승인 검토 실행. `codex-exec-recovery`의 인계 경로를 재사용한다. 기본 exec 시작 전 ENOENT를 WSL 단절로 오해하거나 승인 거부를 우회하지 않는다. 이미지는 WSL 경로만 주지 않고 첨부 또는 검증된 HTTP 주소로 보여준다.

작업 시작 Pro 잔여90% × 사용자 기준10 =900%; 별도5시간 창은 없었다. 다음 구현 전에 현재 사용량을 조회한다. 문서 순서: AGENTS → PROJECT_CONTEXT → DECISIONS → STATUS → HANDOFF → implementation의 관련 디자인 명세 → P9-23 → Git 상태/차이/log.

Preview는 P9-14 소스 `0fbde84` / version `cd6efb0e-2c05-4401-b0bf-692bdf18c5b1`, Production은 P9-04 소스 `37b7254` / version `7aea6843-5288-42da-9bef-bc673e1d9dfe` 그대로다.

폐기한 접근: 서로 다른 참고 사이트 요소를 규칙 없이 혼합, 행별 큰 카드와 보라색 상자, 시안만 생성하고 실제 완료로 보고, 같은 버튼/필터를 페이지별 재작성, 실제 자료를 공개 정적 예시에 사용.

**현재 P9-23 로컬 완료 · 부모 관리자 이해 돕기 로컬 완료 · 다음 사용자 화면 확인/피드백 · 세션 유지 · 다음 추천 GPT-6.1-sol/medium** — 공통 기준 안의 한정된 화면 보정에 적합하다.
