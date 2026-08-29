# BibleQuiz 저장소 작업 지침

이 파일은 저장소 전체에 적용되는 오래가는 작업 규칙만 담는다. 작업 일지나 대화 요약을 이 파일에 쌓지 않는다.

## 작업 시작 순서

새 task를 시작하면 코드 변경 전에 다음을 순서대로 확인한다.

1. `AGENTS.md`
2. `docs/PROJECT_CONTEXT.md`
3. `docs/DECISIONS.md`
4. `docs/STATUS.md`
5. `docs/HANDOFF.md`
6. 이번 작업과 관련된 `implementation.md` 절
7. `git status --short`, `git diff`, 최근 Git log

문서와 코드가 다르면 조용히 한쪽을 따라가지 않는다. 현재 구현 상태는 코드·테스트·migration·Cloudflare 설정·Git 기록을 우선해 판단하고, 의도한 제품 동작은 `implementation.md`와 `docs/DECISIONS.md`를 기준으로 판단한다. 차이를 사용자에게 먼저 설명하고 문서 또는 코드를 함께 바로잡는다.

## 문서의 역할

- `README.md`: 처음 보는 사람이 실행하고 구조를 파악하는 입구
- `implementation.md`: 제품 요구사항, 세부 정책, 데이터·API·단계별 완료 조건을 담는 상세 명세 정본
- `docs/PROJECT_CONTEXT.md`: 목표, 사용자, 범위, 기술 구조의 짧은 요약
- `docs/DECISIONS.md`: 중요한 결정과 선택 이유를 남기는 결정 기록
- `docs/STATUS.md`: 실제로 완료·진행·미완료인 작업의 현재 상태
- `docs/HANDOFF.md`: 직전 task의 구체적인 인수인계와 다음 첫 작업

새 제품 결정을 확정하면 `implementation.md`의 관련 상세 내용과 `docs/DECISIONS.md`를 갱신한다. 구현 상태가 바뀌면 `docs/STATUS.md`를 갱신한다. task를 넘길 때는 실제 Git 상태와 테스트 결과를 확인한 뒤 `docs/HANDOFF.md`를 갱신한다.

## 사용자와 소통

- 사용자에게는 한국어로 답한다.
- 사용자는 코드 이해도가 낮고 AI 도움으로 계속 운영할 예정이므로, 생소한 용어는 현재 프로젝트에서 하는 역할 중심으로 설명한다.
- 계정 설정이나 외부 서비스 조작은 클릭할 위치, 입력할 값, 결과 확인 방법을 한 단계씩 설명한다.
- 월 USD 0 운영을 우선하며 AI API 사용료는 별도로 취급한다. 유료 기능이 필요할 때는 무료안과 저비용 대안, 예상 비용, 도입 이유를 먼저 제시한다.
- 사용자의 질문을 계획 변경 승인으로 간주하지 않는다. 질문에는 근거를 설명하고, 확정된 변경만 문서와 코드에 반영한다.

## 개발 환경과 패키지

- Node.js `24.18.0`, pnpm `11.14.0`을 local, GitHub Actions, Cloudflare Workers Builds에서 맞춘다.
- 프로젝트 루트에서 pnpm만 사용한다. npm 또는 Yarn으로 의존성을 설치하지 않는다.
- `pnpm-lock.yaml`만 lockfile로 유지한다. `package-lock.json`, `yarn.lock`을 만들지 않는다.
- pnpm이 PATH에서 보이지 않으면 먼저 `pnpm --version`을 확인하고, 필요할 때만 현재 WSL의 `/home/onegem/.nvm/versions/node/v24.18.0/bin/pnpm`을 사용한다. 이 기기 경로를 앱 코드나 CI 설정에 고정하지 않는다.
- 새 production 의존성이나 새 외부 서비스는 이유·비용·대안을 설명하고 사용자 결정 후 추가한다.

## 코드와 데이터 안전

- TypeScript strict를 유지하고, 공개 API 경계와 AI 구조화 출력은 Zod로 검증한다.
- D1 schema는 Drizzle schema를 수정하고 SQL migration을 생성·검토한 뒤 순서대로 적용한다. `drizzle-kit push`를 사용하지 않는다.
- 사용자 변경과 관련 없는 dirty worktree 파일을 덮어쓰거나 되돌리지 않는다.
- `.env`, API key, token, 개인 이메일, Access 인증 정보 같은 비밀값을 코드·문서·Git·로그에 기록하지 않는다.
- 성경 본문을 AI가 생성·보완하지 않는다. v1은 개역개정 본문을 저장·복사하지 않고 장절, 판본명, 대한성서공회 공식 읽기 링크만 제공한다.
- 공개 serialization에 정답, 비공개 자막, 관리자 정보가 섞이지 않도록 공개 자료형과 비공개 자료형을 분리하고 테스트한다.

## Cloudflare 환경 경계

- 현재 연결된 원격 환경은 Access로 보호된 `biblequiz-app-preview`와 `biblequiz-d1-preview`뿐이다.
- `wrangler.jsonc` 최상위 Production D1 ID는 의도적인 placeholder다. 사용자 승인 없이 Production Worker·D1·R2·secret·도메인을 생성, 연결, migration 또는 배포하지 않는다.
- GitHub `main` push는 Workers Builds를 통해 `biblequiz-app-preview`에 자동 배포된다. push 전 관련 검사 결과와 변경 범위를 확인하고 Preview 배포임을 사용자에게 알린다.
- Preview D1 원격 migration은 목록을 먼저 확인하고 `--env preview` 대상임을 검증한다.
- `workers/content`와 `workers/backup`은 현재 공개 route가 없는 골격이다. 공개 URL을 임의로 만들지 않는다.

## 검사 기준

- 문서만 바꾸면 최소 `git diff --check`와 링크·사실 관계를 확인한다.
- TypeScript 기능 변경은 관련 테스트와 `pnpm run lint`, `pnpm run typecheck`를 실행한다.
- Phase 또는 배포 단위 완료 전에는 `pnpm check`를 실행한다.
- E2E 목록 확인은 `pnpm test:e2e:list`, 실제 브라우저 검사는 `pnpm test:e2e`다. 두 결과를 혼동하지 않는다.
- 테스트를 실행하지 못했거나 실패했다면 성공했다고 쓰지 않고, 실행하지 못한 이유와 남은 검증을 `docs/STATUS.md`와 `docs/HANDOFF.md`에 남긴다.

## Git과 인수인계

- 파괴적인 Git 명령을 사용하지 않는다.
- 커밋은 한 가지 목적을 설명하는 작은 단위로 만들고, 자동 생성물과 비밀값이 포함되지 않았는지 확인한다.
- `main` push가 Preview 자동 배포를 일으킨다는 점을 항상 고려한다. Production 배포 승인으로 해석하지 않는다.
- task 종료 전 변경 파일, 테스트 결과, 알려진 위험, 미완료 작업, 폐기한 접근법을 실제 코드와 Git diff에서 확인해 `docs/HANDOFF.md`에 기록한다.

## 프런트엔드와 이미지 작업 시점

- Phase 2 퍼즐 엔진은 디자인 없이 순수 도메인 로직과 테스트로 구현한다.
- Phase 7A에서 실제 화면 구현 전에 `imagegen-frontend-web`으로 웹 시안을 만든다.
- Phase 3~6의 실제 화면 코드는 승인된 시안을 기준으로 `design-taste-frontend`를 사용한다.
- 별도의 모바일 세로 이미지가 필요한 Phase 7B에서는 `imagegen-frontend-mobile`을 사용한다.
- 생성 이미지에 성경 구절이나 기타 글자를 합성하지 않는다.
