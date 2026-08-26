# 이번 주의 말씀 : 낱말 퀴즈

다사랑교회 주간 설교를 바탕으로 어린이용·장년용 한글 낱말 퀴즈를 제공하는 웹앱입니다.

현재 저장소는 Phase 1의 실행 가능한 scaffold와 D1 기초 schema 단계입니다. 실제 퀴즈·제출·관리자 기능과 최종 디자인은 아직 구현하지 않았습니다. 전체 제품 결정은 [`implementation.md`](./implementation.md)를 정본으로 사용합니다.

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

## 아직 연결하지 않은 항목

- 실제 Cloudflare 계정의 Preview·Production D1 생성과 binding ID
- `CONTENT_WORKFLOW` 교차 Worker binding
- OpenAI API와 자막 provider
- R2 bucket과 자동 백업
- Cloudflare Access와 Turnstile
- 실제 공개·관리자 UI와 이미지 자산

비밀값은 Git에 저장하지 않습니다. 필요한 시점에 Cloudflare Secret으로 환경별 등록합니다.
