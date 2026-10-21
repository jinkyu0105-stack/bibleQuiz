# 인수인계

## 현재 작업: P9-26 브라우저 CI 복구·Preview 반영

2026-10-21 사용자는 25분 초과 원인을 수정하고 검사 생략 없이 전체 통과 뒤 push·Preview 완료 확인을 요청했다. 시작 main 598af9b/clean, Pro 잔여 84% × 사용자 기준 10 = 840%, 별도 5시간 값 없음. 로컬 수정·검사는 완료했고 지금은 검증한 커밋 push와 원격 CI/Preview 확인 단계다. 부모 P9-26 진행 중, 세션 유지, 다음 추천 GPT-6.1-sol/high.

## 수정과 검증

- `.github/workflows/ci.yml`: 기존 PC·모바일 384개를 96×4로 나눈다. 각 2workers/재시도 2회/25분 유지, fail-fast=false, 결과 artifact 7일 보관. `playwright.config.ts`는 CI line/HTML/JSON·실패 화면·첫 재시도 trace를 남긴다.
- 테스트 6파일은 사라진 UI를 기다리던 경로를 현재 기능으로 갱신했다. 도움말 초점 복귀, Live 제목·날짜·링크, 모바일 더보기, 공유 주소·재방문, 실제 불투명 본문·요약·달력, 선택·입력 복원, 홈 복귀, 모바일 설정 진입과 실제 GPU 픽셀 검증을 유지한다. 제품 UI·DB·의존성 변경은 없다.
- 원본 CI 39460006185/job 118756693404: 25분 취소. 사라진 홈 링크를 효과 검사에서 90초씩 기다린 후 두 번 재시도했다. 원본 `/tmp/p926-browser-job.log`.
- 로컬 최종 전체 브라우저 **377통과/기존 조건부 제외 7/실패 0/재시도 0**(4workers, 17.5분). `/tmp/p926-browser-final.json`/`.log`. 수정 전과 같은 384개 및 같은 제외 7개를 확인했다. 분할 목록의 합집합=384, 중복=0. `/tmp/p926-targets-0.json`~`4.json`.
- 필수 전체 `pnpm check` **2,568건 및 lint/typecheck/빌드 최종 통과**. `/tmp/p926-ci-fix-check-final.log`. 병행 첫 실행의 서버 1건 실패 뒤 파일 7건 독립 실행과 전체 단독 재실행이 통과했다. 기존 fontkit 번들 500kB 경고는 남는다. 중간 브라우저 진단 실패·중단은 [작업 기록](work/P9-26.md#브라우저-ci-시간-초과-수정--2026-10-21)에 모두 구분했다.
- 기존 제외는 시안 촬영·다른 기기의 중복 행렬·터치/휠 조건이며 새 제외나 테스트 삭제는 없다. 실제 휴대폰/Safari 확인과 구별한다. 자세한 실행 계약은 [검사 정본](spec/testing.md#p9-26-브라우저-ci-실행-계약).

## 남은 같은 요청

1. 검증한 파일만 커밋하고 main에 push한다. Preview 자동 배포다.
2. 새 GitHub CI의 validate와 browser(1~4/4)를 모두 성공까지 확인한다. artifact JSON으로 전체 대상·통과·제외·재시도를 대조한다. 실패 시 같은 범위에서 수정하고 재검증한다.
3. Cloudflare Builds의 정확한 커밋/Version ID와 최신 deployments의 같은 버전 100%를 대조한다. 사용자 OAuth 재연결 후 Workers CI Read도 HTTP 200으로 확인된 상태다.
4. Preview 접속 응답과 로컬 5173 상태를 확인하고 문서에 실제 소스·버전·결과를 기록한다. 사후 기록 커밋을 배포 소스로 혼동하지 않는다.

직전 Preview 소스는 2717efc, build 16c28ca6-8720-433d-9233-c5b487fb53ad, version a17323f0-4eb8-4fb2-a064-442652e6d12b(100%)다. [Preview 관리자](https://biblequiz-app-preview.jinkyu0105.workers.dev/admin/new). Production·원격 migration·자료·실제 AI는 범위 밖이다.

## 환경

저장소 `/home/onegem/work/bibleQuiz`, bash login:false. Node24.18.0/pnpm11.14.0 경로가 필요하면 PATH에 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 추가한다. localhost·브라우저·Git 쓰기는 require_escalated 검토 경로다. 도구 시작 실패는 codex-exec-recovery를 따른다. 개발 서버 `pnpm dev:demo --port 5173 --strictPort`와 `.wrangler/ui-demo-state`는 유지했다. E2E4173과 전체 검사 임시 D1은 실제 자료와 분리된다. 브라우저 검사 중에는 소스/문서를 수정해 개발 서버를 다시 로딩하지 않는다.

2~6단계 UI의 관련 코드·48PNG·네 시간대/모바일 검수는 [직전 작업 기록](work/P9-26.md#제작-26단계-작업-소섹션--2026-10-21)을 따른다.
