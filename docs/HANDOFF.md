# 새 task 인수인계

> 인수인계 작성: 2026-08-29, Asia/Seoul  
> 확인 기준: `main`, 기준 커밋 `aa2d071`, 인수인계 문서 변경 전 clean worktree  
> 다음 task 권장 모델: Sol + High  
> 다음 task 목표: Phase 2 퍼즐 도메인 엔진

## 1. 최종 목표

다사랑교회 주간 설교 영상을 바탕으로 관리자가 어린이용·장년용 한글 가로세로 낱말퀴즈를 검수·발행하고, 교인이 모든 해상도의 웹에서 풀고 부분 답안을 제출해 채점·참여 현황·Top N을 확인하며, 누구나 주보용 빈 격자와 조건에 맞는 A4 Top N 결과물을 쉽게 출력할 수 있는 웹앱을 완성한다.

운영 목표는 인프라 월 USD 0 우선이며 OpenAI API 사용료는 별도다. 사용자는 코드를 거의 직접 읽지 않고 AI 도움으로 계속 운영할 예정이므로, 저장소 문서·테스트·Git 기록만으로 새 task가 상태를 복구할 수 있어야 한다.

## 2. 새 task 시작 절차

1. 루트 `AGENTS.md`를 읽는다.
2. `docs/PROJECT_CONTEXT.md`, `docs/DECISIONS.md`, `docs/STATUS.md`, 이 파일을 읽는다.
3. 루트 `implementation.md`의 3장 퍼즐 규칙, 15장 자료형·API 경계, 16장 목표 구조, 17장 Phase 2를 읽는다.
4. `git status --short`, `git diff`, `git log -5 --oneline`으로 실제 상태를 확인한다.
5. 문서와 코드 차이가 있으면 변경 전에 사용자에게 알린다.
6. Phase 2 범위 밖의 UI, OpenAI, Cloudflare Production 작업을 섞지 않는다.

## 3. 확인된 현재 구현 상태

- React 19 + React Router Data Mode + Vite + TypeScript strict scaffold가 실행된다.
- Cloudflare Vite plugin이 Static Assets와 Hono Worker를 함께 build한다.
- `/api/health`, `/api/health/database`, JSON 404와 request ID가 구현되어 있다.
- Drizzle schema와 `0000_foundation.sql`이 있으며 6개 기초 테이블과 제약을 Local·Preview D1에서 확인했다.
- `biblequiz-app-preview`와 `biblequiz-d1-preview`만 실제 Cloudflare에 연결되어 있다.
- Preview 전체는 Cloudflare Access의 `Cloudflare account / Allow`, 세션 6시간으로 보호된다.
- GitHub `main` push는 Workers Builds를 통해 Preview에 자동 배포된다.
- Production Worker·D1·도메인, R2, OpenAI Secret, Turnstile은 아직 없다.
- 실제 화면은 연결 확인용 placeholder다. 퍼즐·제출·관리자·출력 기능은 아직 구현하지 않았다.

## 4. 이번 긴 task에서 확정한 핵심 사항과 이유

- Pages 대신 Workers + Static Assets: SPA·API·D1·내부 binding을 하나의 앱 Worker 경계에서 관리하기 위해서다.
- D1 + Drizzle + SQL migration: 작은 트래픽에 맞고 변경 이력을 코드로 보존하기 위해서다.
- 관리자 Access: 자체 비밀번호 시스템 없이 관리자 화면과 API 앞에 인증 관문을 두기 위해서다.
- `main` 자동 배포 대상은 Preview만: 사용자가 코드를 읽지 않아도 보호된 주소에서 먼저 확인할 수 있게 하기 위해서다.
- Node 24.18.0 + pnpm 11.14.0: local·CI·Cloudflare의 설치 차이를 줄이기 위해서다.
- AI는 설교 의도와 후보 생성, 코드는 격자 배치: 의미 품질과 결정론적 유효성을 분리하기 위해서다.
- 개역개정은 장절·판본·공식 링크만: 전문 이용 허가와 정확성 문제가 해결되지 않았기 때문이다.
- `implementation.md`는 루트에 유지: 상세 명세의 기존 경로와 Git 기록을 보존하고, 짧은 문서 계층으로 탐색 문제를 해결하기 위해서다.

더 자세한 이유와 영향은 `docs/DECISIONS.md`를 따른다.

## 5. 변경한 코드와 파일

현재 구현 세션의 Git 기록:

- `d3a2411 docs: migrate architecture to Cloudflare Workers`
- `ecb6f3f chore: scaffold Cloudflare Workers app`
- `09d2fbb feat: add D1 foundation schema`
- `6ab3c9f chore: connect preview D1 database`
- `340a966 feat: deploy Access-protected preview`
- `3860e39 docs: record preview build automation`
- `aa2d071 docs: record successful preview build`

주요 코드 범위:

- 루트 환경: `package.json`, `pnpm-lock.yaml`, `.nvmrc`, TypeScript·Vite·Vitest·Playwright·Drizzle 설정
- CI·안전 검사: `.github/workflows/ci.yml`, `scripts/check-lockfiles.mjs`, `scripts/check-cloudflare-config.mjs`
- 프런트 scaffold: `src/app`, `src/lib/api-client`, `src/styles`
- API: `workers/app/app.ts`, 표준 envelope, health route
- D1: `workers/_shared/db`, `workers/_shared/repositories`, `migrations/0000_foundation.sql`
- 내부 Worker 골격: `workers/content`, `workers/backup`
- 테스트: `shared/api/*.test.ts`, `workers/app/*.test.ts`, `tests/e2e/scaffold.spec.ts`
- 배포: `wrangler.jsonc`, 각 내부 Worker `wrangler.jsonc`

이번 인수인계 준비에서 추가·수정하는 파일:

- 추가: `AGENTS.md`
- 추가: `docs/PROJECT_CONTEXT.md`
- 추가: `docs/DECISIONS.md`
- 추가: `docs/STATUS.md`
- 추가: `docs/HANDOFF.md`
- 수정: `README.md`, `implementation.md`
- 수정: `docs/future/member-auth-and-church-account-integration.md`의 현재 관리자 인증 설명

## 6. 실행한 검사와 결과

2026-08-29 현재:

- `pnpm check`: 성공
  - unit 2건 성공
  - Worker/D1 6건 성공
  - lockfile·Cloudflare config·Drizzle·ESLint·TypeScript 검사 성공
- `pnpm run build`: 성공
  - Worker와 React client production build 성공
- `pnpm test:e2e:list`: 성공
  - Chromium 2건, mobile Chromium 2건, 총 4건 등록
- `pnpm test:e2e`: 실행하지 않음
  - 실제 Playwright 브라우저 실행 성공을 의미하지 않는다.
- Preview 수동 확인: Access 로그인 뒤 앱 health와 D1 health 성공
- Workers Builds: GitHub push에서 자동 Preview 배포 2회 성공

## 7. 발생했던 오류와 해결 결과

### Workers Builds token 오류 — 해결됨

- 증상: `Your build is configured with a build token that belongs to a user who has left your organization.`
- 원인: 현재 코드가 아니라 Cloudflare 계정에 연결된 과거 조직 구성원 소유의 무효 build token
- 해결: `Worker → Settings → Builds → API token → Create new token`, 새 자동 token 저장 후 `Retry build`
- 결과: Preview version `38ae1c76-1d84-45ce-a634-3b0ebae70d50`, 후속 자동 version `b4db4631-1a6c-4bd5-b7d2-2a5e736b2da1` 배포 확인
- 다시 발생하면: token 값을 Git이나 대화로 복사하지 말고 같은 Cloudflare UI에서 새 자동 token으로 교체한다.

### 문서의 관리자 인증 불일치 — 이번 인수인계에서 수정

- `docs/future/member-auth-and-church-account-integration.md`의 서두가 예전 이메일 allowlist + OTP 계획을 현재 계획처럼 적고 있었다.
- 실제 적용된 현재 정책은 `Cloudflare account / Allow`다.
- 미래에 Cloudflare 대시보드 권한이 없는 관리자를 추가할 때만 정확한 이메일 + OTP를 대안으로 검토한다.

## 8. 알려진 위험과 아직 검증하지 않은 사실

확인된 위험:

- 계정 없는 공개 자막 adapter는 로컬에서 대표 영상 773 segment 추출에 성공했지만 Workers Preview 환경 재검증 전이다.
- 공개 자막 provider는 공식 YouTube captions API가 아니므로 기술 성공 외에 약관과 교회 사용 권한 확인이 필요하다.
- 현재 Access는 Cloudflare 계정 구성원을 허용하므로 계정 구성원 추가 시 접근 범위가 넓어진다.
- 실제 브라우저 E2E를 아직 실행하지 않았다.
- `gpt-5.6-terra`의 실제 설교 품질과 비용을 non-production OpenAI 호출로 평가하지 않았다.

확인하지 않았으므로 추측하면 안 되는 항목:

- Production에서 공개 자막 추출이 항상 성공한다는 보장
- 개역개정 전문을 무료로 저장·출력할 수 있다는 허가
- R2·Turnstile·OpenAI Secret이 이미 연결되어 있다는 가정
- 현재 placeholder UI가 승인된 최종 디자인이라는 가정
- 모든 Cloudflare 무료 정책이 앞으로도 동일하다는 가정

## 9. 아직 하지 않은 작업

- Phase 2 퍼즐 도메인 엔진 전체
- Phase 7A 웹 디자인 시안과 사용자 승인
- 실제 공개 퀴즈·한글 IME·부분 제출·채점·참여 현황·Top N
- 관리자 자막 수정·AI 교정 diff·의도 분석·후보 검수·발행 workflow
- 문의·삭제 요청과 moderation
- 빈 격자 PNG/SVG·단서 복사·A4 Top N PNG/PDF
- 콘텐츠 Workflow 실배포와 OpenAI non-production 연결
- Turnstile, R2 백업, Production 환경, 실제 운영 매뉴얼 화면
- 실제 브라우저·접근성·성능·인쇄 통합 QA

## 10. 다음 task가 가장 먼저 할 일

Phase 2 퍼즐 도메인 엔진을 순수 TypeScript로 구현한다. UI와 D1 저장 route는 이 task 범위가 아니다.

권장 작업 순서:

1. `implementation.md` 3장의 확정된 퍼즐 규칙과 17장의 Phase 2 종료 조건을 추출해 테스트 가능한 invariant 목록을 만든다.
2. 표시형 정답과 격자형 정답의 정규화·완성형 한글 음절·길이 validator를 구현한다.
3. 방향, 좌표, 배치 단어, public cell, private solution, validation report 자료형을 만든다.
4. 같은 음절의 교차 후보를 사전 계산하고 5×5~10×10 경계 안에서 backtracking/branch-and-bound 배치를 탐색한다.
5. 모든 단어 연결, 교차 수·밀도, 균형, 빈 영역, 사용 단어 수를 점수화하되 하드 게이트와 선호 점수를 분리한다.
6. seed와 입력 순서를 고정하면 같은 결과가 나오는 fixture를 만든다.
7. 불가능한 조합에는 `WORD_TOO_LONG`, `NO_SHARED_SYLLABLE`, `DISCONNECTED`, `GRID_TOO_SMALL`, `DENSITY_BELOW_THRESHOLD`처럼 사람이 설명할 수 있는 구조화된 이유를 반환한다.
8. public serialization에 solution 음절이 포함되지 않는 자동 테스트를 추가한다.
9. 관련 테스트, `pnpm check`, 필요한 build를 실행하고 `STATUS.md`·이 파일을 갱신한다.

완료 기준:

- 5×5, 8×8, 10×10 fixture에서 유효한 연결 격자를 재현 가능하게 만든다.
- 모든 선택 단어가 연결되고 교차·경계·충돌 규칙을 통과한다.
- 불가능한 입력은 실패 이유를 반환하고 발행 가능 결과를 만들지 않는다.
- public grid JSON에는 정답 음절이나 private solution이 없다.
- 자동 테스트와 `pnpm check`가 성공한다.
- 새 UI, OpenAI 호출, 원격 D1 migration, Production 자원 변경이 없다.

## 11. 폐기했거나 지금 다시 시도하면 안 되는 접근법

- Cloudflare Pages + Pages Functions 병행: Workers + Static Assets로 완전 전환했다. 두 배포 기반을 다시 섞으면 routing·binding·운영 문서가 이중화된다.
- AI가 완성 격자 좌표까지 최종 결정: 유효성·재현성·비용·정답 비노출 검사를 코드로 보장할 수 없으므로 사용하지 않는다.
- 비공식 YouTube MP3/MP4 downloader를 production 자막 fallback으로 사용: 약관·차단·권한 문제가 있어 채택하지 않는다.
- 개역개정 본문을 관리자가 수동 복사해 DB와 출력에 저장: 수동 복사가 저작권 허가를 대신하지 않으므로 v1에서 하지 않는다.
- 공개 이미지용 R2: 현재 자산 규모에서 불필요한 서비스·결제 부담이므로 Git Static Assets를 사용한다.
- KV 추가: 현재 요구는 D1과 Static Assets로 충족되므로 v1에서 사용하지 않는다.
- 브라우저 기본 인쇄 설정만 안내: 출력 담당자가 머리글·바닥글 같은 옵션을 직접 맞추게 하지 않고 전용 PNG/SVG/PDF 산출물을 제공한다.
- 새 퀴즈 발행 시 기존 퀴즈 즉시 마감: 각 퀴즈가 발행 후 기본 7일을 독립적으로 유지하도록 확정했다.

비기준 브랜치 Preview build, 교회 YouTube OAuth, 일반 회원가입은 영구 폐기가 아니라 현재 v1 보류다. 필요 조건이 생기면 `implementation.md`와 `docs/DECISIONS.md`의 재검토 조건에 따라 새로 판단한다.

## 12. 새 task에 그대로 붙여넣을 첫 메시지

```text
이 저장소의 작업을 이어서 진행해 주세요.

먼저 다음을 순서대로 읽고 현재 상태를 확인하세요.
1. AGENTS.md
2. docs/PROJECT_CONTEXT.md
3. docs/DECISIONS.md
4. docs/STATUS.md
5. docs/HANDOFF.md
6. implementation.md의 3장, 15장, 16장, 17장 Phase 2
7. 현재 git status, git diff, 최근 git log

문서 내용이 실제 코드와 다르면 현재 구현 사실은 코드·테스트·migration·설정을 우선해 확인하되, 차이점을 먼저 알려 주세요. 의도한 제품 정책은 implementation.md와 docs/DECISIONS.md를 기준으로 확인하고 조용히 바꾸지 마세요. 사용자 변경과 관련 없는 파일은 수정하거나 되돌리지 마세요.

이번 task의 목표는 Phase 2 퍼즐 도메인 엔진 구현입니다. UI, OpenAI 호출, 원격 D1 migration, Cloudflare Production 작업은 범위에 포함하지 않습니다.

구현 범위:
- 한글 정답 표시형·격자형 정규화와 완성형 한글 음절·길이 validator
- 5×5~10×10 설정형 가로세로 배치 탐색기
- 모든 단어 연결, 교차 수·밀도, 배치 품질 report
- public grid와 private solution의 자료형·serialization 분리
- seed 기반 재현 가능한 fixture
- 불가능한 입력의 구조화된 실패 이유

완료 기준:
- 5×5, 8×8, 10×10 fixture에서 유효한 연결 격자를 재현 가능하게 생성
- 경계·글자 충돌·연결성·교차 하드 게이트 자동 검사
- 불가능한 조합은 이유를 반환하고 발행 가능한 결과를 만들지 않음
- public serialization에 정답 음절과 private solution이 포함되지 않음
- 관련 자동 테스트와 pnpm check 통과
- docs/STATUS.md와 docs/HANDOFF.md 갱신

먼저 implementation.md의 확정 규칙을 테스트 가능한 invariant로 정리하고, 현재 코드 구조에 맞는 모듈 배치를 제안한 뒤 구현을 시작하세요. 모델은 Sol + High를 사용합니다.
```
