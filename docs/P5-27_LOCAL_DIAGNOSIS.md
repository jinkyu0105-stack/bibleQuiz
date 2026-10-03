# P5-27 로컬 CPU·일반 실패 진단 — 2026-09-15

## 결론과 범위

**로컬 진단 완료, P5-27/Phase 5 진행 중.** 원격 CPU 실패는 그대로이며 원격 isolate peak는 미측정이다. 이번에는 배포·원격 설정/DB 조회·migration·실제 콘텐츠를 사용하지 않았다. 기존 제품 저장 코드·schema·P5-23~P5-26 기록과 원격 220개 표본을 보존했다. 아래 결과는 성능 개선 구현이나 Free 통과가 아니다.

- 큰 새 import의 주요 비용은 계측용 JSON 로그가 아니라 `own-attempt` 결과 대조의 범용 객체 재귀 비교·기대 BLOB 숫자 배열 생성, D1 내부 전송 처리다.
- 저장된 큰 이력 읽기는 BLOB의 숫자 원소별 Zod 검사와 packed cache 복사가 별도 병목이다. 빈 이력 import 병목과 누적 이력 병목을 구분해야 한다.
- H0(읽기 시작)와 H1(읽기 끝) 사이 다른 요청의 commit을 주입하면 `HISTORY_READ_CHANGED`가 **쓰기 전에** 발생한다. 기존 계측기는 이 오류도 일반 HTTP 500으로 숨긴다. 과거 원격 일반 실패 4건의 원인으로 가능한 경로를 재현했지만 과거 4건 모두의 원인이라고 확정하지 않았다.

## 방법과 재현

[로컬 Worker](../workers/app/p5-27-local-diagnostic.ts), [runner](../scripts/p5-27-profile-local.mjs), [진단 회귀](../workers/app/p5-27-local-diagnostic.test.ts), [숫자·함수별 표본 근거](P5-27_LOCAL_DIAGNOSIS.json)를 추가했다. 설치된 Wrangler의 Miniflare 5 호환 변환기와 esbuild만 사용하며 의존성을 추가하지 않았다.

```sh
node scripts/p5-27-profile-local.mjs /tmp/p527-local-profile-UNUSED-DIRECTORY
```

출력 경로는 존재하지 않는 절대 경로여야 한다. 로컬 검사 서버 권한이 필요할 수 있다. 새 합성 D1에 기존 0000~0008 SQL을 재생하며 영구/원격 DB와 연결하지 않는다. Worker 외부 fetch는 차단하고, 원격 계측 probe의 원문 경로를 `baseline`으로 재사용한다. 별도 `operation`은 같은 read/payload/execute와 DB batch의 wall time만 기록한다. 모두 같은 로컬 workerd isolate이며 마지막에 Worker·검사 포트·임시 DB를 dispose한다. 배포용 Wrangler 설정은 추가하지 않는다.

DevTools Protocol `Profiler`를 1,000μs 간격으로 수집했다. [Cloudflare CPU profiling 안내](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/)에 따른 함수 위치 진단이며, **self sample 수는 CPU 밀리초나 원격 청구 비율이 아니다**. idle/GC/미분류 표본도 제외하지 않는다. source map으로 익명 callback을 실제 코드 위치와 연결했다. 프로필은 순서대로 수집해 JIT/GC 이력을 공유하며 전형 10회는 작은 비용의 정밀 p95를 재는 표본이 아니다.

실행 행렬: wrapper만 30회, 200,000-byte payload 준비만 30회, 원문 baseline 전형/경계 각 10회, 구간별 operation 전형/경계 각 10회, 저장된 경계 이력 read 10회(각각 별도 사전 import), 강제 H0/H1 경쟁 4회, 자연 동시 20회. 정상 경로 실패 0, 강제 경쟁은 예상된 안전 중단 4/4다. 원문 원격 표본 100/100/20을 대체하지 않는다.

## CPU 위치

아래 비율은 각 프로필의 **전체 self sample 수에 대한 비율**이며 서로 겹치지 않는 함수 위치만 합산했다.

| 구간 | 표본 | 확인한 집중 위치 |
|---|---:|---|
| 원문 경계 import 10회 | 856 | `sameHistoryValue`+callback 351(41.0%), 기대 BLOB 배열 생성 74(8.6%), D1 내부 252(29.4%), GC 46(5.4%) |
| 구간별 경계 import 10회 | 732 | 같은 비교 319(43.6%), 기대 배열 58(7.9%), D1 내부 198(27.0%), GC 36(4.9%) |
| 저장된 경계 read 10회 | 1,296 | Zod run/check/array parse의 주요 3개 함수만 735(56.7%), reader 146(11.3%), cache `structuredClone` 90(6.9%) |
| wrapper만 / payload만 각 30회 | 9 / 25 | 큰 import의 지배적인 비용이 이 두 구간이라는 근거는 없음. 비용 0이라는 뜻은 아님 |

근거 코드: [범용 비교](../workers/_shared/storage/history-json-codec.ts), [기대 배열/packed own-attempt 대조](../workers/_shared/repositories/sermon-history-writer.ts), [BLOB 숫자 원소 검증](../workers/_shared/repositories/sermon-history-reader.ts), [packed cache 복사](../workers/_shared/repositories/sermon-history-packed-spike.ts). 숫자 바이트 배열까지 `Object.keys`·`Reflect.get`·재귀 비교를 하고, 기대 BLOB 전체도 `Array.from`으로 펼친다. writer는 정상 batch 응답 뒤에도 own-attempt 검증을 수행한다. 이를 그냥 제거하면 P5-23의 응답 유실/자기 성공 판정 의미가 달라진다.

구간별 경계 실행 10회에서 read wall time은 4~8ms, payload 0~1ms, execute 112~136ms였다. execute에 포함된 mutation batch는 40~54ms, probe batch는 15~18ms였다. 이는 I/O·스케줄링·직렬화 포함 wall time이므로 원격 CPU와 비교하거나 구간별 최솟값을 빼서 CPU로 표시하지 않는다. `0ms`는 시계 해상도 아래라는 뜻이다.

메모리는 그룹 시작/끝 `Runtime.getHeapUsage` 표본만 있다. read 그룹 끝 used heap은 약 107.14MiB였지만 선행 실행·GC·diagnostic 영향이 섞인 **로컬 시점 값**이다. 순간 peak·동시 호출 peak·원격 96MiB 통과/실패 값으로 바꾸지 않는다. 메모리 개선 필요성을 조사할 신호일 뿐이다.

## 일반 실패와 저장 의미

강제 경쟁은 첫 meta batch를 실제 읽은 뒤 다른 정상 import를 실제 commit하고, 원래 요청의 data/H1 읽기를 계속한다. 4회 모두 승자 `updated`, 원래 요청은 `phase=read`, `HISTORY_READ_CHANGED`, batch 크기 `[1,6]`으로 끝났다. **쓰기 batch·own-attempt probe까지 가지 않은 오류**다. 임시 진단기에서만 고정 코드/단계를 보존하며 원문 오류·SQL·hash·관리자·cause는 반환하지 않는다. DB 장애를 주입한 별도 회귀는 `HISTORY_READ_UNAVAILABLE`로 구분하고 비공개 canary 비노출을 검증한다.

자연 동시 20회는 승자 1·명시적 `TRANSCRIPT_REVISION_CONFLICT` 19·일반 실패 0이었다. commit/record/payload/chunk/reference/head는 `[1,2,2,8,1,1]`, assembling 0·FK 검사 0행이다. 이 로컬 실행에서는 CPU 강제 종료를 재현하지 않았으며 원격 일반 실패 4건과 commit 뒤 응답 미완료 4건은 원래 보고서의 미해결 관측으로 남긴다. 실패를 자동 재실행하지 않는다.

## 다음의 가장 작은 개선 제안 — 아직 미적용

같은 P5-27에서 먼저 **schema 없는 로컬 개선**만 검토한다.

1. 임시 원격 계측기의 오류를 고정 allowlist 코드·실패 단계·profile/index로 분류한다. 원문 오류 수집이나 공개 API 변경은 하지 않는다.
2. own-attempt BLOB 대조를 전용 바이트 비교로 바꾸어 기대 숫자 배열·키 배열·재귀 비용을 줄인다. 모든 바이트의 길이/정수/범위/값 일치, 첫·중간·마지막 변조/희소 배열 거부를 그대로 검증한다. hash만 비교하거나 정상 응답의 probe를 생략하지 않는다.
3. reader의 BLOB 검증과 packed cache 복사를 같은 strict 의미·상한 안에서 줄일 수 있는지 별도 비교한다. P5-22 전체 이력·H0/H1·codec/hash/reference, P5-23 단일 승자/패자 무기록·verified/seal·own attempt, P5-24 상한 회귀를 필수로 둔다.

범용 비교/기대 배열이 경계 표본의 약 절반이므로 이 비용을 없앤다는 가정조차 나머지 D1/검증 비용을 없애지 않는다. **이 개선만으로 원격 최대 9ms 달성을 약속할 수 없다.** 로컬 재계측 후에만 원격 재시도의 근거를 판단한다. 전송 구조나 입력 계약 변경이 필요하면 그 영향을 다시 제시한다. checkpoint/staging/Paid·새 schema/migration·전체 runtime/Workflow/UI/API·새 서비스는 계속 미채택이다.

## 검사·보존

- 집중 검사: 신규 진단 5건 + F25-01~04 28건 = 33건 통과.
- 전체 `pnpm check` exit 0: unit 27 files/262건, Worker 39 files/1,111건, lockfile·Cloudflare·Drizzle·격리 fixture·lint·typecheck·로컬 Worker/client build 통과. 브라우저 UI를 바꾸지 않아 E2E 목록/실제 E2E는 미실행이다.
- 초기 로컬 harness 옵션 오류(Miniflare 5의 v4 옵션 변환 필요), localhost EPERM, 진단 호출 인자 TypeScript 오류를 진단 코드에서만 해결했다. 원격 재시도나 제품 코드 변경으로 우회하지 않았다.
- 원시 CPU 프로필은 `/tmp/biblequiz-p527-diagnosis-Vu5adE/run4`에 있으며 소실될 수 있다. 저장된 JSON은 모든 함수별 self sample 합계·소스 위치·구간별 숫자 결과·원시 프로필 SHA-256을 보존한다. 본문 데이터/SQL 결과/예외 원문은 포함하지 않는다.
