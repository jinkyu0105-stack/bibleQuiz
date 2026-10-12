# 다음 작업 인수인계

## 현재 작업과 다음 첫 행동

2026-10-12 **P9-12 누적 UI Preview 반영 — 완료**. 사용자 “좋습니다. 푸시합시다.” 승인에 따라 GitHub main에 **2d2b1aa5dfd87e0f1cfb2dada56991f2712a9b7f**까지 push했다. Workers Builds17f77d49-1a1b-4b3f-b082-efe773f7bdd7 성공, 실제 Preview version **7f09d123-0067-43b8-bcc9-732e6896f6bc**·100%·2026-10-12 13:20:55KST를 확인했다. [CI38203328796](https://github.com/jinkyu0105-stack/bibleQuiz/actions/runs/38203328796)의 validate/browser도 모두 success다. 승인된 push·Preview 배포·검사가 끝났으며 다음 필수 구현은 없다. 종료 결과 문서만 별도 로컬 커밋으로 보존한다. [전체 근거](work/P9-12.md).

누적 하늘/영상/유리 UI·공통 컴포넌트·서울 시간·메인 탐색·관리자 버튼/좌측 패널/여백이 반영됐다. Production·content/backup·원격 DB migration/자료·AI 실행·Access 설정 변경은 하지 않았다. 실제 관리자 화면은 [Preview 발행 도구](https://biblequiz-app-preview.jinkyu0105.workers.dev/admin/tools)에서 Access 로그인 뒤 확인한다. Preview는 운영과 별도 DB이고 AI 생성은 false다. 로그인 후 실데이터 조회/저장 검사는 이번 작업에서 수행하지 않았다.

## 검사·수정·한계

- 최신 제품 소스의 로컬 `pnpm check` exit0: unit315/Worker2197/Workflow4/recoveryCLI2/Node14/Python7, lint/typecheck·DB 구성·build 통과. Preview strict dry-run exit0, app/D1/Workflow Preview 대상 확인. 기존500kB fontkit 번들 경고 유지.
- 로컬 공개 사이트 키 부재로 최초 Preview dry-run이 빌드 전에 중단됐다. 기존 공개 키를 빌드 입력에만 재사용해 통과했고 실제 Workers Builds는 저장된 Preview 환경으로 성공했다. Secret/원격 설정 변경 없음. 원래 `.wrangler/deploy/config.json` 복구.
- 최초 소스afb61dd의 CI38202232552: validate성공, browser216통과/1실패/1건너뜀. 유일한 실패는 모바일 native snap 도중 좌표를 단발 측정한 `sky-controls-polish.spec.ts:92`다. 정상 정착699.71875px를 재현했고 `innerHeight`와 끝 위치 차이가2px 미만이 될 때까지 expect.poll로 확인하도록 테스트1곳만 보정했다. 앱 스크롤/디자인은 그대로다.
- 보정 뒤 lint/typecheck exit0. 관련18건 최종 반복 통과(1.4분). 앞선 반복에서는 다른 PC 앵커 이동1회 실패(17통과/1실패)가 있었고 최종 반복에서 재현되지 않았다. 이 간헐 실패의 원인까지 확정했다고 쓰지 않는다. 최종 GitHub full check도 통과했고 PC/모바일 Chromium217통과·기존 터치 전용1건 PC 건너뜀·실패/재시도0(12.5분)이다.
- Preview 비인증 HTTP는 배포 전후403, Worker Access 보호 유지. Builds triggers API는 인증 오류10000으로 조회하지 못해 GitHub check와 deployments GET을 대조했다. 관리자 로그인 후 조회/저장·실기기/GPU 검수는 아니다. P9-09~11의 기존 UI 검사와 관측 한계는 각 작업 문서에 보존한다.
- 증거: Git 제외 `.wrangler/releases/p9-12/`의 check/dry-run/CI/반복 검사 로그·scroll-diagnostic·remote-before/after/final.json. 임시 추적 파일과 실제 자료/키는 Git에 넣지 않는다.

## Git과 원격 버전

시작 `/home/onegem/work/bibleQuiz`, main47e6cbf·clean, fetch한 origin/main21b81de보다45커밋 앞섬. 기존 커밋을 보존해 준비 문서afb61dd와 함께 push했고, 이후 테스트/문서 보정2d2b1aa를 push했다. 제품 실행 코드·자산은47e6cbf 그대로다. 이번 작업의 직접 변경은 E2E assertion1곳과 문서3개뿐이다. 종료 결과 문서는 별도 로컬 커밋으로 남기며 실제 배포 소스와 구분한다. 재개 시 실제 Git status/log를 확인하고 이후 변경을 보존한다.

| 대상 | 최신 version/소스 |
|---|---|
| Preview app |7f09d123-0067-43b8-bcc9-732e6896f6bc / GitHub2d2b1aa 자동 배포|
| Production app |7aea6843-5288-42da-9bef-bc673e1d9dfe / 소스37b7254|
| Production content |48a1269d-a9b2-4405-8bbc-745cdabec1b0 / 기존56bb1bf|
| Production backup |3fb0e7c7-368b-45a9-89f9-2818739e415d / 기존 배포|
| Preview content |2df93f07-3703-42ec-b576-fd085e8c839f / 기존 배포|

최종 Preview deployment1b2be90d-5ff7-42ae-a0fe-fec3981373d5. 다른4개 Worker는 배포 전후 버전 불변. 원격 migration·실제 자료·키·자막/유료 결과·폰트·package/lockfile을 보존한다. 일반 [Preview 배포 계약](spec/architecture.md#preview-반영-경로)은 main push→Workers Builds이며 직접 deploy로 우회하지 않는다. Production 운영/rollback 정본은 [P9-04](work/P9-04.md)다.

## 실행·사용량·세션

문서 순서 AGENTS→PROJECT_CONTEXT→DECISIONS→STATUS→HANDOFF→implementation 관련 spec/work→Git. Node24.18.0/pnpm11.14.0. 기본 명령 도구의 시작 전 ENOENT는 검증된 `/bin/bash`, login:false, 명시 workdir, 승인 검토 실행 경로로 해결했다. 일반 pnpm이 PATH에 없으면 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 PATH에 추가한다.

종료 시 기존5173/4189 서버 HTTP200과 원래 로컬 배포 포인터 보존을 확인했다. 실제 앱은 기존 `.wrangler/ui-demo-state`를 지정한 `pnpm dev:local --host 127.0.0.1 --port 5173 --strictPort`, 검토본은 root의 `python3 -m http.server 4189 --bind 127.0.0.1`이다. [README](../README.md)의 실행 명령을 따른다. E2E4173은 별도 임시 DB를 사용해 생성/정리한다.

시작 Pro97% 잔여×사용자 기준10=970%, 별도5시간 없음. **현재 P9-12 완료 · 부모 작업 누적 UI Preview 반영 완료 · 다음 사용자 Preview 화면 피드백(필수 후속 구현 없음) · 세션 유지 · 추천 GPT-6.1-Sol/medium** — 기존 화면 확인·작은 보정에 적합하다.
