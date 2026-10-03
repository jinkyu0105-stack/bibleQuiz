# P5-27 바이트 처리 로컬 개선 — 2026-09-15

## 판정

진단에서 제안한 **schema 없는 바이트 비교·검증·복사 개선과 임시 probe 오류 분류**를 적용했다. 로컬 재계측에서 해당 병목의 감소를 확인했지만 **P5-27/Phase 5는 진행 중**, 원격 Free CPU/메모리 gate는 미통과다. 이번에는 원격 조회·설정·배포·migration을 하지 않았다.

이전 [원격 220회 보고서](P5-27_PREVIEW_MEASUREMENT.md)/JSON과 [최초 로컬 진단](P5-27_LOCAL_DIAGNOSIS.md)/JSON은 수정하지 않는다. 과거 원격 일반 실패 4건·commit 뒤 응답 미완료 4건의 원인이 해결됐다고 표시하지 않는다.

## 구현과 보존한 의미

- [byte helper](../workers/_shared/storage/history-byte-array.ts): D1 숫자 배열을 65,536개 이하로 제한하고 모든 원소의 own-property·정수·0~255를 확인하면서 소유권이 분리된 `Uint8Array`로 한 번만 복사한다. 문자열/typed array를 임의 변환하지 않으며 희소 배열·길이 변화를 거부한다. getter-backed 합성 입력도 검증한 값을 두 번째 읽지 않는다.
- [reader](../workers/_shared/repositories/sermon-history-reader.ts): strict Zod 행 schema는 유지하고 BLOB 필드의 원소별 Zod 실행/숫자 배열 복사와 뒤의 추가 복사를 위의 한 번 검사·복사로 대체했다. 모든 payload decode/hash·참조·전체 이력·H0/H1 검증은 그대로다.
- [writer](../workers/_shared/repositories/sermon-history-writer.ts): 기대 BLOB를 큰 숫자 배열로 펼치지 않고 원래 `ArrayBuffer`의 bytes와 실제 반환 배열을 직접 비교한다. 길이·enumerable key 개수·own-index·모든 값·행 metadata·verified·순서를 유지한다. 원래 범용 `sameHistoryValue` 자체는 바꾸지 않았다. 정상 응답에서도 own-attempt probe를 수행하고 query/SQL/bind/원자 batch/봉인/replay 정책은 그대로다.
- [packed reader](../workers/_shared/repositories/sermon-history-packed-spike.ts): 외부에 노출하지 않는 read-only 내부 view에서 원시 BLOB 배열 전체의 `structuredClone`을 제거했다. 위 reader가 metadata를 parse하고 bytes를 소유 복사한 뒤에만 state로 조립한다. DB 결과 불변·반환 state 분리/동결을 회귀 검증했다.
- [임시 probe](../workers/app/p5-27-preview-probe.ts): 실패를 `request/ready/read/payload/execute` 단계와 고정 allowlist 코드, 검증된 합성 profile/index로 분류한다. SQL·원문 오류·hash·관리자·cause는 로그/응답에 포함하지 않는다. 원격 배포하지 않았으므로 기존 배포본의 과거 오류 분류가 바뀐 것은 아니다.

이 변경은 저장 byte·schema·domain 계약·입력 상한을 바꾸지 않는다. P5-23~P5-26 완료 기록은 당시 기록으로 보존하며 기존 reader/writer/packed 구현의 위 비용 경로만 이번 P5-27에서 수정했다. probe를 삭제하거나 hash만 비교하거나 전체 이력을 생략하는 접근은 채택하지 않았다.

## 개선 전후 재계측

변경 전 동일한 [로컬 profiler](../scripts/p5-27-profile-local.mjs)를 새 isolate에서 실행하고, 변경 후 같은 행렬을 새 isolate에서 실행했다. 23-byte 전형/200,000-byte 경계, 빈 이력 import와 저장된 경계 이력 read, 강제 경쟁/자연 동시 20개를 그대로 사용했다. profiler 코드·입력은 동일하며 원문 probe의 안전한 오류 분류 추가만 건강한 경로에 작은 단계 기록 비용을 더한다.

아래의 sample 수는 idle/GC/미분류를 포함한 **V8 self sample 개수**다. 밀리초·원격 청구 CPU·개선율 보증이 아니다. 각 작업은 10회이며 분리된 실행의 host 부하/JIT/GC 차이가 있다. wall time 중앙값은 10개 중 가운데 두 값의 평균이다.

| 로컬 구간 | 변경 전 → 후 self samples | 변경 전 → 후 wall time 중앙값 |
|---|---:|---:|
| 원문 probe 경계 import | 1,721 → 910 | 원문 probe는 구간 시간을 반환하지 않음 |
| 구간별 경계 execute | 1,335 → 830¹ | 426.5 → 403ms |
| 저장된 경계 이력 read | 1,147 → 300 | 258.5 → 98ms |

¹ 해당 self profile은 operation 전체(read/payload/execute)를 포함하며 wall 열은 execute 구간만이다. 서로 같은 양으로 환산하지 않는다.

원문 경계 import에서 기존 범용 비교+callback 699개와 기대 배열 생성 120개의 self sample 집중이 해소되고, 새 전용 비교는 216개다. D1 내부 처리 399개는 여전히 큰 비중이다. 구간별 operation에서도 D1 내부 391개와 전용 비교 176개가 남는다. 기존 큰 이력 read의 Zod 주요 3개 함수 667개 집중도 완화되고 단일 복사/검증 함수 86개로 집중 위치가 바뀌었다.

쓰기 wall time은 I/O·호스트 스케줄링 때문에 감소 폭이 작고 표본 편차가 크다. **읽기 개선을 전체 저장이 무료 9ms CPU 안에 들어온 것으로 확대하지 않는다.** 원격 p95/max는 이번에 재측정하지 않았으며 isolate heap은 그룹 시작/끝 로컬 값만 있어 peak 판정을 하지 않는다.

첫 개선 후 trial은 다른 Worker 회귀 검사와 겹쳤으므로 대표 전후 비교로 쓰지 않았다. 이후 다른 Worker 검사 없이 재실행한 값을 위 표에 사용했다. 불리한 표본을 삭제하지 않았으며 [전후·겹친 trial 숫자 근거](P5-27_LOCAL_OPTIMIZATION.json)에 세 실행을 모두 보존한다. 원시 프로필은 `/tmp/biblequiz-p527-opt-Cnn8Wd/{baseline,optimized,optimized-isolated}`에 있으며 임시 파일이다. 각 실행의 bundle 행 번호는 서로 다르므로 동일 행으로 비교하지 않는다.

모든 정상 합성 요청은 통과했고 자연 동시 20개는 각 실행에서 승자 1·명시적 충돌 19였다. 최종 commit/record/payload/chunk/reference/head `[1,2,2,8,1,1]`, assembling 0, FK 이상 0, operation read 1·replay 0, 최대 query 34를 유지했다. 강제 H0/H1 경쟁은 4/4 `HISTORY_READ_CHANGED`였다. 실행 후 임시 로컬 DB·Worker·inspector는 dispose했다.

## 회귀·다음 경계

[바이트 회귀](../workers/app/history-byte-array.test.ts)는 원소 전체 범위·64KiB 상한·분리된 소유권·희소/상속/추가 key·null/absent·행 metadata·첫/중간/마지막 변조를 검사한다. 실제 정상 commit 뒤 반환 probe의 byte만 바꿔도 성공으로 오판하지 않으며 DB commit을 rollback됐다고 표시하거나 새 attempt를 재실행하지 않는다. [probe 회귀](../workers/app/p5-27-preview-probe.test.ts)는 실제 H0/H1 경쟁·DB 장애·잘못된 입력·외부 요청 차단과 비공개 canary 비노출을 확인한다.

첫 관련 묶음은 193건 통과, 기존 큰 reader 검사 1건이 5초 timeout이었다. profiler와 겹친 실행이므로 제품 timeout이나 검증을 완화하지 않고 측정을 끝낸 뒤 전체 검사를 실행했다. 신규 검사 선언의 lint/Request generic 타입 오류는 검사 코드에서만 수정했다. 최종 `pnpm check` exit0: unit262건, Worker41 files/1,141건(신규 byte26·probe4 포함), 정적 검사·격리 fixture·lint·typecheck·로컬 Worker/client build 통과. 앞의 timeout 검사도 통과했다. UI 변화가 없어 E2E 목록/실제 E2E는 미실행이다.

보존 확인: 시작292개 중 의도한 코드4·상태 문서3개만 변경, 나머지285개 해시 동일·삭제0, 신규5개다. 이전 계측 자료·P5-24/P5-25 정본·schema/migration·package/lockfile·Wrangler 배포설정은 보존했다. 링크52개·숫자 근거·production bundle 비포함·공백 검사를 통과했다.

다음은 같은 P5-27에서 남은 **D1 BLOB 전송/숫자 배열 생성 비용**의 schema 없는 개선 가능성을 검토하는 것이다. 현재 로컬 write 잔여 비용 때문에 같은 원격 220회를 즉시 반복할 근거는 부족하다. SQL의 전송 표현을 바꾸는 실험이 필요하면 exact byte·verified/seal·query/bound/transport 상한과 실패 의미를 보존하는 구체적인 범위를 먼저 제시한다. 아직 그런 전송 변경을 구현하지 않았다. checkpoint/staging/Paid·새 schema/migration·입력 축소·전체 runtime/Workflow/UI/API·새 서비스는 계속 제외한다. 기존 0008 원격 적용 경로/ledger 검증도 이번에 해결하거나 적용하지 않았다.
