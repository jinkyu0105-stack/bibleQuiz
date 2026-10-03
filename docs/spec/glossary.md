> 현재 분야별 명세. 기존 implementation 23장 기준을 옮겼으며 구현 일지는 보관본으로 분리했다.
> [명세 목차](../../implementation.md) · [현재 상태](../STATUS.md) · [변경 전 원문](../archive/2026-09-21-p5-48/implementation.md#23-용어집)

## 23. 용어집

| 용어 | 짧은 설명 |
|---|---|
| 서버 채점 | 사용자의 브라우저가 아니라 `biblequiz-app`의 Hono API가 비공개 D1 정답으로 계산하는 것 |
| Worker 배포 단위 | Cloudflare에 독립적으로 올리는 프로그램 하나. 이 프로젝트에는 역할이 다른 `biblequiz-app`, `biblequiz-content`, `biblequiz-backup`이 있음 |
| `biblequiz-app` | 공개 React Static Assets와 `/api/*` Hono 서버를 함께 제공하는 메인 애플리케이션 Worker |
| Workers Static Assets | Vite의 HTML·JS·CSS·이미지·폰트를 Worker와 함께 배포하고 정적 요청에는 서버 코드를 실행하지 않는 CDN 기능 |
| `biblequiz-content` | 자막·OpenAI·퍼즐 생성 Workflow 전용 비공개 Worker. 공개 URL이나 일반 fetch endpoint가 없음 |
| `biblequiz-backup` | D1 export와 private R2 주간 백업 Workflow 전용 비공개 Worker. 공개 URL이 없음 |
| `CONTENT_WORKFLOW` binding | `biblequiz-app`이 공개 URL·API key 없이 `biblequiz-content`의 Workflow를 시작·조회하는 Cloudflare 계정 내부 연결 |
| Hono | `biblequiz-app` 안에서 `/api/*` route와 공통 middleware를 정리하는 작은 API framework |
| D1 | SQLite 문법을 쓰는 Cloudflare의 서버리스 관계형 DB |
| Drizzle ORM | D1 표·열과 서버 query의 TypeScript type을 연결하는 도구 |
| migration | DB 구조 변경을 순서대로 기록하고 적용하는 검토된 SQL 파일 |
| R2 | 이미지·백업 같은 파일 객체 저장소. 이 프로젝트에서는 공개 이미지가 아니라 D1 비공개 주간 백업 8개에만 사용 |
| KV | 빠른 key-value 저장·캐시. 제출·정답 DB가 아니며 v1 미사용 |
| Cloudflare Access | 허용된 관리자 이메일만 보호 경로로 들이는 앞단 로그인 장벽 |
| Cloudflare Workflows | 관리자가 시작한 자막·AI·격자 생성의 여러 단계를 브라우저 요청과 분리해 순서대로 실행·재시도하는 기능 |
| Preview | 실제 사이트에 공개하기 전 별도 주소와 가짜 데이터로 변경 결과를 확인하는 연습용 배포 |
| Production | 실제 교인에게 공개되는 사이트·API·데이터베이스 환경 |
| Vitest | 퍼즐 계산, 서버 API, D1, Workflow를 빠르게 자동 검사하는 테스트 도구 |
| Playwright | 실제 브라우저를 자동 조작해 입력·제출·정답보기·출력을 검사하는 도구 |
| Turnstile | 계정 없이 자동 봇 제출을 줄이는 CAPTCHA 대체 검증 |
| React SPA | 브라우저에서 화면 전환과 상호작용 전체를 React가 담당하는 단일 페이지 앱 구조 |
| Vite | React 개발 환경과 배포용 정적 파일 build를 담당하는 도구 |
| Scrim | 배경 이미지 위에 덮어 글자 대비를 높이는 반투명 어두운 막 |
| AVIF / WebP | JPEG보다 용량을 줄이기 좋은 웹 이미지 형식; fallback은 자동 제공 |
| D1 binding | Worker 코드가 특정 D1 DB를 `env.DB`처럼 사용할 수 있게 연결한 설정 |
| revision | 퍼즐의 불변 버전 번호. 첫 제출 뒤 수정이 필요하면 기존 번호를 고치지 않고 새 revision을 발행함 |
| featured quiz | 메인에 소개되는 퀴즈. 접수 가능한 active quiz와 다를 수 있으며 이전 퀴즈를 읽기 전용으로 보여줄 수 있음 |
| superseded | 첫 제출 후 오류가 확인되어 수정본으로 대체됐지만 기존 제출자의 당시 결과를 위해 보존하는 문제 버전 |
| idempotency key | 더블클릭·재시도 요청이 제출 두 건으로 저장되지 않게 하는 요청 ID |
| correctness mask | 정답 글자 대신 각 활성 셀의 맞음/틀림만 저장한 비트열 |
| 참여 현황판 | 같은 퀴즈를 제출한 사람만 들어가 이름과 실제 제출 답안을 제출 순서대로 보는 화면 |
| Top N | 모든 칸을 맞힌 참여자만 제출 시각순으로 N명까지 선정한 화면; 기본 N은 3 |
| source checksum | 가져온 성경·자막 원문이 바뀌지 않았는지 확인하는 SHA-256 지문 |

---

이 문서의 고정 원칙과 출시 게이트를 지키는 한, 세부 라이브러리 버전은 구현 시점의 공식 문서를 확인해 최신 안정 버전을 선택한다. 특히 Cloudflare 플랜, React/Vite 지원 범위, YouTube 정책, 성경 판본 라이선스는 시간이 지나며 달라질 수 있으므로 배포 직전에 다시 검증한다.
