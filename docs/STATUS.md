# 현재 구현 상태

> 기준 시각: 2026-08-29, Asia/Seoul  
> 확인한 기준 커밋: `aa2d071` (`docs: record successful preview build`)  
> 이 문서는 구현 여부를 요약한다. 상세 요구사항은 루트 `implementation.md`, 다음 작업은 `HANDOFF.md`를 본다.

## 1. 현재 위치

- 현재 브랜치: `main`
- 기준 커밋을 확인할 때 worktree: clean
- 현재 단계: Phase 1 Cloudflare 기반 완료, Phase 2 퍼즐 도메인 엔진 시작 직전
- 실제 공개 Production: 없음
- 실제 공개 사용자 데이터: 없음
- Preview 주소: `https://biblequiz-app-preview.jinkyu0105.workers.dev`
- Preview 보호: Cloudflare Access `All traffic`, `Cloudflare account / Allow`, 세션 6시간

## 2. 단계별 상태

| 단계 | 상태 | 확인된 결과 |
|---|---|---|
| 기획·상세 명세 | 완료 | `implementation.md`에 제품·API·데이터·보안·출력·운영 정책 기록 |
| Phase 0 출시 전 입력 | 일부 완료 | 계정·저작권 원칙·대표 자막 local spike 완료, Production 자막 provider·실제 예약 이름은 미확정 |
| Phase 1 scaffold | 완료 | React/Vite/TypeScript, Hono Worker, 3개 Worker 골격, health API, CI |
| Phase 1 D1 기초 | 완료 | Drizzle schema, 6개 기초 테이블, 첫 migration, repository 통합 검사 |
| Phase 1 Preview D1 | 완료 | `biblequiz-d1-preview` 생성·migration·read/write 점검 |
| Phase 1 Preview Worker | 완료 | Access 보호 고정 Worker, `/api/health`, `/api/health/database` 실점검 |
| Workers Builds | 완료 | GitHub `main` → `biblequiz-app-preview` 자동 배포 2회 검증 |
| Phase 2 퍼즐 엔진 | 미착수 | 다음 task의 첫 구현 대상 |
| Phase 7A 디자인 시안 | 미착수 | Phase 2 뒤 수행 |
| Phase 3~8 제품 기능·QA | 미착수 | 상세 순서는 `implementation.md` 17장 참고 |

## 3. 현재 코드로 동작하는 것

- `/`, `/archive`, `/quiz/:slug`, `/admin` React Router 경로와 임시 scaffold 화면
- `/api/health` 표준 JSON envelope와 request ID
- `/api/health/database` D1 migration 준비 상태 확인
- 알 수 없는 `/api/*` 요청을 SPA HTML이 아닌 JSON 404로 처리
- D1 외래키·CHECK constraint와 Drizzle repository 기본 read/write
- Local D1 migration과 Preview D1 migration 명령 분리
- Preview/Production D1 ID 혼동을 막는 설정 검사
- GitHub Actions에서 pnpm 기반 `pnpm check`
- Workers Builds에서 `main` push의 Access 보호 Preview 자동 배포

현재 화면은 최종 UI가 아니라 연결 점검용이다. 실제 퀴즈, 제출, 관리자 발행, 참여 현황, 출력 기능은 아직 없다.

## 4. Cloudflare 실제 자원

| 자원 | 상태 |
|---|---|
| `biblequiz-app-preview` | 배포·Access 보호·GitHub 자동 build 연결 완료 |
| `biblequiz-d1-preview` | APAC, migration 적용·binding 완료 |
| Workers Builds | Node 24.18.0, pnpm 11.14.0, build cache 사용, non-production branch build 꺼짐 |
| `biblequiz-content` | 코드 골격만 존재, 공개 route와 원격 배포 없음 |
| `biblequiz-backup` | 코드 골격만 존재, R2·export token·원격 배포 없음 |
| Production Worker·D1·도메인 | 생성·연결하지 않음 |
| R2 | 아직 활성화·bucket 생성하지 않음 |
| OpenAI Secret | 아직 저장소·Preview에 등록하지 않음 |
| Turnstile | 아직 생성·연결하지 않음 |

Workers Builds 첫 실행에서는 과거 조직 구성원 소유의 무효 build token 오류가 발생했다. `Settings → Builds → API token → Create new token`으로 새 자동 token을 만든 뒤 재시도해 해결했다. Preview version `38ae1c76-1d84-45ce-a634-3b0ebae70d50`, 이어진 자동 배포 version `b4db4631-1a6c-4bd5-b7d2-2a5e736b2da1`을 확인했다.

## 5. 2026-08-29 검증 결과

- `pnpm check`: 성공
  - lockfile 정책: 성공
  - Cloudflare 환경 안전 검사: 성공
  - Drizzle migration 검사: 성공
  - ESLint: 성공
  - TypeScript build: 성공
  - Vitest unit: 1 file, 2 tests 성공
  - Workers Vitest: 2 files, 6 tests 성공
- `pnpm run build`: 성공
  - Worker bundle과 React client production build 생성 확인
- `pnpm test:e2e:list`: 성공
  - Chromium 2건 + mobile Chromium 2건, 총 4건 등록 확인
- `pnpm test:e2e`: 이번 task에서 실행하지 않음
  - Playwright 브라우저를 실제로 내려받아 실행하는 E2E는 아직 검증되지 않았다.

## 6. 알려진 위험과 게이트

- 계정 없는 공개 자막 adapter는 대표 영상 local spike에서 773 segment를 얻었지만, Workers 데이터센터 환경 재검증과 약관·교회 사용 권한 확인 전에는 Production 채택할 수 없다.
- 실제 설교 의도 분석 품질과 모델별 비용을 OpenAI non-production 환경에서 아직 평가하지 않았다.
- 일반 사용자 보안, Turnstile, moderation, 제출 제약은 명세만 있고 구현되지 않았다.
- Production 자원·백업·복원·출시 절차는 아직 만들지 않았다.
- 개역개정 전문 사용 허가는 없으므로 `reference_only` 경계를 유지해야 한다.
- 현재 Access 정책은 Cloudflare 계정 구성원 전체를 허용한다. 계정에 다른 구성원을 초대할 때 정책을 재검토해야 한다.
- `implementation.md`가 크므로 새 task는 짧은 문서와 관련 절을 먼저 읽어야 한다. 요약 문서가 상세 정책을 대체하지 않는다.

## 7. 다음 이정표

Phase 2 퍼즐 도메인 엔진을 구현한다.

- 한글 정답 표시형·격자형 정규화와 길이 validator
- 5×5~10×10 설정형 배치 탐색기
- 모든 단어 연결과 교차 밀도 report
- public grid와 private solution 분리
- seed 기반 재현 가능한 fixture
- 불가능한 조합의 구조화된 이유

종료 조건은 여러 크기·단어 수 fixture의 하드 게이트 통과, 조건 미달 발행 차단, public serialization 정답 비노출 자동 검사다.
