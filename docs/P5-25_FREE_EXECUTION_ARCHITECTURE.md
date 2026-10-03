# P5-25 무료 실행 예산에 맞춘 저장 호출 구조 설계

> 확인: 2026-09-12, Asia/Seoul. 문서 전용 설계이며 코드·schema/migration·runtime·운영 연결을 바꾸지 않는다.
> **결론: 현 adapter의 운영 연결은 계속 닫는다. 전체 불변 이력과 단일 batch CAS를 보존하면서, 현재 투영 checkpoint와 호출/statement packing을 도입하는 안을 우선 추천한다. 채택과 구현은 사용자 결정 및 후속 격리 검증 뒤다.**

## 1. 범위와 보존 경계

이 문서는 [P5-24 자원 경계](P5-24_RESOURCE_ENVELOPE.md)에서 확인한 Free 미통과를 실제 runtime 연결 전에 해소할 구조를 비교한다. P5-23의 append-only 이력, 같은 expected version 경쟁의 단일 승자, 패자의 무기록, 원래 bound 값 검증, 마지막 seal, 자기 attempt 판정과 P5-24의 유한 로컬 상한은 그대로 보존한다.

이번 작업이 하지 않은 것:

- 코드·테스트·schema/migration·D1 데이터·runtime/Workflow/UI/API 변경
- 개발·Preview·Production 연결, 외부 서비스, secret, 실제 콘텐츠, AI 호출, 발행, cleanup
- 기존 1MiB 수동 원문 계약 축소, 과거 이력 절단·삭제·압축·deduplication
- checkpoint/staging/영수증 표 채택, 유료 플랜 선택, 배포·commit·push

따라서 아래의 `권장`은 구현 승인이나 운영 적합성 통과가 아니다. 특히 현재 `createSermonHistoryStore`를 route나 Workflow에 연결하면 안 된다.

## 2. 2026-09-12 공식 플랫폼 기준

| 항목 | Free 기준 | 이 설계의 해석 |
|---|---:|---|
| D1 queries / Worker invocation | 50 | `db.batch()` 호출 횟수가 아니라 그 안의 각 statement까지 query budget으로 보수적으로 센다. 원격 계측 전에는 이보다 느슨하게 계산하지 않는다. |
| D1 행·string·BLOB | 2,000,000 bytes | 현 65,536-byte chunk는 개별 BLOB 한도 안이지만 호출 전체 CPU/메모리 적합성을 뜻하지 않는다. |
| SQL / bound parameter | statement당 100,000 bytes / 100개 | P5-24의 80,000 bytes / 80개 내부 상한을 유지한다. |
| Workers HTTP·Cron CPU | invocation당 10ms | D1 대기 시간은 CPU에 포함되지 않지만 JSON/Zod/복사/encode/hash/도메인 검증은 포함될 수 있다. 로컬 wall time으로 통과를 주장하지 않는다. |
| Workers isolate memory | 128MB | 호출별 한도가 아니라 isolate 전체 한도다. 동시 요청과 여러 살아 있는 객체를 함께 검수해야 한다. |
| Workflows Free compute | step당 10ms | step을 나누면 CPU 경계는 나뉘지만 D1 원자성이나 큰 state 전달 문제가 자동 해결되지는 않는다. |
| Workflows event / 일반 step result / instance state | 1MiB / 1MiB / 100MB | 현재 1MiB 원문은 envelope를 더하면 event·일반 결과 한도를 넘을 수 있다. streamed result 가능성은 별도 spike 없이는 채택하지 않는다. |
| Workflows steps / storage | 3,000 steps/day / 1GB-month Free | 예상 주간 1회 운영에는 여유가 커 보이지만 실제 재시도·사람 대기·state byte를 계측하기 전 USD 0을 보증하지 않는다. |
| D1 일일 rows / storage | read 5,000,000, write 100,000 / 5GB | 호출당 50-query와 별도다. 2026-09-01부터 Free 일일 row 한도 초과 시 query가 실패하므로 운영 계측 항목에 포함한다. |

근거: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 batch 계약](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/), [Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/), [Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/). 가격·한도는 바뀔 수 있으므로 실제 연결 직전에 다시 확인한다.

Cloudflare 문서는 batch의 각 statement에 개별 query 한도가 적용된다고 명시하지만 `50` 집계 예시를 별도로 제공하지 않는다. 이 프로젝트는 P5-24부터 안전한 쪽으로 각 statement를 한 query로 계산하며, P5-26 원격 계측에서도 이 전제를 완화하지 않는다.

## 3. 현재 구현의 비용 분해

### 3.1 read가 이력 길이에 비례한다

[현재 reader](../workers/_shared/repositories/sermon-history-reader.ts)는 H0, 합계, integrity, commit page를 읽고 commit마다 record를, record마다 manifest·chunk page·reference page를 읽은 뒤 H1을 다시 읽는다. 페이지는 완전성에 필요하지만 query 구조가 record 수에 비례한다.

P5-24 관측값은 1/16/32/63 commits에서 각각 12/72/137/261 read queries다. 가장 작은 16회 이력부터 Free 50을 넘는다. chunk page를 4개로 제한한 것은 peak 배열을 줄이지만 query 수를 늘리는 trade-off다.

### 3.2 한 명령에서 전체 검증이 반복된다

현재 서비스의 `execute()`는 먼저 `store.read()`를 호출한다. D1 writer의 `compareAndSwap()`은 같은 이력을 다시 전체 read하고 `readHead()`와 `readEnvelopes()`를 추가 호출한다. reader가 저장/도메인 검증을 마친 state를 서비스의 `readState()`가 다시 도메인 검증하는 경로도 있다. 이는 임의 store port에서도 안전한 현재 계약이지만 Free runtime에서는 query와 CPU를 반복한다.

### 3.3 write batch와 결과 probe도 statement/query를 사용한다

작은 사람 확정 delta는 13 batch statements이고 own-attempt probe는 5 queries였다. 정확히 1MiB 따옴표 원문 import는 source/revision 두 record 합계 4,195,072 encoded bytes·66 chunks, 145 batch statements, probe 22 queries였다. 단일 transaction이어도 Free의 50-query 예산 안에 들어오지 않는다.

현재 구조의 보수적 한 호출 비용은 다음처럼 센다.

```text
service read + writer full read + writer head/envelope read
+ atomic batch statements + own-attempt probe queries
```

따라서 `batch()` round trip을 한 번으로 줄이는 것만으로는 해결되지 않는다.

### 3.4 CPU와 메모리는 query packing만으로 해결되지 않는다

큰 원문의 별도 domain 검증 wall time만 로컬에서 15~16ms였고 전체 writer는 878~915ms였다. 이는 청구 CPU가 아니므로 실패 증명도 성공 증명도 아니지만, 10ms Free CPU를 낙관할 근거가 없다. D1 BLOB가 number array로 반환되고 Uint8Array·decoded JSON·strict state·next snapshot이 동시에 살아 있으면 encoded byte보다 실제 heap이 훨씬 커질 수 있다.

## 4. 대안 비교

| 안 | 전체 이력·CAS | Free 가능성 | 비용·위험 | 판정 |
|---|---|---|---|---|
| A. 현재 표에서 query/statement만 packing | 매 명령의 전체 이력 재검증과 단일 batch CAS 유지 | 작은/짧은 이력은 가능성 있음 | CPU·heap이 이력에 비례하고 1MiB 최대 입력은 미해결 | P5-26의 가장 작은 선행 spike. 일반 운영안으로는 부족 |
| B. 불변 이력 + 원자적으로 봉인한 현재 projection/checkpoint | 원본 이력과 CAS는 보존. 명령 경로는 직전 checkpoint와 새 delta를 검증하고 전체 replay는 별도 audit로 이동 | query/CPU가 이력 길이보다 delta에 가까워져 가장 유리 | 새 private schema/migration·projection 불변식·audit/복구 계약 필요. “매 read 전체 replay” 계약 변경 | **권장안. 사용자 승인 전 미채택** |
| C. Workflow step만 여러 개로 분할 | D1 이력 구조는 유지 가능 | step별 10ms로 CPU를 나눌 수 있음 | 1MiB event/result, 상태 전달, 마지막 50-query CAS가 남는다. 단독 해결책 아님 | B의 큰 입력 준비·audit 보조로만 검토 |
| D. D1 staging으로 큰 입력을 여러 호출에서 준비 | 최종 domain commit은 한 batch CAS로 유지 가능 | 1MiB 입력/encode/hash를 나눌 여지가 있음 | 임시 byte 수명주기·입력 hash·권한·expiry·cleanup·충돌 시 staging 잔존 계약과 새 schema 필요 | 최대 입력 지원이 실제로 필요할 때 별도 승인 |
| E. Workers Paid | 현재 query/CPU 한도 문제를 크게 완화 | 1,000 D1 queries·기본 30초 CPU | 계정당 월 최소 USD 5, 128MB memory는 동일, 비효율은 남음 | 무료안 실패 때만 사용자 승인으로 전환 |

R2/KV/외부 DB를 새 정본으로 추가하는 안은 이번 범위에서 비교 우선순위가 아니다. 새 서비스와 이중 정본·복구 계약을 만들며 현재 D1 CAS보다 단순하지 않다.

## 5. 권장 목표 구조

아래는 B를 기준으로 한 목표이며 구현하지 않았다.

```text
인증된 관리자 명령
  → runtime admission preflight
  → 현재 sealed head + sealed projection/checkpoint + 명령에 필요한 exact 과거 record만 읽기
  → 한 번의 strict 도메인 검증/전이
  → 새 delta만 encode·참조 투영
  → 같은 D1 batch
       attempt claim(expected head)
       + grouped immutable record/payload/chunk/reference append
       + projection/checkpoint 교체
       + head 이동
       + 마지막 seal
  → 같은 logical operation ID로 bounded own-attempt probe

별도 감사 경로
  → H0 고정
  → 전체 불변 이력을 여러 bounded step에서 재생·검증
  → H1 대조
  → 성공/손상 보고만 기록
  → 자동 수선·삭제·발행 없음
```

### 5.1 operation-scoped 검증 handle

runtime coordinator는 저장소 read와 도메인 명령을 한 operation으로 묶는다. reader가 만든 handle은 같은 invocation 안에서만 쓰는 opaque 객체로, sermon/head/version/현재 포인터·필요 record·검증 완료 projection을 포함하고 직렬화·클라이언트 반환하지 않는다. writer는 handle과 next의 단일 delta를 비교하고 batch claim이 expected head를 다시 검사한다.

이렇게 하면 서비스 read 뒤 writer 전체 read, 별도 head/envelope read를 없앨 수 있다. stale 경쟁은 batch claim 0행과 패자 전체 무기록으로 계속 판정한다. handle을 다른 invocation에서 재사용하거나 checksum만으로 진위를 대신하지 않는다.

현재 범용 `TranscriptRevisionStore` port와 테스트 double은 유지할 수 있지만, D1 runtime 경로에는 별도 coordinator/port가 필요하다. 이 내부 계약 변경은 P5-26에서 사용자 승인 후 설계·검증한다.

### 5.2 projection/checkpoint의 책임

checkpoint는 공개 snapshot이나 이력 대체물이 아니다. 같은 설교/version의 sealed head에 귀속된 비공개 파생 상태로 다음만 제공한다.

- 8개 stream 누적 개수와 현재 source/revision/confirmation
- 현재 확정 의도·요약·난이도별 pool/review 등 다음 명령에 필요한 현재 투영
- 투영이 참조하는 exact record/member와 직전 checkpoint/commit hash 연결
- 저장 format/contract version과 projection payload hash

새 delta와 checkpoint는 commit/head와 같은 batch에서 원래 bound 값으로 검증·봉인한다. batch 어느 단계든 실패하면 모두 rollback한다. checkpoint가 없거나 head/version/hash/참조가 다르면 부분 성공이나 legacy 추측 없이 닫는다.

과거 source/revision 복원처럼 역사 자료가 필요한 명령은 사용자가 지정한 exact record와 그 참조만 추가로 읽는다. 존재한다는 이유만으로 현재 자격을 복구하지 않고 현재 checkpoint binding과 기존 도메인 규칙을 함께 검증한다.

전체 record/chunk/reference는 삭제하지 않는다. 별도 전체 audit는 P5-22 수준의 H0/H1·codec/checksum·참조·도메인 재생을 유지한다. 다만 매 명령마다 전체 audit를 하는 현재 계약을 “원자적으로 봉인한 직전 checkpoint + delta 검증”으로 바꾸는 점은 명시적 사용자 결정이 필요하다.

### 5.3 query transport와 mutation packing

checkpoint 채택 여부와 무관하게 P5-26은 다음 packing을 먼저 격리 검증한다.

- read는 `meta preflight`와 `bounded data` 두 묶음으로 제한한다. H0/설교 존재/합계/integrity를 먼저 읽고, H0 범위의 commit·record+manifest·chunk·reference를 설교/version 조건으로 묶어 record별 N+1 query를 없앤다. H1은 같은 primary 경계에서 다시 읽는다.
- D1 read replication은 사용하지 않는다. Sessions를 채택하려면 first-primary와 H0/H1 의미를 별도로 검증한다.
- write는 100 parameter보다 작은 고정 group으로 multi-row INSERT와 exact verified UPDATE를 만든다. trigger는 각 row에 계속 적용하고 마지막 seal guard가 실제 DB count/길이/verified/참조를 계산한다.
- SQL 문자열에 payload를 넣지 않고 bind한다. P5-24의 statement당 80 parameters·80KB SQL·128KiB bound 값을 넘지 않는다.
- own probe는 commit, delta envelope/manifest, bounded chunk page, reference를 자기 logical operation/attempt로만 확인한다. 최신 head나 다른 attempt의 성공을 빌리지 않는다.

### 5.4 큰 1MiB 입력

기존 `manualTranscriptMaxBytes=1_048_576`은 유지한다. 그러나 현재 최악 escaping fixture는 source/revision 두 record가 4,195,072 bytes가 되므로 아래 중 하나의 실측·결정 없이는 Free runtime에서 지원한다고 표시하지 않는다.

1. streaming encode와 `crypto.DigestStream("SHA-256")`, grouped batch만으로 CPU/heap/query budget을 만족하는지 먼저 격리·원격 측정한다.
2. 실패하면 같은 D1의 private staging에서 인증된 logical operation의 byte를 bounded 호출로 준비하고 최종 domain batch가 복사·검증·seal하도록 별도 설계한다. staging은 domain 이력이 아니며 expiry/cleanup/입력 hash/다른 명령 재사용 금지와 orphan 관측이 필요하다.
3. staging 없이 1MiB 계약을 줄이려면 제품 계약 변경이므로 사용자 승인이 필요하다.
4. 무료안이 안전하지 않으면 월 최소 USD 5 Workers Paid를 대안으로 다시 제시한다. Paid도 128MB memory 검수는 면제하지 않는다.

## 6. 고정 호출·자원 예산

Free hard limit 50을 끝까지 쓰지 않고 **invocation당 D1 query 40개**를 프로젝트 상한으로 잡는다. 남은 10개는 예측하지 못한 플랫폼/인증·진단 확장이 아니라 실패 여유이며 정상 경로가 사용하면 안 된다.

| 구간 | 최악 예산 | 규칙 |
|---|---:|---|
| 권위 있는 read/preflight | 7 queries | H0/meta 2, bounded projection/data 4, H1 1. record별 query 금지 |
| job/operation receipt | 3 queries | 필요 시 logical operation 입력 대조·상태 확인. domain version과 분리 |
| 원자 mutation batch | 24 statements | claim·grouped child/verified·projection/head·seal 전체 포함. 넘으면 batch 호출 전 거부 |
| own-attempt probe | 6 queries | 성공/충돌/미확정 판정. 자동 replay 없이 같은 operation ID만 확인 |
| 합계 | **40 queries** | 같은 invocation 안의 재시도 0회 |

single-invocation fast path의 임시 byte 예산은 P5-26 검증 시작점으로만 사용한다.

| 자원 | 설계 시작 상한 |
|---|---:|
| 새 encoded delta | 524,288 bytes |
| 새 chunks / references | 16 / 48 |
| batch bound / transport 추정 | 2MiB / 8MiB |
| 한 번에 살아 있는 decoded+encoded+DB result 추적값 | 32MiB |
| 전체 isolate 목표 | 단일 작업 64MiB 이하, 동시 검수 추정 96MiB 이하 |

이 byte 예산은 기존 P5-24 로컬 수용 상한이나 도메인 입력 상한을 조용히 낮추지 않는다. 초과는 큰 입력 경로가 구현·검증되기 전 runtime 미지원이며, 사용자가 볼 오류/재시도 정책은 후속 UI/API 범위다.

CPU 통과 기준은 실제 Preview와 같은 Free 환경의 Workers Logs/trace에서 정한다. 전형·경계 fixture 각각 최소 100회 실행해 p95 7ms 이하, 최대 9ms 이하, `exceededCpu` 0건을 요구한다. wall time을 CPU로 쓰지 않는다. 최초 메모리 계획은 DevTools와20개 동시 invocation의 원격peak96MiB/초과0건이었다. **2026-09-16 D-032 사용자 승인으로 원격peak직접증명은 로컬 동일isolate20개 동시 상세관측+원격메모리지표/초과오류 확인으로 대체한다.** 96MiB 여유예산과초과0건은유지하며 서로다른지표를동일peak로표현하지않는다. 수집불가는미확인이다. 현재 세부기준은 [implementation 메모리 검증](../implementation.md#p5-27-메모리-검증-방법-변경--2026-09-16-d-032)을 따른다.

## 7. 실패·경쟁·재시도 기준

- admission/query/statement/byte 예산 초과는 mutation 전 고정 private 오류이며 DB domain 이력은 0행이다.
- 같은 expected version 경쟁은 한 batch claim만 이기고 패자는 commit/record/payload/chunk/reference/projection/head/receipt의 domain 변경을 남기지 않는다.
- SQL/제약/seal 실패는 전체 batch rollback이다. JS가 batch 뒤 throw한 것을 rollback 근거로 쓰지 않는다.
- 정상 결과가 없으면 같은 logical operation ID와 입력 hash로 own-attempt probe만 수행한다. probe가 불가능하면 uncertain으로 닫고 같은 invocation에서 새 attempt를 만들지 않는다.
- Workflow 재시도는 저장된 operation/step 영수증과 원래 입력을 대조한 뒤 별도 invocation에서 한다. 사람 명령을 새 UUID로 자동 재실행하지 않는다.
- checkpoint mismatch나 전체 audit 손상은 자동 재구축·삭제·발행으로 고치지 않는다. 운영자에게 비공개 고정 코드로 중단 상태를 제공한다.
- 로그/metric에는 operation 종류, version, query/statement/row/byte 수, CPU/wall/outcome만 허용한다. 원문·답·단서·관리자 ID·hash·D1 메시지·Zod issue/cause를 넣지 않는다.

## 8. P5-26 검증 행렬과 결정 게이트

P5-26은 구현 연결이 아니라 **대안 결정과 격리 spike**로 시작해야 한다. 사용자 승인 전 checkpoint/staging schema를 만들지 않는다.

| ID | 검증 | 통과 기준 |
|---|---|---|
| F25-01 packed read | 1/16/32/64 commit, 8 stream, chunk/reference 경계 | H0/H1·전체 state 의미가 P5-22와 동일, 7 queries 이하, 손상/혼합 성공 없음 |
| F25-02 operation handle | 서비스 read→단일 delta→CAS 경쟁 | 전체 read/도메인 검증 1회, 같은 expected 단일 승자·패자 모든 domain 행 0 |
| F25-03 grouped mutation | 작은/경계 chunk·reference와 각 단계 0행/SQL 오류 | 24 statements 이하, 원래 bound verified/seal, 전체 rollback |
| F25-04 bounded probe | 성공 응답 유실·후속 commit·probe 오류 | 6 queries 이하, 자기 성공만 복구, 불명확은 uncertain |
| F25-05 checkpoint option | 현재 projection·exact 과거 restore·상위 변경 | 전체 이력 보존, stale/ABA 차단, checkpoint 손상 fail-closed. 이 검사는 채택 승인 뒤 |
| F25-06 1MiB 최대 입력 | plain/따옴표/Unicode, streaming hash/encode | 원문 무변형·두 record/참조 재현, query/CPU/heap 예산. 실패 시 staging 또는 Paid 결정으로 이동 |
| F25-07 Free 원격 계측 | 전형/경계 100회·20 동시 | query≤40, CPU p95≤7ms/max≤9ms, D-032 로컬/원격 분리 메모리 검증·96MiB 여유예산, resource 초과 0 |
| F25-08 일일 비용 | 예상 주간 운영+실패 재시도 | D1 read 5M/day·write 100k/day, Workflow 3,000 steps/day·1GB-month 안. USD 0 대시보드 확인 |
| F25-09 비공개/build | 오류·로그·client/Worker bundle | 원문/답/관리자/hash/cause 누출 0, public runtime에 private helper 우발 import 없음 |

결정 순서:

1. schema 변경 없는 A의 packed read/write/handle로 전형 범위를 먼저 측정한다.
2. 전체 replay가 CPU/heap 기준을 못 맞추거나 이력 증가에 따라 여유가 사라지면 B checkpoint를 사용자에게 승인 요청한다.
3. 1MiB 최대 입력만 실패하면 D staging과 입력 상한 변경을 각각 비용·제품 영향과 함께 비교한다.
4. 무료 구조가 여전히 실패하면 Workers Paid 월 최소 USD 5를 제시한다. 승인 전 결제·설정 변경은 없다.
5. 어떤 안도 Preview 격리 검증과 실제 로그/metric을 통과하기 전 runtime/운영 연결·발행을 열지 않는다.

## 9. 완료 판정과 남은 사용자 결정

P5-25는 현재 호출 비용, 공식 Free 한도, 네 무료/저비용 대안, 권장 checkpoint 구조, 40-query/CPU/memory 예산, 실패·경쟁 기준과 후속 검증 행렬을 문서화해 완료한다. 설계 문서 완료는 Free 운영 적합성 통과가 아니다.

다음 `P5-26` 시작 전 필요한 결정은 다음과 같다.

- 우선 A의 schema 없는 packing spike만 허용할지
- A가 미통과할 때 B의 private checkpoint schema/migration 설계·격리 검증까지 허용할지
- 1MiB 최대 입력이 미통과할 때 D1 staging, 입력 계약 변경, 월 USD 5 Paid 중 무엇을 비교·채택할지

사용자 결정 전 기본값은 **A의 격리 spike만 허용, B/D/E 미채택, runtime 연결 계속 금지**다.
