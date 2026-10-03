# P5-27 첫 요청 CPU·메모리 진단 — 2026-09-16

## 결과

**후속 확인(2026-09-16): Access 로그인은 성공했다. 그러나 설치 Wrangler4.125.0은 remote 모드에서 inspector를 명시적으로 비활성화한다.** 따라서 아래의 “로그인 후 원격 inspector 연결” 계획은 현재 도구로 실행할 수 없다. 인증 부재만을 메모리 미측정 원인으로 설명한 이전 안내를 정정한다. 로그인 재시도로 해결하지 않는다. 자세한 확인과 다음 결정은 아래 `원격 측정 기능 확인`을 따른다.

**이후 승인/실행:** 사용자가 D-032의 로컬동시부하+원격지표 분리 검증을 승인했다. [새 메모리 보고서](P5-27_MEMORY_D032.md)의9개isolate/180invocation 로컬 관측은 통과했고 원격지표 확인은 남는다. 아래 `미채택` 권고와 인증준비는 당시 기록이며 다시 승인을 요구하지 않는다.

남은 첫 요청 비용의 일부를 **입력 검사 규칙의 지연 초기화**로 좁혔다. 기존 검사 규칙을 시작 시 준비하는 로컬 대조 실험에서 첫 요청의 CPU 활성 표본이 줄었다. GC와 D1/기타 첫 실행 비용도 남아 단일 원인이나 원격 목표 통과로 단정하지 않는다. 제품 저장 코드/검사 규칙/원격 환경은 변경하지 않았다.

메모리 원격 연결은 service token만 가능한 것이 아니다. 기존 Access의 사람 로그인 정책을 사용하는 **대화형 브라우저 로그인**을 우선한다. 현재 WSL PATH에는 `cloudflared`가 없어 공식 도구의 임시 사용과 사용자 로그인이 다음 준비 사항이다. 인증 성공이 곧 정확한 순간 peak 관측 성공을 뜻하지는 않는다.

## 재현 방법과 제한

[로컬 실행기](../scripts/p5-27-profile-selected-cold.mjs)는 기존 `p5-27-selected-probe.ts`를 그대로 bundle한다. Wrangler 환경/config/자격 증명/remote binding을 읽지 않고 외부 fetch를403으로 차단한 Miniflare workerd·메모리 D1만 사용한다. 기존0000~0009를 로컬 재현하고 종료 시 dispose한다. 실제 콘텐츠/계정/Preview/Production·schema·migration·Access·배포·commit/push 변경은0이다.

- 기본형 A: 전형23-byte/경계200KB별 새 isolate3개씩, 각각 처음1+이후4=30회. 한 isolate에서 동시20회도 별도로 실행한다.
- 준비형 C: 명령/import payload·사람 context·event metadata의 기존 Zod schema를 합성 작은 값으로 **모듈 시작 시 한 번** 실행한 대조 실험. HTTP/DB 예열은 없고 처음 실제 요청도 측정한다. 본문/hash/SQL/모든 저장 검사는 그대로다. 준비 비용을 없앤 것이 아니라 startup으로 옮긴 것이며 startup 전체 비용은 별도 계측하지 않았다.
- 준비형 B는 전체 검사 시작과 잠시 겹쳤다. 해당 검사를 중단하고 C를 단독 실행했다. B도 JSON에 `overlappedCheck: true`로 보존하되 A/C 비교에 섞지 않는다. 세 trial 합계150개 요청,18개 fresh isolate다. 원격220회 suite를 반복한 것이 아니다.
- V8 CPU profiler 간격100µs. 표본 수는 시간을 환산한 청구 CPU가 아니며 `(idle)`/`(program)`을 뺀 활성 표본(GC 포함)을 비교한다. 느린 첫 요청을 제외하지 않았다. 로컬 wall time은 I/O·호스트 스케줄링·profiler 비용이 포함되므로7/9ms 판정에 사용하지 않는다.

## 첫 요청 비교

| 입력 / 활성 표본 | 기본형 A | 준비형 C |
| --- | --- | --- |
| 전형 첫 요청3회 | 35, 37, 39 | 20, 24, 18 |
| 전형 첫 요청 중앙값 / 이후12회 중앙값 | 37 / 5 | 20 / 5.5 |
| 200KB 첫 요청3회 | 54, 46, 50 | 38, 31, 36 |
| 200KB 첫 요청 중앙값 / 이후12회 중앙값 | 50 / 18 | 36 / 17 |

[숫자·함수별 표본](P5-27_FIRST_REQUEST_DIAGNOSIS.json). 기본형 첫 요청에서 Zod의 `normalizeDef`/`inst._zod.parse`/`runChecks`, GC, D1 `_send`, 실제 append/hash가 관측됐다. 설치된 Zod4.4.3의 object parser는 `_normalized`를 처음 parse 때 준비한다. 준비형은 동일한 schema를 먼저 실행하므로 이 부분을 분리하는 실험이며 검증 완화가 아니다. GC/라이브러리·플랫폼 첫 실행이 남아 전부 해결된 것은 아니다. 3회씩인 소표본·고정 A→C 순서의 로컬 진단이므로 원격 개선율/원인 비중으로 확대하지 않는다.

제품 코드에 합성 dummy 저장/예열 요청을 넣는 방안은 채택하지 않았다. 다음 CPU 구현 후보는 **검사 규칙의 준비 시점을 정리하는 것**이며 일반 요청마다 검사할 내용은 유지한다. 이 실험 코드를 그대로 앱 초기화로 복사하지 말고 초기화 부작용/시작 비용/오류 의미와 모든 입력 경로를 검토해야 한다. Zod 최신 웹 문서의 `z.compile()`은 현재 설치4.4.3에서 제공되지 않으며 eval 제약도 있어 단순 해결책으로 채택/업그레이드하지 않았다.

## 로컬 메모리 관측

A/C 각각 같은 marker의 한 isolate에20개를 동시에 dispatch했다. 승자1/명시적 충돌19, 최종 event1/chunks13, FK0이다. 각5회의 `Runtime.getHeapUsage` 표본에서 JS used heap 최대는8,127,196 / 8,153,844bytes(약7.8MiB), backing storage 최대는양쪽7,057,475bytes였다. 숫자는 JSON에 모두 보존한다. 이들은 **로컬 시점 표본**이며 정확한 순간 peak·원격 isolate 전체 메모리·20개가 항상 같은 단계에 동시에 머무는 부하의 증거가 아니다. 강제 GC/측정용 pause나 동시 요청 수 축소로 합격시키지 않았다. 96MiB gate는 계속 미측정이다.

## 인증 경로 확인과 다음 승인 범위

공식 [Access 보호 Worker 연결](https://developers.cloudflare.com/workers/local-development/#connect-to-access-protected-workers)은 대화형 사람 로그인과 비대화형 service token을 구분한다. 설치 Wrangler4.125.0의 `getAccessHeaders`도 비대화형이면 거부하지만 대화형이면 `cloudflared access login`을 호출한다. 따라서 이전 실패는 **실행 방식의 인증 부재**이지 새 service token/Access 정책이 반드시 필요하다는 뜻이 아니다.

권장 다음 범위:

1. 공식 [cloudflared 배포처](https://developers.cloudflare.com/tunnel/downloads/)의 Linux 도구를 버전/해시 검증 후 임시 경로에서만 사용한다. 앱 의존성 추가·시스템 서비스 설치·Tunnel/도메인 생성은 하지 않는다. 현재는 다운로드/실행하지 않았다.
2. 기존 Preview 호스트에만 대화형 로그인하여 사용자가 기존 Cloudflare 계정으로 브라우저에서 인증한다. 비밀번호/토큰을 채팅으로 요구하지 않고, 원래 계정/OAuth 설정 파일을 직접 읽지 않는다. 새 Service Auth 정책/Access 해제는 하지 않는다.
3. **로그 보호를 먼저 설정한다.** 설치 Wrangler는 `cloudflared output`을 debug로 기록하는 코드가 있고 디스크 로그는 기본 켜짐이다. 인증 실행은 `WRANGLER_WRITE_LOGS=false`, `WRANGLER_LOG=error`로 디스크/debug 출력을 막고, cloudflared stdout에는 토큰이 포함될 수 있으므로 이를 그대로 도구 출력/파일/터미널에 내보내지 않는다. 실제 토큰을 열어 검사하지 않고 코드에서 확인했다.
4. 인증 연결 뒤 remote inspector의 heap 관측 기능과 부하 중 표본 수집 가능성을 작은 probe로 먼저 확인한다. 배포 버전 변경/합성 DB 재생성 전에 관측 가능한 값과 한계를 확인한다. 기존 삭제된 계측 D1 ID를 재사용하지 않는다. 공유DB·실제 자료는 연결하지 않는다.

공식 [메모리 진단](https://developers.cloudflare.com/workers/observability/dev-tools/memory-usage/)은 snapshot을, [메모리 지표](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/#memory-usage)는 invocation 시점 percentile을 설명한다. 둘을 순간 최대값이라고 바꾸어 쓰지 않는다. 인증만 연결하면 gate가 자동 해결된다고 약속하지 않는다. 현재 원격 CPU/메모리 판정은 직전 [원격 보고서](P5-27_SELECTED_MEASUREMENT.md) 그대로다.

## 검사와 재개

실행기 내부 검증은150개 요청 모두 통과했다. 원본 저장 결과/query5·6, isolate별 marker 일치, 각 trial 동시20 승자1/충돌19·event1/chunks13·FK0을 확인했다. 최종 `VITEST_MAX_WORKERS=2 pnpm check` exit0: unit262+Worker1,377=1,639건, 정적 검사·lint/typecheck·fixture·로컬build 통과. 시작314개 중 문서4개만 변경·310개해시동일·신규3/삭제0, 링크124개·150요청숫자일치·공백/index보존 확인. E2E는UI변화없어미실행. 진단 로그/원시 profile은 `/tmp/biblequiz-p527-cold-20260916-{a,b,c}`, 재개에 필요한 요약은 이 문서와 JSON으로 보존한다.

같은P5-27/Phase5는 진행 중, 세션 유지다. 첫 요청 진단 하위 단계는 완료했으므로 같은 profiler만 다시 실행하지 않는다. 다음은 초기화 개선의 제품 적용 검토와 승인된 안전한 대화형 인증 연결 준비다. 원격 재측정은 개선/관측 준비가 갖춰진 뒤에만 한다.

## 원격 측정 기능 확인 — 로그인 성공 이후

- 사용자가 Cloudflare Access의 `Success!`를 확인했고 공식 로그인 도구도 `LOGIN_OK`, exit0을 반환했다. 브라우저 승인과 도구 연결 모두 성공이다. 인증값/캐시 파일은 직접 읽거나 기록하지 않았다.
- 기존 Preview 이름에 DB/secret/서비스 binding 없는 404 응답 전용 프로그램을 `wrangler dev --remote`의 임시 edge-preview로 실행했다. 활성 버전 배포/전환은 하지 않았다. 로컬 프록시8797에서 원격 프로그램의404를 확인했지만 inspector9237은 `ECONNREFUSED`였다. 앱 자료나 저장 명령을 실행한 시험이 아니다.
- 설치 `node_modules/wrangler/wrangler-dist/cli.js:326197`의 `inspectorEnabled`는 `dev.remote`이면 false를 반환한다. [공식 소스](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/api/startDevWorker/ProxyController.ts)의 같은 조건도 원격 inspector URL이 없고 로그는 tail을 사용한다고 명시한다. 인증 실패/방화벽/DB/사용자 조작 문제로 분류하지 않는다.
- [메모리 안내](https://developers.cloudflare.com/workers/observability/dev-tools/memory-usage/)에는 remote 관련 표현이 남아 있지만 현재 설치 구현과 다르다. [공식 Metrics 설명](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/#memory-usage)은 invocation 시점의 표본 P50/P90/P99/P999를 제공하며 순간 최대값이나 단일 isolate의20개 동시 점유를 증명하지 않는다. Quick Editor도 [공식 변경 기록](https://developers.cloudflare.com/changelog/post/2026-02-12-quick-editor-dev-tools-deprecation/)에서 inspector를 log viewer로 대체했다. 구버전 도구/보호 해제/비공개 인증 추출로 우회하지 않았다.
- 임시 실행을 정상 종료(exit0)했고8797/9237 포트 종료를 확인했다. 현재 활성 deployment `936d61f3-22bc-48f6-809c-563a68621866`의 version은 기존 `fc10f77d-ca54-4dfd-a94a-9fb3cffcf482`100%이며 비로그인 Preview는 Access302다. 새 D1 생성·migration·공유DB 조회/쓰기·활성 배포/정책 변경은 없다. edge-preview 실행은 원격 행위이므로 “원격 실행 없음”으로 기록하지 않는다.

**다음 권고(미채택):** 메모리 검증을 `로컬 동일 isolate20개 동시 부하의 상세 heap 관측 + 원격 배포의 메모리 지표/메모리 초과 오류 확인`으로 바꾸는 것을 사용자에게 제안한다. 이는 원격 순간peak96MiB 증명과 동등하지 않으므로 완료 기준 변경 승인 전 대체 통과로 계산하지 않는다. CPU p95≤7ms/max≤9ms·query≤40·의미 회귀는 완화하지 않는다. 원격 지표의 현재 계정 조회 가능 여부/필요한 읽기 권한도 실제 수집 전에 확인해야 한다. CPU 첫 요청 개선은 별도로 남는다.

이번 확인은 제품 코드 변경 없는 인증/측정 기능 진단이다. 이전1,639건 전체 검사와150개 로컬 요청/440개 원격 저장 요청 결과를 보존하며 이번에 재실행한 수치로 쓰지 않는다. STATUS/HANDOFF·문서 공백/링크/파일 보존을 검사한다. P5-27/Phase5는 진행 중이며 같은 로그인과 무변경220회 시험을 다음 첫 작업으로 되돌리지 않는다.
