# P5-24 누적 이력·쓰기 자원 경계

> 확인: 2026-09-12, Asia/Seoul. 합성 로컬 workerd 1.20260820.1·폐기용 D1.
> **유한한 로컬 adapter 수용 경계이며 무료 운영 가능 범위가 아니다.** 운영 연결은 닫혀 있다.

## 1. 결론과 플랫폼 차이

기존 P5-23의 append/CAS·무기록 충돌·원래 bound verified/seal·자기 attempt 판정을 유지한다. 누적 상한을 넘으면 `HISTORY_RESOURCE_LIMIT`만 던지고 DB에 기록하지 않는다. 원문·이력 절단, 자동 삭제, schema 변경, staging, 유료 서비스 추가는 없다. 기존 P5-23 완료 기록은 당시 검증 사실로 보존한다.

2026-09-12 읽기 전용으로 대조한 [D1 한도](https://developers.cloudflare.com/d1/platform/limits/)는 Free 호출당 50 queries, 행/string/BLOB 2,000,000 bytes, SQL 100,000 bytes, parameter 100개, batch 전체 30초다. [Workers 한도](https://developers.cloudflare.com/workers/platform/limits/)는 Free HTTP CPU 10ms, isolate 메모리 128MB다. 현재 adapter는 아래 16회 이력의 read만 72 queries이므로 무료 단일 호출에 연결할 수 없다. batch를 한 번 호출한다는 이유로 내부 145 statements를 무료 쿼리 하나로 계산하지 않는다.

로컬 wall time이나 프로세스 RSS는 청구 CPU·isolate heap이 아니다. 이번 상한으로 128MB/10ms 준수 또는 원격 SLA를 보증하지 않는다. 한도에 여유가 있는 SQL/행/parameter와 별개로 **무료 호출 수·CPU·isolate 메모리 적합성은 미통과**다. P5-25에서 호출 구조·측정 방법을 문서로 먼저 설계하고 운영 연결을 재검토한다.

## 2. 고정 로컬 수용 상한

[상한·사전 검사](../workers/_shared/storage/history-resource-limits.ts)는 호출자 조정 옵션 없이 고정한다. 모두 함께 만족해야 하며 각 최대값을 독립적으로 곱한 전체 조합의 실행 보증은 아니다. 유효 도메인 입력이어도 이 저장 adapter의 자원 경계 밖이면 저장을 거부한다. 도메인의 원문·후보 개수·보존 정책을 바꾸는 규칙이 아니다.

| 자원 | 상한 | 의미 |
|---|---:|---|
| 누적 commit | 64 | 공유 version, source는 import와 같은 commit |
| 누적 record | 128 | 8개 stream 합계 |
| 누적 payload | 8,388,608 bytes | 각 원소 JSON UTF-8 합계, escaping 포함 |
| 누적 chunk / reference | 256 / 2,048 | 현재와 새 delta를 합친 수 |
| 전체 입력 JSON | payload 상한 + 65,536 bytes | wrapper 여유, 전체 graph 복사 전 검사 |
| JSON node / depth | 100,000 / 64 | 객체·배열·primitive 방문 수와 깊이 |
| read SQL 호출 | 768 | read 한 번의 방어 상한. Free 허용 수가 아님 |
| 새 delta payload | 4,500,000 bytes | 실제 codec 결과의 합계 |
| 한 batch statement | 256 | claim부터 마지막 seal까지 |
| statement당 parameter / SQL | 80 / 80,000 bytes | 플랫폼 100/100,000보다 작게 고정 |
| statement당 bound 값 합계 | 131,072 bytes | row 헤더/부가 열을 위한 여유를 둔 보수적 행 예산 |
| batch bound 값 합계 | 10,485,760 bytes | INSERT와 verified에서 반복된 BLOB도 각각 계산 |
| batch transport 추정 상한 | 41,943,040 bytes | SQL·문자열 JSON escaping, BLOB 숫자 배열 최대 4 bytes/byte와 envelope 여유 |

마지막 transport 수치는 실제 HTTP 패킷 측정이 아닌 serializer에 대한 보수적 계산이다. row 수치도 D1 내부 행 헤더를 직접 측정한 크기가 아니라 모든 bound 값(조건 값 포함)을 센 상한이다. CPU나 heap을 데이터 byte로 환산해 보증하지 않는다.

## 3. 무기록 실패와 기존 원자성

- writer는 Zod·structuredClone·hash 전에 입력 graph·원소 byte/개수/chunk/version을 검사한다. accessor는 실행하지 않고 순환·비 JSON 입력은 기존 고정 invalid 오류로 닫는다. UTF-8/JSON escaping 계산은 큰 전체 JSON 문자열이나 버퍼를 새로 만들지 않는다.
- reader는 H0 version과 그 범위의 작은 commit 합계를 먼저 검사한다. 초과 시 private chunk를 읽지 않는다. 그 뒤 실제 manifest byte·chunk·record·reference 누적 수와 read 호출 수를 다시 제한해 작은 합계 선언을 믿고 무한히 읽지 않는다. H0/H1·전체 도메인 검증과 deep freeze는 그대로다. 각 read 호출이 독립 counter를 가진다.
- writer는 전체 참조 투영과 실제 인코딩 결과, 최종 SQL 계획의 statement/parameter/SQL/row/bound/wire를 검사한 **뒤에만** mutation statement를 prepare/bind하고 batch를 호출한다. 오류는 코드·고정 메시지만 가지며 원문/답/관리자/ID/hash/Zod/cause를 담지 않는다.
- batch 응답 유실은 기존 자기 attempt/commit/record/manifest/reference 증명을 유지한다. chunk 비교만 record별 4개씩 진행해 전체 큰 delta를 한꺼번에 두 숫자 배열로 펼치지 않는다. 끝의 추가 조각도 검사하며 모든 페이지가 일치해야 성공이다. 다른 호출의 head를 빌리거나 자동 replay하지 않는다.
- 사전 거부는 batch 0회와 head/commit/record/reference/payload/chunk 및 기존 공개·metadata 행의 exact snapshot 불변으로 검증한다. 실행 후 SQL/제약 오류와 결과 불확실성은 P5-23 rollback/`HISTORY_WRITE_UNCERTAIN` 경계를 유지한다. 플랫폼이 프로세스를 강제 종료하는 경우까지 JS 고정 오류 응답을 보증하지 않는다.

## 4. 유한 계측 행렬과 관측값

[합성 검사](../workers/app/sermon-history-resources.test.ts)와 [숫자 전용 reporter](../scripts/report-history-resources.mjs)를 사용한다. 같은 종류의 새 설교를 매번 준비해 3회 관측했다. 작은 행렬은 import 1개 + 반복 사람 확정, 혼합 행렬은 기존 도메인 명령의 8개 stream/모든 operation과 두 난이도를 사용한다. 각 행렬의 writer delta는 사람 확정 1개다. 별도로 큰 import 자체를 3회 쓴다. 무한 worst case·실제 콘텐츠가 아니다.

```sh
TMPDIR=/tmp TEMP=/tmp TMP=/tmp WRANGLER_LOG_PATH=/tmp/biblequiz-history.log pnpm exec vitest run --config vitest.worker.config.ts workers/app/sermon-history-resources.test.ts --reporter=default --reporter=./scripts/report-history-resources.mjs
```

| 기존 이력 | payload bytes | read queries | 전체 read ms | 별도 domain 검증 ms | writer 전체 ms | 준비·검증 등 잔여 ms |
|---|---:|---:|---:|---:|---:|---:|
| 1 commit | 804 | 12 | 20~25 | 0 | 30~61 | 2~5 |
| 16 commits | 5,439 | 72 | 107~125 | 0~1 | 131~157 | 10~13 |
| 32 commits | 10,383 | 137 | 212~285 | 0~1 | 285~308 | 14~24 |
| 63 commits → 64 | 19,962 | 261 | 450~679 | 0 | 471~545 | 32~44 |
| 혼합 35 commits | 25,467 | 152 | 231~272 | 1~2 | 264~285 | 21~31 |
| 큰 원문 1 commit | 4,195,072 | 28 | 801~813 | 15~16 | 878~915 | 678~695 |

혼합 stream별 개수는 source 2, revision 5, confirmation 2, proposal 2, decision 2, intent 5, summary 6, candidate 13이다. source를 제외한 합계가 version 35다. 작은 확정 delta의 batch는 13 statements, 최대 27 parameters/709 SQL bytes이고 batch는 2~9ms, own probe는 5~16ms/5 queries로 관측했다.

큰 import는 원문 따옴표 정확히 1,048,576 bytes, source/revision 두 원소 4,195,072 bytes·66 chunks다. batch 145 statements, 최대 31 parameters·954 SQL bytes·65,776 bound row bytes, 전체 bound 8,425,096 bytes·transport 추정 33,660,439 bytes다. 3회 전체 1,219~1,369ms, batch 447~581ms, own probe 159~170ms/22 queries, 전체 SELECT 27회였다. reader/probe의 chunk 결과는 한 번에 최대 4행이다.

전체 read는 I/O·decode·도메인 검증·동결을 포함한다. writer 잔여 시간은 전체에서 SELECT/batch/probe 대기를 뺀 값이며 schema·복사·encode·hash·JS 비교·스케줄링 등을 포함하고 순수 CPU가 아니다. 별도 domain 검증의 0ms는 시계 해상도 아래라는 뜻이며 비용 0이 아니다. 시간을 테스트 통과 임계값으로 고정하지 않는다.

메모리는 `/proc`에서 해당 실행의 자식 workerd 프로세스들만 50ms 간격으로 읽었다. 첫 34건 실행 463 samples/peak RSS 1,535,692,800 bytes/CPU tick 누계 16.54초, reporter 보완 뒤 실행 486 samples/peak RSS 1,591,050,240 bytes/17.17초였다. 이 두 관측은 fixture seed·테스트 harness·여러 isolate·SQLite·V8 native 메모리를 포함한 **프로세스 합계**이며 작업별 heap peak나 원격 청구 CPU가 아니다. GC 사이의 실제 순간 peak도 이 표본으로 확정할 수 없다. 128MB 안전성을 입증하지 못했으므로 운영 연결 게이트를 유지한다. 임시 원시 수치는 `/tmp/biblequiz-p5-24-process-metrics.json`, 숫자 계측 로그는 `/tmp/biblequiz-p5-24-resources.log`에 있으며 다음 세션에 없을 수 있다.

## 5. 경계 검사와 후속

정확한 8MiB 누적 payload를 저장·전체 재조회하고 다음 확정을 DB 접근 전 거부했다. version 64에서 65, 유효한 두 번째 큰 import의 8MiB 초과, 128개 교정 항목의 참조 많은 delta의 batch 상한 초과도 DB 불변이다. 조작된 commit 합계·manifest, 깊이/node, Unicode/escaping과 SQL/parameter/row/batch/bound/wire 경계를 검사한다. 기존 모든 P5-23 경쟁·실패/응답 유실 검사는 유지했다.

P5-25는 **무료 실행 예산에 맞춘 저장 호출 구조 설계 문서**만 대기 등록한다. 현재 reader 호출 수·전체 검증 CPU·isolate heap 측정, batch/own probe 예산, 서비스가 reader를 반복 호출하는 비용을 함께 검토한다. 무료안은 쿼리 운반·검증 단위 개선을 우선 비교하고, 기존 CAS·전체 이력·무기록 계약 변경이 필요하면 구현 전에 사용자에게 차이와 대안을 설명한다. 이번에 유료안/새 서비스를 선택하지 않는다. P5-12~15 최종 writer·metadata 두 revision, runtime/Workflow/UI/API, 새 schema/migration·운영 적용·콘텐츠·provider/network·모델/비용/secret·발행·cleanup·원격/배포/push/Production은 계속 제외다.
