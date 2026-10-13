# 다음 작업 인수인계

## 현재 작업과 Git

**P9-23 필터 조회 실패 재시도·접기 영역 중앙 정렬 — 로컬 완료.** `/home/onegem/work/bibleQuiz`, main `e48f08c` / clean에서 재개했다. 이번 로컬 커밋 제목은 `Show filter retry only on load failure and center disclosures`다. 정확한 해시와 작업 폴더는 `git log -1`·`git status --short`로 확인한다. 후속 보정은 같은 P9-23에서 처리한다.

## 변경과 검사

- `src/features/admin-weekly/Policy.tsx`: 정상 상태 새로고침 제거, 목록 조회 실패 때만 ‘다시 시도’. 불러오는 중/실패/성공을 구별하며 저장/시험 안내와 기존 저장 응답의 즉시 갱신은 보존한다.
- `src/components/admin-guide.module.css`: 공통 접기 SVG를 제목·설명을 포함한 summary 전체의 세로 중앙으로 정렬했다. native details, 키보드, 접힌 입력 보존은 유지한다.
- 기존 필터/공통 버튼 검사를 보완했다. 관련 Chromium PC/모바일6건·lint/typecheck·예시 캡처1건 모두 최초 실행 통과. 실제5173의 필터/도구/발행 설정3경로 × 네 시간대 ×1440/390/320px36상태에서 중앙 차이0px·넘침/페이지 오류/API 쓰기0. 각 폭에서 합성 조회 실패 뒤 실제 GET 복구와 버튼 제거도 확인했다.
- 화면 예시8종을 기존 합성 촬영 경로로 재생성했다. filters/settings 두 PNG만 변경됐고 나머지는 동일하다. 주요 실제 캡처와 두 자산을 직접 확인했다. [자산 정보](design/phase-9/admin-guide/README.md).
- 상세 범위·증거는 [작업 기록](work/P9-23.md#필터-조회-실패-재시도와-접기-영역-중앙-정렬)과 ignored `.wrangler/releases/p9-23/filter-retry-*`. 이번 작은 보정에서는 build/전체check/전체E2E·Safari/실기기/화면 읽기 프로그램 검사를 반복하지 않았다. 문서 링크/diff를 확인하고 검토한 파일만 로컬 커밋한다.

이전 설교일 게시판·공통 아이콘·말풍선·매뉴얼·참여/문의 개선은 보존한다. [이전 결과](work/P9-23.md#설교일-게시판작은-아이콘이미지-전달)와 초기 실패/재검사 한계도 유지한다. 폐기한 접근: 평상시 필터 재조회 버튼 노출, 접기 영역 대신 제목 줄에 화살표 정렬.

## 실행과 다음 첫 작업

- 필터: http://localhost:5173/admin/moderation
- 수정·보관 도구: http://localhost:5173/admin/tools
- 이미지 확인: http://localhost:5173/docs/design/phase-9/admin-boards/review.html

기존5173과 로컬 자료를 유지했다. 꺼지면 루트에서 `pnpm dev:demo --port 5173 --strictPort`. Node24.18.0/pnpm11.14.0. pnpm이 PATH에 없으면 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 현재 PATH에만 추가한다. E2E는 별도4173 격리 서버이며 동시에 실행하지 않는다.

도구는 검증된 `/bin/bash`, `login:false`, 명시 workdir, `require_escalated` 승인 검토 경로를 쓴다. 시작 전 ENOENT를 WSL 단절로 판단하거나 승인 거부를 우회하지 않는다. 이미지 확인 페이지의 원래 세 장은 사용자 표시까지 확인했고 추가한 퀴즈 예시는 HTTP/브라우저 디코딩까지 확인했다. WSL 경로 Markdown만 보내지 않는다.

시작 Pro 잔여86% × 사용자 지정10 =860%, 별도5시간 창 없음. 다음 구현 전 사용량을 확인한다. 문서 순서: AGENTS → PROJECT_CONTEXT → DECISIONS → STATUS → HANDOFF → implementation의 관련 명세 → P9-23 → Git 상태/diff/log.

push/배포·실제 자료 쓰기·AI 호출·새 의존성은 없다. Preview는 P9-14 소스 `0fbde84` / version `cd6efb0e-2c05-4401-b0bf-692bdf18c5b1`, Production은 P9-04 소스 `37b7254` / version `7aea6843-5288-42da-9bef-bc673e1d9dfe` 그대로다.

**현재 P9-23 로컬 완료 · 부모 관리자 이해 돕기 로컬 완료 · 다음 사용자 화면 확인/피드백 · 세션 유지 · 다음 추천 GPT-6.1-sol/medium** — 공통 규칙 안의 작은 보정에 적합하다.
