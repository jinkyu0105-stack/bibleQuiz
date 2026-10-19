# 다음 작업 인수인계

## 현재 작업

**P9-26 공개 풀이·지난 퀴즈 후속: 로컬 구현·관련 검수 완료, 사용자 화면 확인 대기.**

2026-10-19~20 main d8dda1f/clean에서 시작했다. 실제 경로 `/home/onegem/work/bibleQuiz` 확인, Pro잔여95%×사용자 지정10=950%, 별도5시간 값 없음. 사용자 선택은 **월별 입력·저장까지 구현**, 초광폭 배치는 **원인과 비교만 확인**이다. 헤더/본문/우측 설정 패널의 폭·위치는 제품에서 바꾸지 않았다. 새 의존성·실제 AI·원격 데이터·push/배포는 제외했다.

## 현재 결과와 진입점

- `src/features/archive/ArchiveCards.tsx`, CSS: 주차·월별 주제를 위, 제목·장절을 아래에 배치. 날짜 타일54px, 행 최소76px·세로9px. 모바일 자연 줄바꿈·정확한 날짜·전체 행 선택 유지. 빠른 날짜 선택의 오래된 렌더 문제는 `page.tsx`에서 최신 URL의 다른 조건을 보존하도록 수정했다.
- `shared/api/sermon-themes.ts`, `workers/_shared/services/sermon-themes.ts`, weekly routes: GET/PATCH `/api/admin/sermon-themes/:month`. 기존 site_state의 `sermon_theme:YYYY-MM` 사용, 한 줄 최대120자. 빈 값은 미등록. 감사 게이트와 upsert를 한 batch로 묶어 revision 충돌·실패 rollback을 보장한다. 공개 archive는 최종 공개 설교 월에 대응하는 문자열/null만 노출한다. 새 테이블/migration 없음, 전체 DB SQL 백업 대상에 포함된다.
- `MonthlySermonTheme.tsx`: 퀴즈 관리의 작은 접기 편집 영역. 열 때만 조회하며 저장 실패에 입력 보존, 최신 상태 확인에도 작성문 유지. 저장/취소 전에는 다른 달 선택을 막아 입력을 잃지 않도록 한다. 실제 교회 주제를 추측해 저장하지 않았다. 로컬 시연 DB도 이번에 수정하지 않았다.
- `QuizChoiceDialog.tsx`, `WeeklyQuizMenu.tsx`, `weekly-choice.ts`: 헤더에서 현재 대표/자동 선택 퀴즈를 조회해 공통 어린이→장년 모달을 연다. 빈 상태·오류/재시도·장년만 존재하는 경우를 처리하고 영구 slug로 이동한다. 최초 페이지 조회를 추가하지 않는다. native dialog·portal·Esc·초점 복원 유지. `/dev/design#choice`에도 실제 공통 부품 등록(총9종).
- `docs/design/phase-9/layout-audit/`: 실제3440px 메인/풀이/지난 퀴즈/관리 A/B 8장, 네 시간대 실제 화면, 측정 JSON과 검토 HTML. B는 촬영 브라우저에만 CSS 주입했다. 제품에 적용하지 않는다. 과거 refinement 페이지에서 최신 링크로 안내한다.

## 초광폭 원인과 사용자 선택

공통 헤더 max1376px·앱 max1440px/padding-left36/right104·패널 viewport right24px는863a84bc(2026-10-10), archive max1100px는3ba7a8c(2026-10-17)에서 들어왔다. 최근 화살표/한 줄 보정에서 변경한 것이 아니다.3440px에서 헤더1032~2408, 풀이1036~2336, archive1136~2236, 패널3356~3416이다. 풀이-패널 간격1020px,2560px에서는580px. 과거1600px까지만 확인한 한계를 사용자에게 인정했다. 앞으로320·375·425·768·1024·1440·2560·3440px를 포함한다.

B 비교는 헤더 길이를 유지하며 본문 왼쪽/패널 오른쪽을 헤더에 맞추고 사이20px, archive 공통 본문 폭을 제안한다. **사용자는 비교만 선택했으므로 다음 turn에서도 적용 승인이 없는 한 제품 폭/위치를 바꾸지 않는다.** CSS1440·DPR1.25에서PNG1800으로 촬영되지만 scrollWidth/innerWidth1440인 것도 재현했다. 사용자 실제 배율 확인과는 구분한다.

확인 주소:
- http://localhost:5173/docs/design/phase-9/layout-audit/review
- http://localhost:5173/archive
- http://localhost:5173/admin
- http://localhost:5173/dev/design#choice

갤러리200, PNG25개200/image/png, decode 성공, A/B 전환·390px 넘침0을 확인했다. Windows 사용자의 실제 표시 확인은 별도다.

## 검사와 남은 한계

- 단위2건: `/tmp/p926-unit.log`. D1 archive15건·theme3건 통과. 첫 D1 실행에서 TEMP TRIGGER가 SQLITE_AUTH로 실패하여 지원되는 일반 트리거로 바꾸고 rollback 검사를 통과했다. `/tmp/p926-worker.log`, `/tmp/p926-worker-retry.log`.
- Chromium·모바일 archive/admin/new 전체38대상 최초36통과/월 필터1실패/모바일 휠1skip. 빠른 월→연도 선택에서 월이 빠지는 제품 문제를 수정했다. 최종 관련 Chromium·모바일·Firefox15건 모두 통과. WebKit5건은 libgtk/gstreamer 등 시스템 라이브러리 부족으로 시작 실패. `/tmp/p926-e2e.log`, `/tmp/p926-e2e-final.log`. Safari/실기기 성공으로 보고하지 않는다.
- lint/typecheck/build exit0: `/tmp/p926-lint-final.log`, `/tmp/p926-types-final.log`, `/tmp/p926-build.log`. 마지막 build의 tsc도 최종 코드를 검사했다. 기존 fontkit711KB/큰 chunk 경고 유지. 로컬 후속이며 Phase/배포 완료가 아니므로 전체 pnpm check는 반복하지 않았다.
- 실제5173 네 시간대,320~3440px의60상태에서 가로 넘침/페이지 오류0. 주요 PNG 직접 검토. `measurements.json`, `http-verification.json` 보존. 실제 iPhone/Safari는 미검수이며 적용하지 않은 B는 기기별 제품 검수 완료로 간주하지 않는다.
- Context7 조회는 EAI_AGAIN으로 실패했다. Cloudflare D1 batch 공식 문서로 원자 저장을 확인했다. CSS/물리픽셀 설명은 Chrome DevTools와 MDN 공식 문서를 확인했고 갤러리에 링크했다.

## Git·환경·보존

시작 부모d8dda1f. 검증한 코드·정본·DESIGN/STATUS/HANDOFF·상세 작업 기록과 비교 자산을 로컬 커밋한다. 재개 시 실제 git log/status를 확인한다. 마지막 원격 일치 확인main516a98e, 그 Preview 완료 미확인. 마지막 완전 대조된 Preview는ceb50e3/version2227f720-c164-4c04-a014-cb2720fea411(2026-10-16 12:51:24KST). 최신 로컬이 Preview에 반영됐다고 안내하지 않는다.

로컬 장년 e2e-adult-10/revision3의10×10, 어린이5×5와 이전 버전·참여 자료·`.wrangler/ui-demo-state` 보존. Node24.18.0/pnpm11.14.0. `/bin/bash`, login:false, 명시workdir; PATH 필요 시 `/home/onegem/.nvm/versions/node/v24.18.0/bin` 추가. localhost·브라우저·Git 쓰기는 require_escalated 승인 검토 경로.5173 유지, 재시작 `pnpm dev:demo --port 5173 --strictPort`. E2E4173은 격리D1. 시작 실패는 codex-exec-recovery를 따른다.

다음 시작: 경로/사용량→AGENTS→PROJECT_CONTEXT→DECISIONS→STATUS→HANDOFF→implementation 관련 명세→P9-26→Git status/diff/log. 현재 P9-26에서 월별 주제/선택창/비교 피드백을 처리한다.

**현재 P9-26 후속 로컬 완료 · 부모 공개 UI 사용자 확인 대기 · 다음 초광폭 비교/월별 주제 피드백 · 세션 유지 · 추천 GPT-6.1-sol/high** — 공통 배치 선택에 따른 공개·관리 화면 회귀 확인이 필요하다.
