# 다음 작업 인수인계

## 현재 작업과 다음 첫 행동

2026-10-12 **P9-12 누적 UI Preview 반영 — 진행 중**. 사용자가 Preview 안내 뒤 “좋습니다. 푸시합시다.”라고 명시 승인했다. 시작 main47e6cbf·clean, fetch한 origin/main21b81de 대비45ahead/0behind다. 전체 `pnpm check`와 Preview dry-run 결과를 확인한 뒤 문서/로컬 커밋→main push→Workers Builds/GitHub CI→실제 Worker version 대조를 진행한다. [현재 기록](work/P9-12.md).

누적 하늘/영상/유리 UI·공통 컴포넌트·서울 시간·메인 탐색·관리자 버튼/좌측 패널/여백이 대상이다. Production·content/backup·원격 DB migration/자료·AI 실행·Access 설정 변경은 제외한다. 원격 main에는 런타임 Worker/shared/migration·package/lock·배포/CI 설정 변경이 없다. Worker 변경은 기존 테스트의 DB 시계 기준7일 경계 보정뿐이다.

## 검사와 배포 진입점

- 현재 소스의 전체 `pnpm check` exit0(unit315/Worker2197/Workflow4/recoveryCLI2/Node14/Python7·lint/typecheck·DB 검사·build). Preview dry-run은 로컬 공개 키 부재로 최초 중단 후 기존 공개 키를 빌드 입력으로만 재사용해 exit0을 확인했다. Preview app/D1/Workflow 대상을 검증했고 기존 로컬 배포 포인터를 복구했다. 실제 원격 빌드는 저장된 Preview 환경을 사용한다. P9-09~11의 UI 브라우저 결과는 각 작업 문서에 보존한다.
- GitHub main push는 `biblequiz-app-preview`의 Workers Builds를 시작한다. build `pnpm run build:preview`, deploy `pnpm exec wrangler deploy --strict --autoconfig=false`. 직접 로컬 deploy로 우회하지 않는다. [배포 계약](spec/architecture.md#preview-반영-경로).
- GitHub check와 Cloudflare deployments 조회 가능. Builds triggers 조회는 인증 오류10000으로 설정을 변경하지 않았다. 직전 소스21b81de의 Workers Builds와 CI validate/browser는 성공했다. 새 소스에서도 각각 확인해야 한다.
- Access 앱의 Preview Worker 보호와 비인증 HTTP403을 확인했다. 로그인 후 실제 관리자 조회/저장 성공은 아직 확인하지 않았다. 기존 관련 E2E는 합성 API이고 실기기/GPU 미측정 한계를 유지한다.
- 증거는 Git 제외 `.wrangler/releases/p9-12/`에 저장한다. 최신 변경 전 UI 검사는 [P9-11](work/P9-11.md), 공통 버튼은 [P9-09](work/P9-09.md), 좌측 패널은 [P9-10](work/P9-10.md)를 따른다.

## Git과 환경 보존

이번 대화는 배포 기록 문서3개만 변경했다. 기존45개 로컬 커밋을 보존하고 검사 뒤 함께 push한다. stage 전 실제 diff/status를 재확인하고 검토한 파일만 명시한다. 재개 시 이후 미커밋 변경도 보존한다. 새 Git blob40MiB 초과 없음.

다음은 이번 작업에서 배포 전에 읽기 조회한 원격 버전이다.

| 대상 | 배포 전 version/소스 |
|---|---|
| Production app |7aea6843-5288-42da-9bef-bc673e1d9dfe / 소스37b7254|
| Production content |48a1269d-a9b2-4405-8bbc-745cdabec1b0 / 기존56bb1bf|
| Production backup |3fb0e7c7-368b-45a9-89f9-2818739e415d / 기존 배포|
| Preview app |3dc36ff6-f6d0-4627-bc43-6beeb3495391 / GitHub21b81de 자동 배포|
| Preview content |2df93f07-3703-42ec-b576-fd085e8c839f / 기존 배포|

실제 자료/키/자막/유료 결과·로컬/원격 DB·migration0000~0038·검토본 원본/자산·폰트·package/lockfile을 보존한다. Production 운영/rollback 정본은 [P9-04](work/P9-04.md)다. Preview dry-run은 원격 배포가 아니며 기존 `.wrangler/deploy/config.json` 포인터를 따로 보존한다.

## 실행·사용량·세션

문서 순서 AGENTS→PROJECT_CONTEXT→DECISIONS→STATUS→HANDOFF→implementation 관련 spec/work→Git. Node24.18.0/pnpm11.14.0. 기본 명령 도구의 시작 전 ENOENT는 검증된 `/bin/bash`, login:false, 명시 workdir, 승인 검토 실행 경로로 해결했다. 일반 pnpm이 PATH에 없으면 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 PATH에 추가한다.

기존5173/4189 서버를 보존한다. 실제 앱은 기존 `.wrangler/ui-demo-state`를 지정한 `pnpm dev:local --host 127.0.0.1 --port 5173 --strictPort`, 검토본은 root의 `python3 -m http.server 4189 --bind 127.0.0.1`이다. [README](../README.md)의 실행 명령을 따른다. 정상 URL에 중복 서버를 띄우지 않는다. E2E4173은 명령이 생성/정리한다.

Pro97% 잔여×사용자 기준10=970%, 별도5시간 없음. **현재 P9-12 진행 중 · 부모 작업 Preview 반영 · 다음 전체 검사/push/배포·CI 확인 · 세션 유지 · 추천 GPT-6.1-Sol/high** — 소스·검사·실제 배포 버전을 함께 대조한다.
