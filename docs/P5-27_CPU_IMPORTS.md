# P5-27 CPU4 — 포함 코드·중복 검사·최초 저장 사전 조회 축소

> 2026-09-16, Asia/Seoul. [전체 숫자](P5-27_CPU_IMPORTS.json). P5-27/Phase5는 **진행 중**이다. 이전 P5-23~26 완료와 모든 이전 계측 JSON을 보존한다.

## 1. 현재 결론

최종 E의 원격220건은 전형100성공·200KB100성공·동시20건 중1성공/19정상충돌이며 CPU 강제종료/원격예외/자동재시도/누락은0이다. CPU p95는 전형5/경계8/동시5ms, 최대7/11/6ms여서 **p95≤7ms/최대≤9ms 미통과**다. query최대4/5/6은 통과다. 경계 index2의11ms는 해당 marker의 첫 관측이지만 정확한 isolate 식별이나 원인 확정은 아니다.

바로 전 D의 경계6/10ms보다 E의8/11ms가 높다. 구현한 중복 제거를 곧바로 원격 개선율로 주장하거나, D의 더 좋은 결과를 E의 성적으로 바꾸지 않는다. 다섯 후보 모두 CPU gate에 실패했다. 같은 방법의 미세 수정/무변경 재배포 반복은 여기서 중단한다. 완료 조건을 조용히 낮추지 않는다.

최종 E 로컬 메모리180건은 보수적 관측 합계 최대23,720,876bytes(22.62MiB)≤96MiB다. **E의 원격 메모리 percentile은 미확인**이다. 이전 ef7039b8의 P99911.43MB/D-032 통과 기록은 그 버전에만 유효하다. CPU 미통과 상태에서 사용자에게 또 같은 사진/로그인을 요구하지 않았으며 현재 버전 메모리가 이미 통과했다고 표시하지 않는다.

## 2. 구현한 변경과 그대로 둔 보호

- 7개 비공개 입력/store 모듈에서 Zod namespace 대신 같은 함수의 개별 import를 사용했다. 미사용 locale/JSON-schema 변환 코드가 bundle에 포함되던 경로를 제거했다. 새 라이브러리/전역 설정/schema 완화는 없다.
- 잘못된 UTF-16 검사는 지원 환경의 `String.prototype.isWellFormed`를 사용한다. 미지원 환경은 기존 정규식으로 돌아간다. 전체65,536개 단일 code unit·1,048,576개 보충 문자·경계 조합으로 기존 판정과 비교했다. 제어문자/빈 내용/UTF-8 크기 검사와 원문 무변형은 유지한다. [표준](https://tc39.es/proposal-is-usv-string/)을 따르며 이 변경만으로 ASCII200KB 원격 CPU가 개선됐다고 주장하지 않는다.
- 시작 시 순수 schema 준비에 내장 문자열/숫자 검사를 추가했다. 빈 문자열/0은 유효한 가짜 원본/명령/저장 문서가 아니다. DB/HTTP 예열은 없으며 helper는 임의 scalar refinement/transform에 쓰지 않는다.
- `prepareManualTranscriptSource`의 frozen 결과를 정확한 객체 동일성의 WeakSet으로 한 번 이어받는 `importPreparedManual`을 추가했다. 복사·직렬화·변조·외부 입력·한 번 소비한 객체는 기존 전체 검사로 돌아간다. 서버 내부에서 이미 검사한 동일한 불변 source의 형식/본문/원문 해시만 재검사하지 않는다. 새 수정 번호·설교ID·사람context는 계속 검사하며 일반 `execute`는 그대로다. 원문 해시와 저장 JSON 해시는 서로 다르므로 합치지 않았다.
- 위 경로의 version0 최초 저장만 사전 head SELECT를 생략한다. 기존0009 `input_event_claim`이 같은 원자 batch 안에서 head0/경로 배타를 확인한다. 이미 저장된 경우/경쟁 패자는 rollback되고 자기 event 확인으로 충돌·불확실을 구분한다. **SQL 시도 자체가 없는 것이 아니라 영구 기록이 없는 것**이다. 다른 명령·version>0·일반 입력은 사전 조회를 유지한다.
- 임시 probe의 중복 console 출력만 제거했다. 숫자 응답은 실행기가 기록하고 CPU/profile/index는 native invocation tail에서 대조한다. 실제 원문 생성/검증/해시/저장/응답 비용을 요청에 계속 포함한다.

원본 단독 저장·자막만 수정·전체 이력 보존·정상 성공 뒤 본문 재조회0회·원자 봉인·불확실한 자기 저장 확인·자동 replay0은 유지한다. SQL/schema/migration·실제 콘텐츠·공유DB·Production·전체 runtime/Workflow/UI/API·checkpoint/staging/Paid·새 서비스/의존성은 변경하지 않았다. 새 서버 내부 경로는 실제 runtime에 아직 연결하지 않았으며 일반 execute의 모든 입력이 이 성능이라고 확대하지 않는다.

## 3. 로컬 비교

각 형식은 새 isolate6개에서 전형/200KB 각각3개×첫 요청+이후4회, 같은 isolate20개 경쟁을 포함해50요청이다. CPU는100µs profiler의 idle/program 외 활성 표본이며 **원격 청구 ms로 환산하지 않는다**. 서로 다른 코드 후보의 변동도 보존한다.

| 형식 | 전형 첫 요청 표본3개 | 200KB 첫 요청 표본3개 |
| --- | --- | --- |
| 직전 CPU3 | 24/24/26 | 37/42/38 |
| native Unicode만 | 26/30/24 | 47/44/45 |
| native+namespace minify | 37/22/20 | 31/38/30 |
| 개별 import(A) | 17/24/20 | 35/30/33 |
| scalar 준비 | 17/17/16 | 31/32/31 |
| scalar+minify(B) | 17/23/18 | 33/28/30 |
| 준비 결과 한 번 전달(C) | 17/11/14 | 26/25/22 |
| 중복 출력만 제거 | 13/17/16 | 29/29/23 |
| 최초 사전 조회 제거(D) | 11/13/12 | 24/23/19 |
| 준비된 형식 재검사 제거(E) | 16/12/11 | 17/24/24 |

중복 출력 제거만으로 뚜렷한 로컬 개선은 입증하지 못했다. native 문자 검사 component 실험도 ASCII에서는 기존 대비 개선을 입증하지 못했고 한국어/보충 문자에서는 차이가 있었다. 2round×3종×4방법×400회=9,600회 검사/24그룹을 JSON에 보존한다. 별도 일반 control 정규식 변경 후보는 채택하지 않았다.

로컬9형식/450요청과 메모리6형식/1,080요청은 원격 표본과 분리한다. 최종 E의 D-032 메모리9시험/180요청은 독립20성공/같은 설교1성공19충돌·최대in-flight20·query≤6·FK0/quick_check정상이다. V8 total heap·used heap·backing storage·embedder를 별도 보존하며 정확한 원격 순간 peak가 아니다.

## 4. 원격 후보 전체 기록

기존 Access 보호 `biblequiz-app-preview`만 사용했다. 각 후보의 폐기용 D1에 기존0000~0009 원문과 가짜 설교201개만 준비했다. 정식 migration ledger 적용/공유DB migration이 아니다. config는 `/tmp/biblequiz-p527-cpu4-remote-cdGTw9/`에 있으며 저장소의 과거 시험 config를 재사용하지 않는다. 정확한 version의 read-only ready CPU와 빈 head0 확인 뒤에만220건을 시작했다.

각 칸은 **p95/최대 ms**, 느린 첫 요청도 포함한다.

| 후보 | 실제 version | 전형100 | 200KB100 | 동시20 | query최대 |
| --- | --- | --- | --- | --- | --- |
| A 개별 import/Unicode | 6e231668 | 8/16 | 9/11 | 6/8 | 5/6/7 |
| B scalar/minify | deba65d5 | 8/11 | 9/15 | 7/8 | 5/6/7 |
| C 한 번 전달 | fb592a12 | 7/11 | 7/12 | 8/9 | 5/6/7 |
| D 사전 조회/중복 출력 제거 | 893825a0 | 4/9 | 6/10 | 5/7 | 4/5/6 |
| E 준비된 형식 재검사 제거 | 1c3abe8a | 5/7 | 8/11 | 5/6 | 4/5/6 |

다섯 후보 모두 전형/경계 각100성공·동시1성공19충돌, 총1,100개 응답과1,100개 CPU tail이 profile/index로 일대일 일치했다. 원격예외·강제종료·잘린 tail·수집누락·자동재시도는0이다. 각 최종DB heads/events201·chunks1413·unsealed/legacy0·FK0·quick_check정상이다. E는 KST19:25~19:27경에 실행했으며 정확한 epoch 시각은 JSON에 있다. fixture의 고정 runId는 이전 문자열이므로 version과 시각으로 구분한다.

Wrangler bundle은 A192.94KiB→B100.33→C100.60→D100.71→E100.82KiB, startup25/40/24/20/21ms였다. 크기 감소와 startup/원격 CPU 감소는 같은 지표가 아니다. 앞선 CPU3의590.55KiB와도 구분한다.

A 이후 read-only 대조60건은 invalid30건 CPU p950/최대1ms, ready SELECT30건 p952/최대3ms다. 이미 사용한 version/경로의 대조이므로 모든 cold start의 최소 비용이나 플랫폼 전체 원인 증명이 아니다. E 복구 health에서11ms도 관측했지만 다른 bundle/middleware이므로 현재 저장 경로의 기준 면제 근거가 아니다.

A 최종DB 확인 첫 시도는 API7403으로 실패했고 같은 read-only 명령의 재시도에서 성공했다. 인증 원인은 확정하지 않았으며 인증파일을 읽지 않았다. 로컬 service-binding trigger에는 이전과 같은 request-stream/internal-error 진단이 있었고 실제 원격 응답/tail은 완전했다. trigger Ctrl-C exit1/tail exit130은 의도한 종료이지 정상 exit0이나 원격 저장 오류로 표현하지 않는다.

## 5. 검사·정리

- 최종 `VITEST_MAX_WORKERS=2 WRANGLER_WRITE_LOGS=false pnpm check` exit0: unit262+Worker1,398=**1,660건**, lint/typecheck·정적/Drizzle·격리 fixture·로컬 build 통과. 로그 `/tmp/biblequiz-p527-cpu4-envelope-check.log`.
- 신규 atomic 경로는 사전 SELECT0·동시20개의 서로 다른 준비 객체·seal/chunks/head 누락 rollback·lost/sparse/unavailable 응답·잘못된 수정 번호를 검사했다. 기존 위조/복사/재사용·자료 종류·원문/이력·일반 명령 회귀도 유지했다. 최종 관련2files/235건 통과.
- 중간 전체 검사1,647/1,648/1,651/1,659건 결과도 단계별로 보존한다. 최초 `String` wrapper 타입 lint 오류를 소문자 primitive 타입으로 수정했다. no-log 전체검사는 후속 소스 수정과 시점이 겹칠 수 있어 최종 판정에 쓰지 않고 E 전체검사로 확정했다. 실패 주입의 FK rollback 진단은 예상 출력이다. timeout/검사 조건은 완화하지 않았다. UI 변경이 없어 E2E는 실행하지 않았다.
- 각 후보 뒤 기준 version `fc10f77d-ca54-4dfd-a94a-9fb3cffcf482`100%로 복구했고 health200/Access302를 확인했다. 최종 DB목록은 공유 `biblequiz-d1-preview`(`cb044032-7e26-452b-afae-b0cae3d93678`)1개뿐, 공유 migration0007/0008/0009는 계속 대기다.
- 시험 DB A~E 다섯 개는 영구 삭제했다. 복구 불가인 합성 데이터이며 seed/모든 숫자 결과는 보존했다. local trigger/tail은 모두 종료했다. commit/push·Production·기존 공유 데이터 변경은 없다.
- 일반 주간 잔여56→47%, 일반5시간값 미제공/reset없음. 한도 중단은 아니다. 최종 파일 보존/문서 검사는 HANDOFF 9절에 기록한다.

## 6. 다음 판단 — 아직 채택하지 않은 범위

현재는 CPU 실패이며 완료/무료 운영 적합성으로 표시하지 않는다. 최신 원격 메모리도 미확인이다. 기존 사진을 다시 요청하거나 9ms 조건을 조용히10/11ms로 바꾸지 않는다. 무료 한도와 내부 여유 목표도 구분한다. [Cloudflare 공식 한도](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)는 Free10ms와 드문 초과를 위한 여유를 설명하지만, 오류0회가 미래 무제한 안전이나 현재7/9ms 목표 통과를 의미하지 않는다.

권하는 다음 검토는 **기존 입력 검사 라이브러리의 성능 개선 버전과 시작 시 컴파일 호환성**이다. 현재 설치본은 Zod4.4.3이며 [공식4.5.0 발표](https://github.com/colinhacks/zod/releases/tag/v4.5.0)는 컴파일/메모리 개선을 설명한다. 해당 기능은 `new Function()` 기반이며 [Cloudflare 시작 시 허용 규칙](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#enable-eval-during-startup)과 요청 중 금지를 구분해야 한다. 설치4.4.3의 `allowsEval`은 Cloudflare user agent에서 false로 닫는다. 따라서 단순 버전 교체만으로 Workers에서 빨라진다고 약속하지 않는다.

이 후보는 앱 전반의 검사 라이브러리/lockfile에 영향을 줄 수 있으므로 **교체·컴파일 방식 채택은 사용자 승인 전 미실행**이다. 먼저 별도 로컬 환경에서 정·오 입력 동일 판정, 시작/요청 실행 가능성, 새 isolate CPU와 동시 메모리를 대조해야 한다. 사용자/AI 문자열을 코드로 실행하거나 전역 자동 컴파일을 켜지 않는다. 호환성/개선 근거가 없으면 배포하지 않는다. 유료 서비스·새 schema·저장 이력 축소·runtime 연결이나 CPU 기준 변경의 승인으로 확대하지 않는다. 라이브러리 발표의 배수를 이 프로젝트 개선율로 인용하지 않는다.

## 7. 10분 사전 검토 — 2026-09-16

사용자가 승인한 이번 범위는 최대10분의 자료/코드 검토뿐이다. **판정: 격리 로컬 비교 후보로 유지하되, 프로젝트 교체나 원격 시험은 아직 진행하지 않는다.** 성능 개선이나 P5-27 성공 시점을 확정할 근거는 없다.

- [Zod4.5.0 실제 소스](https://github.com/colinhacks/zod/blob/v4.5.0/packages/zod/src/v4/core/compile.ts)의 명시적 `compile`→`compileFn`은 기존 `allowsEval` 검사를 거치지 않고 함수 생성을 시도한다. 현재4.4.3의 Cloudflare 차단이 이 새 경로도 무조건 막는다는 설명은 맞지 않는다. 다만 실제 workerd 실행은 이번에 검증하지 않았다.
- 현재 `wrangler.jsonc`의 compatibility date는2026-08-25다. [공식 시작 시 허용 규칙](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#enable-eval-during-startup)의 기본 적용일2025-06-01 이후이므로, 시작 단계에서 명시적으로 준비하는 방식은 설정상 시험할 근거가 있다. 요청 중 자동 컴파일·전역 shim·사용자 문자열 코드 실행·플랫폼 감지 우회는 후보에서 제외한다.
- 새 API는 원래 schema를 수정하지 않고 **새 schema를 반환**한다. 현재 `prepareInputSchema(...)` 호출들은 반환값을 사용하지 않으므로 helper 안에 compile 호출만 추가해서는 적용되지 않는다. 로컬 후보는 완성된 schema의 반환값을 실제 parse 경로에 연결해야 한다. 지원하지 않는 schema는 기본적으로 조용히 기존 방식으로 돌아가므로 시험에서는 `strict: true`의 실패와 실제 선택 경로를 확인해야 한다.
- 현재 수동 원본 입력 schema는 자료 종류·문자열 길이 등 작은 형식 검사다. Unicode/제어문자 검사·UTF-8 변환·원문 해시·저장 JSON 변환/해시·D1 전송은 바깥 코드에 남는다. 따라서 이 변경만으로200KB 저장 전체가 발표된 배수만큼 빨라지거나 경계 최대11ms가9ms 이하가 된다고 추정하지 않는다.
- 다음 권고는 **별도 임시 로컬 환경에서 최대15분의 호환성/선별 비교 한 번**이다(아직 미승인·미실행). 저장소 package/lockfile과 제품 코드를 바꾸지 않고4.4.3/검토한4.5.0을 비교한다. 시작 성공·실제 컴파일 선택·정상/잘못된 입력의 결과·첫 요청을 포함한 반복 표본을 확인한다. 불일치·시작 실패·개선 불명확 또는 시간 종료이면 중단하고 결과만 보고한다. 통과하더라도 전체 회귀/동시 메모리/원격7/9ms 검증을 대신하지 않는다.

이번에는 의존성 설치·앱 코드/설정 변경·테스트/계측·DB/배포·commit/push를 하지 않았다. STATUS/HANDOFF와 본 검토 기록만 갱신한다. 과거 결과와 P5-23~26 완료 상태는 그대로다.
