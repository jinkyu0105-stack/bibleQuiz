# 다음 작업 인수인계

## 현재 작업

**P9-15 Preview 가상 퀴즈·참여·문의 자료 — 진행 중.** 사용자에게 Preview 새 자료 추가를 명시 승인받았다. 편집 초안1, 진행 중1, 지난2에 두 난도, 지난 퀴즈 제출/코멘트12·가상 삭제 요청2. [현재 범위와 검사](work/P9-15.md). 기존 Preview4퀴즈/1제출·대표 지정·Production·AI/인증 설정을 보존한다. 아직 원격 쓰기는 하지 않았다.

로컬 검증과 원격 기존 자료 digest 저장을 마쳤다. 다음은 검증 파일/문서 로컬 커밋 → Preview 한정 고정 SQL 추가 → 원격 개수/기존 자료 불변 대조와 결과 링크 기록이다. 같은 범위의 등록을 다시 승인받지 않는다. 초안은 입력 본문/제목 편집용이며 AI 생성은 비활성 상태를 유지한다.

## Git·검사·환경

시작 main934f9e0·clean, origin/main0fbde84 대비 결과 문서1커밋 앞섬. 새 파일 scripts/p9-15-preview-fixture.ts, scripts/p9-15-preview-fixture.test.mjs, scripts/test/preview-fixture.config.mjs, workers/app/preview-demo-fixture.test.ts와 STATUS/HANDOFF/P9-15 문서. 사용자 변경은 없었고 기존 커밋을 보존한다. node 준비 검사는 `P915_EXPORT=1 pnpm exec vitest run --config scripts/test/preview-fixture.config.mjs`, Worker 검사는 기존 vitest.worker.config.ts의 preview-demo-fixture.test.ts다. 고정 SQL scripts/fixtures/p9-15-preview.sql과 raw 선언 workers/app/test/sql-fixture.d.ts도 포함한다. Node 준비1·Worker 통합1, `pnpm check`2540건·lint/typecheck/build, 격리 로컬 DB의 PC/모바일12화면·archive API 통과. 중간 실패/수정과 근거는 P9-15에 기록했다.

Node24.18.0/pnpm11.14.0. `/bin/bash`, login:false, 명시 workdir, 승인 검토 실행 경로를 재사용한다. pnpm PATH `/home/onegem/.nvm/versions/node/v24.18.0/bin`. Cloudflare MCP D1 인증 오류는 Wrangler의 기존 인증으로 정상 읽기했고 권한/인증 설정을 바꾸지 않았다. 파일 증거 `.wrangler/releases/p9-15/`는 Git 제외다. 기존5173/4189·로컬자료/배포포인터를 보존한다.

현재 Preview 배포는 [P9-14](work/P9-14.md)의 소스0fbde84/versioncd6efb0e, Production은 P9-04 소스37b7254/version7aea6843이다. 이번 요청은 데이터만 추가하며 push·배포하지 않는다. **현재 P9-15 진행 중 · 부모 테스트 자료 구성 진행 중 · 다음 고정 소스 커밋 뒤 Preview 추가 · 세션 유지 · 추천 GPT-6.1-Sol/high**.
