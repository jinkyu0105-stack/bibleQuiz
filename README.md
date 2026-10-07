# 이번 주의 말씀 : 낱말 퀴즈

다사랑교회 주간 설교를 바탕으로 어린이용·장년용 한글 낱말 퀴즈를 제공하는 웹앱입니다.

공개 풀이·제출/채점·지난 퀴즈·출력·관리자 발행과 운영 연결을 구현했고 Phase8 출시 범위는 완료했습니다. 현재 Phase9의 P9-02에서 승인 시안에 맞춘 UI를 로컬 검수하고 있습니다. 최신 상태는 [STATUS](docs/STATUS.md), 정확한 재개는 [HANDOFF](docs/HANDOFF.md), 제품 계약은 [implementation](implementation.md)을 따릅니다. 기본 개발 실행은 아래 `pnpm dev`이며 장년·어린이 시험 화면을 자동 준비합니다.

## 프로젝트 문서 지도

새 task는 다음 문서를 순서대로 읽습니다.

1. [`AGENTS.md`](./AGENTS.md): 이 저장소에서 항상 지킬 개발·검사·안전 규칙
2. [`docs/PROJECT_CONTEXT.md`](./docs/PROJECT_CONTEXT.md): 목표, 사용자, 범위, 기술 구조
3. [`docs/DECISIONS.md`](./docs/DECISIONS.md): 중요한 선택과 이유
4. [`docs/STATUS.md`](./docs/STATUS.md): 실제 완료·진행·미완료 상태
5. [`docs/HANDOFF.md`](./docs/HANDOFF.md): 직전 task의 결과와 다음 첫 작업
6. [`implementation.md`](./implementation.md): 분야별 상세 명세 목차 — 이번 작업에 필요한 절만 읽기

실제 구현 여부는 코드·테스트·migration·Wrangler 설정·Git 기록으로 확인합니다. 의도한 제품 동작은 `implementation.md`가 안내하는 `docs/spec/`와 결정 기록을 확인하며, 둘이 다르면 차이를 먼저 밝히고 함께 바로잡습니다.

과거 일지와 이전 실행 지시는 [보관소](./docs/archive/2026-09-21-p5-48/README.md)에 분리했습니다. 기본 시작 때 전부 읽지 않습니다. 현재 한 작업은 HANDOFF에서 재개하고, 문서 개선의 근거와 다른 병목은 [개발 방식 검토](./docs/DEVELOPMENT_REVIEW.md)를 참고합니다.

## 아주 간단한 구조

```text
React 화면
   ↓ /api/* 요청
biblequiz-app TypeScript 백엔드
   ↓ Drizzle repository
D1 데이터베이스
```

- `src/`: 브라우저에서 보이는 React 화면
- `src/features/hangul-input/`: 한글 입력 상태 모델과 단일 native input 연결
- `src/features/quiz/`: 공개 퀴즈 로딩·화면과 공통 격자·단서·테마·임시 저장·제출 결과·참여 현황, 개발 전용 입력 시험 화면
- `src/features/archive/`: 지난 퀴즈 검색·날짜 필터·더 보기·브라우저 뒤로가기 복원 화면
- `workers/app/`: 제출·채점·조회 등을 담당할 메인 백엔드
- `workers/content/`: 자막과 AI 퀴즈 제작을 담당할 비공개 Workflow 골격
- `workers/backup/`: D1 백업을 담당할 비공개 Workflow 골격
- `workers/_shared/db/`: D1 테이블의 Drizzle schema와 연결 코드
- `workers/_shared/repositories/`: route에서 DB 세부 구현을 분리하는 저장소 계층
- `workers/_shared/services/`: 서버 전용 정책과 외부 adapter 계약. 허가형 본문 계약은 여기에만 있고 실제 provider 연결은 없습니다. 계정 없는 YouTube 자막 adapter도 합성 응답 기반 기술 spike로만 있으며 앱·원격 서비스에 연결하지 않았습니다.
- `migrations/`: 검토한 뒤 환경별 D1에 순서대로 적용하는 SQL
- `shared/`: 공통 자료형과 검사 규칙. `shared/bible-reference/`는 본문 없는 66권 metadata·장절 parser, `shared/puzzle/`은 private 정답·생성기·fixture를 둡니다.

## 개발 환경

- Node.js `24.18.0`
- pnpm `11.14.0`
- npm과 Yarn으로 의존성을 설치하지 않습니다.
- 유일한 lockfile은 `pnpm-lock.yaml`입니다.

## 실행

```bash
pnpm install
pnpm dev
```

`pnpm dev`는 장년·어린이 시험 퀴즈를 자동 준비하고 개발 서버를 시작합니다. 터미널의 `Local` 주소(기본 `http://localhost:5173`)를 엽니다. 이미 실행 중인 서버가 있다면 그 터미널에서 `Ctrl+C`로 종료한 뒤 다시 실행합니다.

- 어린이 첫 화면: `http://localhost:5173/?level=child`
- 장년 첫 화면: `http://localhost:5173/?level=adult`
- 종료: 실행한 터미널에서 `Ctrl+C`

어제의 임시 `4177` 화면과 같은 코드·시험 데이터를 기본 실행에 연결했습니다. 포트는 접속 번호이며 디자인 버전이 아닙니다. 이 데이터는 실제 설교가 아닌 명시적인 시험 자료입니다. `.wrangler/ui-demo-state/`에 보관하므로 재시작해도 같은 퀴즈와 기록을 사용합니다. 이미 있는 기록은 덮어쓰지 않습니다. 기존 `.wrangler/state/` 자료·키·운영 데이터는 변경하지 않습니다. 관리자 Access 인증과 제출용 Turnstile 조건도 유지하므로 첫 화면 확인을 관리자 로그인·제출·실제 AI 실행 검수로 간주하지 않습니다.

기존 로컬 자료를 사용하는 별도 개발 실행은 `pnpm dev:local`입니다. 해당 명령은 시험 데이터를 자동 입력하지 않습니다. 일반 화면 확인에는 `pnpm dev`만 사용하면 됩니다. 포트를 직접 지정하려면 `pnpm dev --port 4177`로 실행할 수 있습니다. 시험 데이터/저장 위치의 구현은 [로컬 개발 계약](docs/spec/architecture.md#로컬-ui-개발-실행)에 둡니다.

`http://localhost:5173/api/health`는 Worker 백엔드 상태를 JSON으로 반환합니다.

공개 읽기 API는 `/api/quizzes/latest?difficulty=child`, `/api/quizzes/YYYY-MM-DD-고유문자6자리?difficulty=adult`, `/api/archive`입니다. 현재 퀴즈의 본인 제출은 `/api/quizzes/:slug/:difficulty/me`, 참여 현황은 `/api/quizzes/:slug/:difficulty/board`, 공식 정답은 `/api/quizzes/:slug/:difficulty/solution`에서 읽고, 본인 제출 서버 삭제는 `DELETE /api/quizzes/:slug/:difficulty/me/submission`입니다. 진행 중 참여 현황과 정답은 해당 난이도를 제출한 활성 session에만 허용하고, 지난 퀴즈에서는 제출 없이 공개합니다. 브라우저는 진행 중 퀴즈의 즉시 제출 결과를 바로 표시하고, 재방문에서는 검증된 본인 제출에만 `정답보기`를 복원합니다. 지난 퀴즈의 `POST /api/quizzes/:slug/:difficulty/practice/check`는 최소 한 칸의 현재 임시 답안만 서버 메모리에서 채점하고 이름·동의·session·Turnstile·제출·참여 수·순위를 만들거나 갱신하지 않습니다. `POST /api/admin/quiz-sets/:id/close-now`는 Access JWT 서명·issuer·audience와 명시적 확인·사유를 다시 검증한 뒤 마감 시각·순위 snapshot·archive·감사 로그를 한 D1 batch로 확정합니다. Access 관리자 제출 관리는 `PATCH /api/admin/submissions/:id`의 숨김·복구와 `DELETE /api/admin/submissions/:id`의 PII 제거를 exact 상태 변경·moderation action·감사 기록으로 함께 확정합니다. 화면 공유 주소에는 `?level=child|adult`, 지난 퀴즈 검색에는 `?q=...&year=YYYY&month=M`을 사용합니다. 정답은 전용 권한 경계를 통과한 `/solution` 또는 archived 전용 채점 응답에만 포함하며 초기 공개 퀴즈·참여 현황 응답에는 본문·비공개 자막과 함께 섞지 않습니다. `0001`~`0006` migration은 격리 테스트 D1과 Preview D1에서 순서 적용·후검사를 완료했습니다. 개발 Local D1과 Production에는 적용하지 않았으므로 각 환경에서 실행하기 전에 migration 현황과 정확한 대상을 다시 확인해야 합니다.

아카이브 cursor와 익명 세션에는 서로 다른 서버 key가 필요합니다. 로컬에서는 `.dev.vars.example`을 참고해 각각 다른 32 random bytes를 64자리 lowercase hex로 만든 `ARCHIVE_CURSOR_SECRET`, `SESSION_PEPPER`를 `.dev.vars`에만 저장합니다. 실제 값은 Git·로그·`VITE_` 변수에 넣지 않습니다. Preview 값은 P4-23에서 별도 Secret으로 연결·실동작 검수했으며, Local과 Production 값은 아직 등록하지 않았습니다.

Turnstile을 연결할 때 공개 site key는 `.env.example`을 참고해 gitignored `.env.local`의 `VITE_TURNSTILE_SITE_KEY`에 두고, 비밀 server key와 정확한 hostname은 `.dev.vars`의 `TURNSTILE_SECRET`, `TURNSTILE_EXPECTED_HOSTNAME`에 둡니다. Preview 전용 widget과 설정은 연결·검수했지만 값 원문은 저장소에 보관하지 않습니다. 공개 site key가 없는 일반 build에서는 제출 버튼이 안전하게 비활성화되는 것이 정상입니다.

관리자 API를 local에서 실제로 호출하려면 `.dev.vars.example`의 `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`를 해당 환경의 Access application 값으로 별도 연결해야 합니다. Preview에는 두 값이 연결되어 있고 Access 보호도 확인했습니다. 본문 없는 성경 장절 검사는 `POST /api/admin/bible/parse-reference`와 `GET /api/admin/bible/reference-preview` 및 `/admin` 화면에서 확인할 수 있습니다. 허가형 본문 provider는 계약만 존재하며 이 API·화면에서 호출하지 않습니다. 현재 코드는 scheduled event handler를 제공하지만 `wrangler.jsonc`에 Cron trigger를 등록하지 않았으므로 자동 예약 실행은 아직 활성화되지 않습니다.

개발 서버에서 `/dev/quiz?level=child` 또는 `/dev/quiz?level=adult`로 한글 입력·새로고침 복구를 시험할 수 있습니다. `&size=10`을 붙이면 10×10 시험 격자입니다. 공식 정답이나 실제 설교 데이터가 없는 개발 화면이며 입력은 브라우저에만 저장합니다. 이 경로는 production build/Preview 배포에는 포함되지 않습니다. 작은 화면에서는 칸을 줄여 퍼즐 전체를 표시합니다. Windows Chrome/Edge와 iPhone Safari/Chrome의 핵심 IME 검수는 통과했고, 보유하지 않은 macOS·Android는 출시 전 외부 검수 게이트로 남아 있습니다.

## 검사

```bash
pnpm check
pnpm test:e2e:list
```

Preview 배포 준비와 실제 검수 근거는 [P4-23 배포 검토안](docs/P4-23_PREVIEW_RELEASE.md)을 봅니다. `build:preview`는 실제 공개 `VITE_TURNSTILE_SITE_KEY`가 없거나 공백을 포함하면 중단합니다. `keep_vars: true`는 대시보드 runtime 일반 변수를 유지하지만 이후 새 버전을 올릴 때도 설정과 D1 binding을 별도로 대조해야 합니다.

`pnpm check`는 lockfile 정책, migration 기록, ESLint, TypeScript, Vitest, production build를 차례로 검사합니다. Worker Vitest는 격리된 로컬 D1에 실제 migration을 적용해 읽기·쓰기·외래키·CHECK 제약도 검사합니다. 실제 브라우저 E2E 실행은 Playwright 브라우저를 설치한 환경에서 `pnpm test:e2e`로 수행합니다. 이 명령은 매번 `/tmp`에 새 D1을 만들고 migration과 명백히 표시된 합성 발행 fixture를 넣어 D1→Worker API→브라우저 경로를 검사한 뒤 폐기합니다. 개발 D1·Preview D1에는 테스트 콘텐츠를 쓰지 않습니다.

E2E는 Chromium, 모바일 Chromium, Firefox, WebKit 프로젝트를 포함합니다. `pnpm test:e2e:list`는 목록 확인일 뿐 브라우저 검사가 아닙니다. 현재 WSL에서의 브라우저 설치 경로와 WebKit 시스템 라이브러리 누락, 실제로 통과한 명령은 [`docs/HANDOFF.md`](./docs/HANDOFF.md)에 기록합니다.

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
- OpenAI API와 자막 provider의 실제 연결(자막 로컬 spike·실패 분류만 구현)
- R2 bucket과 자동 백업
- Production 관리자 경로용 Cloudflare Access와 공개 제출용 Turnstile
- 실제 발행 콘텐츠, 관리자 UI와 최종 이미지 자산

비밀값은 Git에 저장하지 않습니다. 필요한 시점에 Cloudflare Secret으로 환경별 등록합니다.
