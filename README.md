# 이번 주의 말씀 : 낱말 퀴즈

다사랑교회 주간 설교를 바탕으로 어린이용·장년용 한글 낱말 퀴즈를 제공하는 웹앱입니다.

현재 저장소는 Phase 1의 실행 가능한 scaffold, D1 기초 schema, Access로 보호된 비운영 Preview Worker와 Preview D1 연결 단계입니다. 실제 퀴즈·제출·관리자 기능과 최종 디자인은 아직 구현하지 않았습니다. 상세 제품 결정은 [`implementation.md`](./implementation.md)를 정본으로 사용합니다.

## 프로젝트 문서 지도

새 task는 다음 문서를 순서대로 읽습니다.

1. [`AGENTS.md`](./AGENTS.md): 이 저장소에서 항상 지킬 개발·검사·안전 규칙
2. [`docs/PROJECT_CONTEXT.md`](./docs/PROJECT_CONTEXT.md): 목표, 사용자, 범위, 기술 구조
3. [`docs/DECISIONS.md`](./docs/DECISIONS.md): 중요한 선택과 이유
4. [`docs/STATUS.md`](./docs/STATUS.md): 실제 완료·진행·미완료 상태
5. [`docs/HANDOFF.md`](./docs/HANDOFF.md): 직전 task의 결과와 다음 첫 작업
6. [`implementation.md`](./implementation.md): 제품·API·데이터·보안·단계별 완료 조건의 상세 명세

실제 구현 여부는 코드·테스트·migration·Wrangler 설정·Git 기록으로 확인합니다. 의도한 제품 동작은 `implementation.md`와 결정 기록을 확인하며, 둘이 다르면 차이를 먼저 밝히고 함께 바로잡습니다.

## 아주 간단한 구조

```text
React 화면
   ↓ /api/* 요청
biblequiz-app TypeScript 백엔드
   ↓ Drizzle repository
D1 데이터베이스
```

- `src/`: 브라우저에서 보이는 React 화면
- `workers/app/`: 제출·채점·조회 등을 담당할 메인 백엔드
- `workers/content/`: 자막과 AI 퀴즈 제작을 담당할 비공개 Workflow 골격
- `workers/backup/`: D1 백업을 담당할 비공개 Workflow 골격
- `workers/_shared/db/`: D1 테이블의 Drizzle schema와 연결 코드
- `workers/_shared/repositories/`: route에서 DB 세부 구현을 분리하는 저장소 계층
- `migrations/`: 검토한 뒤 환경별 D1에 순서대로 적용하는 SQL
- `shared/`: 화면과 백엔드가 함께 사용하는 공개 자료형과 검사 규칙

## 개발 환경

- Node.js `24.18.0`
- pnpm `11.14.0`
- npm과 Yarn으로 의존성을 설치하지 않습니다.
- 유일한 lockfile은 `pnpm-lock.yaml`입니다.

## 실행

```bash
pnpm install
pnpm db:migrate:local
pnpm dev
```

브라우저에서 `http://localhost:5173`을 열면 임시 연결 점검 화면이 표시됩니다. `http://localhost:5173/api/health`는 Worker 백엔드 상태를 JSON으로 반환합니다.

## 검사

```bash
pnpm check
pnpm test:e2e:list
```

`pnpm check`는 lockfile 정책, migration 기록, ESLint, TypeScript, Vitest, production build를 차례로 검사합니다. Worker Vitest는 격리된 로컬 D1에 실제 migration을 적용해 읽기·쓰기·외래키·CHECK 제약도 검사합니다. 실제 브라우저 E2E 실행은 Playwright 브라우저를 설치한 환경에서 `pnpm test:e2e`로 수행합니다.

DB 구조를 바꿀 때는 `workers/_shared/db/schema.ts`를 수정한 뒤 `pnpm db:generate`로 새 SQL을 만들고, 생성된 SQL을 검토한 뒤 `pnpm db:migrate:local`로 적용합니다. `drizzle-kit push`는 사용하지 않습니다.

Preview D1의 미적용 migration은 `pnpm db:migrations:list:preview`로 먼저 확인합니다. 검토 후 `pnpm db:migrate:preview`를 실행하면 `biblequiz-d1-preview`에만 원격 적용됩니다. 이 명령은 Production DB에 사용하지 않습니다.

## 보호된 Preview

`https://biblequiz-app-preview.jinkyu0105.workers.dev`는 Cloudflare Access의 Worker-level `All traffic` 정책으로 보호됩니다. 현재 Cloudflare 계정 구성원만 로그인할 수 있으며 세션은 6시간입니다. 비로그인 요청은 Worker와 D1에 도달하기 전에 Access에서 차단됩니다.

- `/api/health`: 배포된 앱 Worker 상태
- `/api/health/database`: migration이 적용된 Preview D1 binding 상태
- `pnpm run deploy:preview:dry-run`: Preview D1 target과 산출물만 확인
- `pnpm run deploy:preview`: Access가 먼저 적용되어 있음을 확인한 뒤 Preview만 배포

## GitHub 자동 Preview 배포

Cloudflare Workers Builds는 `jinkyu0105-stack/bibleQuiz`의 `main` 브랜치를 **`biblequiz-app-preview` Worker에만** 연결한다. `main`에 푸시하면 이 Access 보호 Preview가 자동으로 갱신되며, 실제 Production Worker·Production D1·실제 도메인은 아직 생성하거나 연결하지 않았다.

- Build command: `pnpm run build:preview`
- Deploy command: `pnpm exec wrangler deploy --strict --autoconfig=false`
- Build 환경: Node `24.18.0`, pnpm `11.14.0`
- 비기준 브랜치 자동 build는 현재 끈 상태다. 별도 feature branch 검토가 필요해질 때만 다시 검토한다.
- Cloudflare가 이 연결 전용 API token을 자동 관리한다. 저장소나 Cloudflare Secret에 사람이 token 값을 복사하지 않는다.
- 첫 build에서 과거 조직 구성원 소유의 무효 token 오류가 나타난 경우, `Settings → Builds → API token → Create new token`으로 교체한 뒤 `Retry build`한다. 2026-08-29에 이 절차로 첫 자동 Preview 배포를 성공 확인했다.

Production 자원은 아직 만들거나 연결하지 않았습니다.

## 아직 연결하지 않은 항목

- Production D1 생성과 binding ID
- `CONTENT_WORKFLOW` 교차 Worker binding
- OpenAI API와 자막 provider
- R2 bucket과 자동 백업
- Production 관리자 경로용 Cloudflare Access와 공개 제출용 Turnstile
- 실제 공개·관리자 UI와 이미지 자산

비밀값은 Git에 저장하지 않습니다. 필요한 시점에 Cloudflare Secret으로 환경별 등록합니다.
