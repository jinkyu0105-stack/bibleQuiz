# 다음 작업 인수인계

## 현재 작업

**P9-26 공개 풀이·지난 퀴즈 후속: 모바일 보정 로컬 완료, 배치/목록 제안 사용자 선택 대기.**

2026-10-20 main e874d14/clean에서 시작. 경로 `/home/onegem/work/bibleQuiz`, Pro 잔여93%×사용자 기준10=930%(별도5시간 값 없음). 사용자는 전체 배치를 아직 확정하지 않았다. 실제 적용은 모바일 지난 퀴즈 날짜 숨김과 Live 제목/공개 버튼의 한 행 배치 두 곳이다. 새 의존성·실제 콘텐츠 AI·원격 자료·push/배포는 제외했다. 사용자 요청의 디자인 이미지 생성1회만 수행했다.

## 이번 결과와 진입점

- `src/features/archive/archive.module.css`: 767px 이하에서 정확한 날짜를 다시 표시하던 override 제거. 첫 줄은 주차·월별 주제만 남는다. 날짜 타일은 PC에서 유지, 설교일 데이터/검색/선택창 불변.
- `src/features/admin-weekly/dashboard.module.css`: 760px 이하 Live를 2열 grid로 배치, 제목과 공개 링크를 같은 행에 두고 메타는 아래 전체 폭. 제목은 한 줄/말줄임, 링크의 44px 터치 높이 보존. 기존 공통 `text-wrap:pretty`가 nowrap을 덮는 현상을 실제로 발견해 해당 제목 선택자의 우선순위를 조정했다. PC/나머지 목록 구조는 유지.
- 이전 e874d14의 월별 주제는 기존 site_state `sermon_theme:YYYY-MM`, GET/PATCH `/api/admin/sermon-themes/:month` 및 `MonthlySermonTheme.tsx`에 구현되어 있다. 새 migration 없고 실제 주제를 추측해 저장하지 않았다. 헤더/지난 퀴즈는 `QuizChoiceDialog`를 공유하며 `/dev/design#choice`에 등록했다.

## 반드시 유지할 승인 경계

사용자는 헤더=본문 폭이고 설정 패널은 별도로 오른쪽에 놓는 방향을 질문했지만 **아직 확정하지 않았다**. 실제 `sky.css`/공통 레이아웃은 수정하지 않았다. `docs/design/phase-9/layout-audit/independent/review.html`의 C안은 촬영 브라우저에서만 CSS 주입했다.

C안: 헤더/본문 `min(1376px,100vw - 216px)`, 가운데 정렬, 우측 패널60px와 간격24px. 3440/2560에서는1376px,1440에서는1224px,1024에서는808px,768에서는552px. A/C9쌍에서 가로 넘침0. 좁은 화면에서 좌우가 대칭으로 줄어들며 오른쪽만 짧아지지 않는다. **1024px 이하에서는 기존 하단 설정 팝업으로 옮기는 방향을 추천했으나 미적용**. 현재 실제 기준은700px 이하. 다음 turn에서 승인 없이 변경하지 않는다.

모바일 관리 목록은 더보기(···) 하나로 편집/설정/참여 기록을 여는 방식을 생성 시안으로만 제안했다. 제목 공간/행 높이를 확보하지만 추가 탭1회가 필요하다는 점을 설명했다. 실제 목록의 버튼/참여 수는 유지. 이미지의5개 가상 탭/글자 대용 선/버튼 좌표는 제품 사양이 아니다.

사용자에게 알려준 용어: 본문 영역(메인 콘텐츠), 우측 설정 패널. 기존 실제 320~3440px 검사에서 넘침0이었으며 초광폭의 빈 공간은 별도 배치 문제다. DPR1.25에서CSS1440→PNG1800을 재현한 이전 증거를 보존한다. 모든 실제 기기에서 잘림이 없다고 일반화하지 않는다.

## 확인 주소와 자산

- http://localhost:5173/docs/design/phase-9/layout-audit/independent/review
- http://localhost:5173/archive
- http://localhost:5173/admin

새 갤러리는 실제 A/C18장·모바일 네 시간대8장·생성 시안1장 및 측정JSON이다. PNG27개 HTTP200/image/png, A/C18전환·모바일시간대 decode 성공. 처음 갤러리375px에서 이미지의425px 최소 폭 때문에64px 넘침이 있었고 이미지 max-width/min-width를 수정했다. 앱 자체 넘침과 구분한다. 최종 결과는 `http-verification.json`에 기록한다. 사용자 Windows 화면 표시 확인은 별도다.

## 검사와 한계

- 기존 E2E archive metadata3건 + admin quiz board3건, Chromium·모바일 Chromium·Firefox 모두 통과. `/tmp/p926-mobile-e2e.log`, `/tmp/p926-mobile-admin-e2e.log`. 최초 grep은 archive만 선택해 관리 검사를 별도로 실행했다.
- lint/typecheck exit0: `/tmp/p926-mobile-{lint,types}.log`. CSS만 실제 제품 변경이며 전체 pnpm check/배포 완료로 보고하지 않는다.
- 최종 실제 모바일/PC32상태(네 시간대×320/375/425/1440×archive/admin)에서 넘침/페이지 오류0. 모바일 제목/링크 중심 오차1px 이하, 날짜 비표시, 한 줄·말줄임을 측정했고 PNG 직접 검토. 처음 찍은 Live는 text-wrap 충돌 때문에2줄이었으므로 폐기하고 최종 촬영으로 교체했다. `/tmp/p926-mobile-final.log`, 갤러리 `measurements.json`.
- 실제 iPhone/Safari는 미검수. 이전 WebKit은 시스템 라이브러리 부족으로 시작 실패했으며 이번 CSS 검수에서 재시도하지 않았다. 생성 이미지는 실제 작동 화면으로 보고하지 않는다.

## Git·환경·보존

시작 부모 e874d14. CSS2파일·DESIGN/관련 정본·DECISIONS/STATUS/HANDOFF·작업 기록·비교 자산을 로컬 커밋한다. 재개 시 실제 log/status 확인. 마지막 원격 일치 확인main516a98e/배포 완료 미확인, 마지막 완전 대조 Preview ceb50e3/version2227f720-c164-4c04-a014-cb2720fea411. 최신 로컬이 Preview에 반영됐다고 안내하지 않는다.

로컬 장년10×10 e2e-adult-10/revision3, 어린이5×5, 이전 버전·참여 자료·`.wrangler/ui-demo-state` 보존. Node24.18.0/pnpm11.14.0. 명령은 bash/login:false/명시workdir, 필요 시 PATH에 `/home/onegem/.nvm/versions/node/v24.18.0/bin` 추가. localhost·브라우저·Git 쓰기는 require_escalated 승인 검토 경로.5173 유지, 재시작 `pnpm dev:demo --port 5173 --strictPort`. E2E4173은 격리 D1. 도구 시작 실패는 codex-exec-recovery를 따른다.

다음: 경로/사용량→AGENTS→PROJECT_CONTEXT→DECISIONS→STATUS→HANDOFF→implementation 관련 정본→P9-26→Git status/diff/log. 현재 P9-26에서 C안과 모바일 목록 제안의 선택을 반영한다.

**현재 P9-26 모바일 보정 로컬 완료 · 부모 공개 UI 사용자 확인 대기 · 다음 C안/모바일 목록 제안 선택 · 세션 유지 · 추천 GPT-6.1-sol/high** — 공통 배치와 조작 방식의 회귀를 함께 확인한다.
