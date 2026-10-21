# 인수인계

## 현재 작업: P9-26 브라우저 CI 복구·Preview 반영

2026-10-21 사용자 요청: 25분 초과 원인 수정, 검사 생략 없이 전체 통과 후 push·Preview 완료 확인. 시작 main 598af9b/clean, Pro 84% × 사용자 기준 10 = 840%, 별도 5시간 값 없음. 첫 수정 37090d7 push/원격 CI/Preview 성공 후 재시도 4건을 추가 보완했다. 부모 진행 중, 세션 유지, 추천 GPT-6.1-sol/high. 추가 수정 뒤 필수 전체 check도 완료했다. 다음은 검증한 파일 커밋·push 및 원격 재확인이다.

## 원인·수정·검사

- 삭제된 UI 대기·재시도와 384개 단일 작업이 원본 CI 39460006185를 25분에 취소시켰다. 실제 UI 경로·의미 검증으로 갱신하고 네 분할, 각 2workers/재시도 2회/25분 유지, fail-fast=false, line/HTML/JSON·실패 화면·trace artifact 7일 보관을 적용했다. 관련 정본 [testing](spec/testing.md#p9-26-브라우저-ci-실행-계약), 상세 근거·중간 실패 [P9-26](work/P9-26.md#브라우저-ci-시간-초과-수정--2026-10-21).
- 기존 로컬 전체 브라우저 377통과/같은 조건부 제외 7/실패·재시도 0, 17.5분. 동일 384개와 제외 목록, 분할 합집합 일치·중복 0을 확인했다. `/tmp/p926-browser-final.json`/`.log`.
- 첫 수정 37090d7의 [원격 CI 39531823978](https://github.com/jinkyu0105-stack/bibleQuiz/actions/runs/39531823978)는 validate/네 browser 모두 성공, 최장 10분 33초. artifact 합계는 즉시 통과 373/재시도 통과 4/기존 제외 7/최종 실패 0이다. `/tmp/p926-ci-artifacts/{1,2,3,4}/test-results/results.json`.
- 재시도 보완: `mobile-sky-settings.spec.ts`는 클릭 시점부터 모션 측정, 헤더 3너비 각각 독립 검사(총 대상 388개로 증가). `home-flow-effects.spec.ts`는 기존 90초 안에서 GPU 초기화만 최대 15초 대기한다. 실제 단언·7개 기존 제외는 유지한다. 모션 별도 10회와 변경 경로 PC·모바일 반복 30회 모두 retries=0 통과. `/tmp/p926-dock-motion-repeat.json`, `/tmp/p926-stability-repeat.json`.
- 필수 check는 첫 수정에서 최종 2,568건/lint/typecheck/build 통과. 처음 병행 실행의 서버 1건 실패는 파일 7건과 전체 단독 재실행 성공으로 구분 기록했다. 추가 보완 뒤 `pnpm check`도 2,568건/lint/typecheck/build 모두 통과: `/tmp/p926-stability-check.log`. 기존 fontkit 번들 크기 경고는 남는다.

## 다음 같은 요청

1. 검토한 파일만 커밋·main push한다. Preview 자동 배포다. 388개 전체/97개씩 네 분할의 합집합 일치·중복 0도 확인했다(`/tmp/p926-stable-targets-{0,1,2,3,4}.json`).
2. 새 소스의 validate와 browser 네 작업 모두 성공까지 확인한다. artifact JSON의 전체 대상/7개 기존 제외/실패·재시도를 대조하고 추가 실패는 같은 범위에서 해결한다.
3. 새 Cloudflare build 소스·Version ID·deployment 100%를 대조한다. Production·원격 자료·migration·실제 AI 변경은 없다.
4. Preview Access 응답·5173 상태를 확인하고 실제 소스/버전/결과를 기록한다. 사후 문서 커밋을 배포 소스로 혼동하지 않는다.

현재 실제 Preview 소스 **37090d7a46c08c39c03dbf58ba42cce5cee02b2b**, build **34c03eae-ac3b-4854-915d-c0531bb4b0f0**, version **efc2b27b-7bef-4264-97b6-6030c52b5a87**, deployment **8525f600-5e5f-45c8-b69d-dccd82e9c8c7**, 2026-10-21 11:15:13 KST 100%.[Preview 관리자](https://biblequiz-app-preview.jinkyu0105.workers.dev/admin/new). 인증 뒤 실제 폰 화면은 사용자 확인 대상이다.

## 환경

저장소 `/home/onegem/work/bibleQuiz`, bash login:false. Node24.18.0/pnpm11.14.0 경로가 필요하면 PATH에 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 추가한다. localhost·브라우저·Git 쓰기는 require_escalated 검토 경로다. 도구 시작 실패는 codex-exec-recovery를 따른다. 개발 서버 `pnpm dev:demo --port 5173 --strictPort`와 `.wrangler/ui-demo-state`는 보존한다. E2E4173과 전체 검사 임시 D1은 실제 자료와 분리된다. 브라우저 검사 중에는 소스/문서를 수정해 서버를 다시 로딩하지 않는다. 실제 휴대폰/Safari 검수와 Chromium 모바일 에뮬레이션을 구별한다.

2~6단계 UI의 코드·48PNG·네 시간대/모바일 검수는 [직전 작업 기록](work/P9-26.md#제작-26단계-작업-소섹션--2026-10-21)을 따른다.
