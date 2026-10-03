# P5-27 Preview 격리 계측 — 2026-09-15

## 판정

**P5-27 진행 중, Free 운영 gate 미통과.** 실제 원격 220회를 실행하고 CPU 로그 220개를 모두 수집했다. CPU 목표 실패와 실행 중단을 확인했으므로 같은 계측을 그대로 반복하지 않는다. 기존 P5-23~P5-26 완료 기록과 제품 코드는 보존한다.

| 합성 입력 | invocation / CPU 표본 | 성공 응답 | CPU p95 / 최대 | `exceededCpu` | 응답에서 확인한 최대 query |
|---|---:|---:|---:|---:|---:|
| 전형, 23-byte 새 import | 100 / 100 | 100 | 28 / 49ms | 0 | 24 |
| 경계, 200,000-byte 새 import | 100 / 100 | 65 | 338 / 440ms | 35 | 34 |
| 같은 설교/version 동시 20개 | 20 / 20 | 1 | 348 / 394ms | 11 | 34 |

목표는 query≤40, CPU p95≤7ms/max≤9ms, isolate peak≤96MiB다. 동시 20개 중 나머지는 명시적 version 충돌 4건, probe의 일반 실패 HTTP 500 4건, CPU 초과 11건이다. 마지막 일반 실패 4건의 세부 원인은 원문/내부 오류를 수집하지 않아 확정하지 않았다. CPU 초과 등 중단된 50건에서는 query/operation counter를 받지 못했으므로 `≤34`를 220건 전체의 실측 최대라고 쓰지 않는다. counter가 있는 170건은 operation read 1, replay 0이고 로컬 runner는 220건 모두 자동 재시도 0이다.

원격 isolate peak는 **미측정**이다. 20개의 겹치는 invocation을 실행했지만 동일 isolate 배치나 peak 96MiB를 보장하는 자료는 없다. Workers 메모리 Analytics의 P50/P90/P99/P999는 호출 시 공유 isolate 메모리 표본이며 정확한 순간 peak의 대체물이 아니다. [Cloudflare Metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/#memory-usage)

## 계측 방법과 한계

- 시각: 2026-09-15 16:39:45.239~16:41:38.134 KST, 전체 호출 약 112.9초.
- 대상: 기존 Access 보호 `biblequiz-app-preview`; version `9af053ef-c73d-41d6-876b-122fefd20796`; 임시 D1 `biblequiz-d1-p5-27-20260915` (APAC/HKG, 삭제 완료).
- `scripts/p5-27-run-probe.mjs`가 로컬 중계기의 `/leaf`로 전형 100회·경계 100회를 순차 호출하고 동시 20회를 `Promise.all`로 보낸다. 요청당 원격 대상 Worker 호출은 한 번이다. 실험 시작 전에 합성 sermon 201개와 head 0을 검사하며 실패를 재실행하지 않는다.
- 이전 원격 master→group→leaf 연쇄와 SELF binding·scheduled handler를 제거했다. 서비스 binding은 요청당 최대 32 Worker invocation이므로 전체 suite를 한 원격 요청 안에서 돌릴 수 없었다. 지난 Cron 미실행의 원인으로 단정하지는 않는다. [공식 서비스 호출 한도](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/#limits)
- 표본은 빈 이력에 새 source/revision을 넣는 import다. 모든 누적 이력·8개 stream·정확한 최대 1MiB 입력의 원격 성능 검사를 완료한 것은 아니다. 같은 배포·자연 발생 cold 요청·실패 요청을 모두 포함하고 느린 표본을 빼지 않았다. p95는 오름차순 표본의 `ceil(N×0.95)`번째다.
- CPU는 `wrangler tail --format json`의 `cpuTime`이며 wall time이나 로컬 CPU를 대용하지 않았다. 준비 payload 생성과 계측 wrapper 비용도 포함한다. 요청 중계·CPU rollover 영향 때문에 `exceededCpu`가 정확히 10ms에서 항상 발생한다고 해석하지 않는다. 현재 표본만으로 제품 저장 코드의 순수 CPU 기여율이나 모든 사용자 입력의 성능을 확정할 수 없다. [CPU 지표 설명](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/#cpu-time-per-execution)
- `scripts/p5-27-capture-tail.mjs`는 request header·접속 정보·원문·hash·관리자·예외 메시지를 버리고 숫자·version·합성 profile/index만 남겼다. 고유 `(profile,index)` 220개, 누락/중복/truncated 0이다. 재계산 가능한 [숫자별 근거](P5-27_PREVIEW_MEASUREMENT.json)를 보존한다.

## 저장 의미와 중단 뒤 상태

- 동시 대상의 최종 commit/record/payload/chunk/reference/head는 `[1,2,2,8,1,1]`이다. 단일 승자의 완전한 이력만 남았다.
- 모든 commit은 sealed였고 `foreign_key_check` 0행, `quick_check=ok`였다.
- 전형 head 100개, 경계 head 69개를 확인했다. 경계 성공 응답은 65개이므로 CPU 초과 요청 중 4개는 DB commit 뒤 응답 완료 전에 종료됐다. 무응답을 미기록으로 단정하거나 새 attempt로 자동 replay해서는 안 된다.
- 기존 의미 회귀는 별도 F25-01~04 28건과 전체 저장소 검사로 확인한다. 원격 CPU 강제 종료는 로컬 회귀 통과와 별도로 runtime 연결을 막는 사유다.

## 기존 0008 migration 문제의 범위

정본 SQL은 그대로다. 로컬 SQLite와 설치된 Wrangler splitter 모두 34 statements를 정상 처리한다. 새 임시 D1의 표준 `migrations apply`는 0008에서 `incomplete input`으로 전체 rollback됐고 관련 schema 객체 0을 확인했다. 문장별 `--command` 적용에서는 앞의 33개가 성공하고 마지막 `history_seal_guard` 하나에서 같은 오류가 재현됐다. 이 마지막 SQL을 원문 그대로 파일로 전달한 `--file`은 성공해 6 tables·8 indexes·20 triggers와 무결성을 확인했다.

따라서 문제를 원격 query 실행 경로의 마지막 복합 trigger 처리로 좁혔지만 Cloudflare 내부 parser 원인까지 확정하지 않았다. 파일 적용 뒤 보조 스크립트가 Wrangler의 진행 출력 때문에 JSON parsing 오류를 냈으나 DB 조회로 trigger 설치 성공을 확인했으며 재적용하지 않았다. 문장별 직접 적용은 migration ledger의 0008 완료와 동치가 아니다. 공유 Preview 0007/0008은 여전히 미적용이다. 운영 적용 전 별도의 정식 migration 실행/ledger 검증이 필요하다.

## 원복·삭제·권한

- 기존 version `fc10f77d-ca54-4dfd-a94a-9fb3cffcf482`를 원본 `wrangler.jsonc --env preview` 설정으로 100% 복구했다. 원래 공유 D1 ID `cb044032-7e26-452b-afae-b0cae3d93678`, 내부 health 200, 비인증 Access 302를 확인했다.
- 이번에는 Cron·Access 정책·secret·domain을 변경하지 않았다. 계측 version은 비활성 이력으로 남고 Preview URL은 없다.
- 합성 데이터 201개와 계측 이력만 있던 임시 D1 `5b4754eb-d4ee-4b52-ab69-f61c5dae8e40`는 **영구 삭제**했다. 복구할 수 없다. DB 목록에 기존 공유 Preview 하나만 남고 0007/0008 대기 상태도 그대로다.
- 저장된 OAuth 토큰을 직접 읽는 보조 API 조회는 자동 승인 심사에서 거절돼 실행하지 않았고 해당 보조 코드는 폐기했다. CPU는 표준 Wrangler 로그로 수집했다. 원격 메모리 계측은 확보하지 못했다.
- Production·실제 콘텐츠·공유 DB 쓰기·새 schema/migration·전체 runtime/Workflow/UI/API·checkpoint/staging/Paid·새 영구 서비스·commit/push는 수행하지 않았다.

## 다음 판단

검사: 배포 전 F25-01~04 Worker 28건·lint·typecheck·dry-run, 종료 `pnpm check` exit 0(unit 262건, Worker 1,106건, 정적 검사·격리 fixture·production build). UI/runtime 변화가 없어 E2E 목록·실제 E2E는 미실행이다. 시작 283개 중 의도한 6개만 변경했고 나머지 277개 SHA-256 동일·삭제 0개다.

P5-27은 CPU 실패와 메모리 미측정 때문에 완료하지 않는다. 우선 현재 코드의 CPU 병목과 4개 probe 일반 실패를 로컬 profiler로 좁히는 후속이 적절하다. 임시 측정 wrapper와 저장 코드의 비용을 분리해 확인한 뒤 schema 없는 개선으로 목표를 달성할 수 있는지 판단한다. checkpoint는 이력 길이 비용을 줄일 대안이지만 이번 빈 이력 import의 큰 입력 비용까지 자동 해결하지 않으므로, 이것만으로 통과를 약속하지 않는다. checkpoint/staging/Paid·입력 계약 변경은 여전히 미채택이며 필요하면 구체적인 비용·정책 영향을 먼저 사용자에게 제시한다.
