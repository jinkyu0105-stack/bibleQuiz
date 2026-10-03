# P5-44 lifecycle/context 물리 구조 검토

> 2026-09-19, Asia/Seoul. **P5-44 로컬 물리 범위 완료 / 0013 운영 미적용**.
> P5-44a~d 기록을 보존하고 새 하위 번호 없이 남은 guard·scope finish·populated upgrade 검증을 완료했다. G02 저장 조립과 실제 환경 검증은 후속이다.

## 1. 범위와 현재 산출물

[14.3.27~28](../implementation.md#14327-p5-42-generation-lifecyclecontext-내구성-상세-설계--2026-09-17)의 12개 빈 물리 단위를 [Drizzle](../workers/_shared/db/schema.ts), [0013 후보 SQL](../migrations/0013_phase5_generation_lifecycle.sql), snapshot/journal에 생성했다. 0010~0012는 수정하지 않았다. 후보는 실제 journal에서 확인한 다음 번호다. 로컬 물리 검증을 완료했지만 기존 v1 writer의 0013 호환과 운영 적용 승인을 뜻하지 않는다.

- context/chunk/request/step/wait, dispatch attempt/receipt, control command, transition evidence/step outcome, usage observation/settlement의 12개 표다.
- 기존 generation job/event/dispatch/step receipt 네 표를 재구성하고 call에 nullable settlement FK를 추가했다. legacy 행의 기존 열 값은 그대로 복사하고 신규 열은 명시 `NULL`이다. 새 계약은 request/input version=2이며 wire version=1과 구분한다.
- DB는 소유권·실제 FK·manifest 크기/조각/봉인·불변성·상태 전이를 검사한다. 실제 SHA-256/strict payload/도메인 의미·과거 bundle probe·수신자의 실제 플랫폼 신원은 후속 private writer/reader/Workflow 책임이다. SQL에서 hash를 계산했다고 주장하지 않는다.
- 현재 후보는 공통 input/content/metadata/settings/selection/ticket projection을 `generation_contexts`에 정규화하고 request/step/wait link가 같은 job/kind의 context를 참조한다. 상세 설계의 “각 link의 JSON 밖 projection”을 중복 열 대신 이 관계로 표현한 것이다. 소유권·kind·task·원래/current nullable 투영을 guard와 정상/실패 fixture로 대조했다. payload 내부 의미는 writer/reader·domain 계층에 남는다.
- `full/final_audit/single_entry`의 `review_ready`는 G03의 비-AI artifact/설정·선택 권위가 없으므로 현재 후보에서 차단한다. correction/summary/child/adult는 자기 직전 성공과 정산, intent는 자기 분석→비판→사람 확정이 있는 wait→실제 resume 소비를 요구한다. G03 하드 게이트 증거가 없는 needs_revision도 닫는다. 이 물리 검사를 전체 domain finish 구현으로 쓰지 않는다.

저장 writer/adapter 이식·실제 workers/content/Workflow/provider·usage envelope·AI/실제 콘텐츠·cleanup·개발/Preview/Production DB·원격·배포·commit/push는 수행하지 않았다. 새 의존성이나 서비스도 추가하지 않았다.

## 2. 재구성 방식과 확인한 문제

Drizzle 자동 생성본은 D1에서 사용할 수 없는 `foreign_keys=OFF`, 원래 없던 신규 열을 SELECT하는 복사문, 누락되는 trigger/지연 FK를 그대로 사용하면 안 된다. 검토 후 다음 순서를 후보에 반영했다.

1. FK 검사와 기존 job별 열린 receipt 중복 preflight를 수행한다. 충돌을 삭제하거나 상태를 보정하지 않는다.
2. `defer_foreign_keys=ON` 상태에서 재구성 표를 참조하는 trigger만 일시 제거한다. 기존 열만 정확히 복사하고 새 legacy link 열은 NULL로 둔다.
3. 네 표·기존 index/trigger를 복원하고 새 guard·지연 cycle을 추가한다. 기존 active job unique와 terminal 불변을 유지한다.
4. transaction 안의 CHECK assertion으로 `pragma_foreign_key_check` 결과가 0건인지 강제한 후에만 deferred rebuild counter를 해제한다. assertion·statement 중 하나라도 실패하면 migration 전체를 rollback한다.

설치 SQLite와 실제 로컬 D1에서 단순 `ON→copy/drop/rename→commit`은 최종 FK가 정상이어도 `RESTRICT` 지연 counter 때문에 실패했다. 최종 FK assertion 후 `OFF` 방식은 로컬 D1에서 통과했다. FK 검사를 생략한 OFF나 `foreign_keys=OFF` 우회는 채택하지 않았다. 원격 D1 적용 검증은 하지 않았다.

설치 Wrangler의 SQL splitter는 `=CASE`, `<>CASE`, `END)` 같은 경계에서 중첩 CASE를 잘못 분리했다. SQL 의미를 바꾸지 않고 CASE 전후 공백을 보정했으며 실제 `unstable_splitSqlQuery` 결과도 검사한다. [신규 rehearsal](../scripts/check-generation-lifecycle-upgrade.mjs)도 같은 설치 Wrangler splitter를 사용한다.

## 3. 검사 경계

[기존 upgrade rehearsal](../scripts/check-migration-upgrade.mjs)은 0000→0012의 기존 검사를 보존한 뒤 신규 rehearsal을 실행한다. 새 검사는 폐기형 로컬 D1 하나에서 0012의 45개 표와 합성 legacy job/event/dispatch를 유지한 채 0013을 적용한다. 모든 표를 실제 데이터로 채웠다는 뜻은 아니다.

검사한 범위:

- migration 끝 실패 rollback, 기존 45개 표의 모든 기존 열/합성 행 보존, 새 12개 표 초기 0행, 반복 apply 무변경, FK/quick check.
- v1 job 생성/진행/claim 차단과 기존 행 보존.
- request context/chunk/link/seal/event/dispatch/evidence 누락의 전부 rollback, 크기·참조 수·kind 오류, immutable UPDATE/DELETE/REPLACE.
- reserved attempt와 dispatch의 원자 claim, 만료 후 새 attempt, 옛 token/send 차단, send_started 뒤 retry 차단.
- receiver evidence/receipt/ack/job/event 누락과 instance/request/payload/wait mismatch rollback.
- step context와 receipt의 원자 link/seal, 잘못된 추가 claim, 자기 failure outcome/event/receipt/job 누락 rollback.
- terminal 이후 usage observation, nullable 수치·가격·시각·source exact 대조, call/usage/settlement 누락 rollback, 비용 한 번 기록, terminal job/receipt/outcome 불변과 결과 link 없음.

기존 generation 저장/adapter 5개 suite는 [setup](../workers/app/test/apply-migrations.ts)에서 명시적으로 0012까지 적용한다. 새 계약이 legacy 실행을 막으므로 당시의 v1 계약 회귀를 유지하기 위한 분리다. 이 테스트를 0013 위에서 기존 adapter가 작동한 결과로 세지 않는다. 나머지 Worker suite는 최신 migration을 사용한다. P5-43의 별도 Node 무DB 545건은 D1 검사와 구별한다.

P5-44a 최종 전체 `pnpm check` exit 0: unit 271 + Worker 1,718 = 1,989건과 build/필수 검사가 통과했다. 별도 무DB 545건 및 최종 D1 rehearsal 63항목도 통과했다. 63항목에는 기존 FK/index/유지 대상 trigger SQL 대조가 포함된다. 교정/재대기 미실행 항목은 그대로 남는다.

보존 결과는 [STATUS](STATUS.md)와 [HANDOFF](HANDOFF.md)의 P5-44 최신 기록이 정본이다. 최초 전체 check는 Wrangler SQL splitter의 `incomplete input`에서 중단했다. late usage 합성 fixture의 uncertain call 완료 시각 누락도 수정 후 재검사했다.

## 4. 완료 범위와 후속 연결 게이트

P5-44의 빈 물리 구조·guard·폐기형 upgrade rehearsal 범위를 완료했다. P40-G02 전체와 Phase 5는 진행 중이다. 저장 writer/reader·domain/실제 Workflow/provider·운영 적용은 완료 범위가 아니다.

- effect 전 재대기는 **receipt/call을 만들기 전** pending 또는 consumed-running command를 rejected로 닫는 경로다. parent wait/command는 필수이고 outcome parent step/attempt는 둘 다 NULL이다. 원래 context를 보존하고 허용된 같은-source 새 입력·새 wait·옛 신호 종료·job/event/evidence를 묶는다. 이미 claim한 실행의 현재성 상실은 no-call stale outcome으로 job을 닫을 수 있으며 자동 재호출하지 않는다.
- pure/domain_write의 만료 claim·retryable_failed 재claim, 단일 승자와 옛 attempt 차단을 확인했다. AI/source_network 재시도는 차단한다. effect 직전 input/content/metadata 현재성을 다시 검사한다.
- correction 성공과 별도로 intent analysis/critique·summary·child/adult의 합성 sealed content/current·call/usage/result/outcome/receipt/settlement 원자 묶음을 검사했다. known usage 뒤 stale/domain rejection은 결과 없이 한 번 정산하며 unknown/late usage는 기존 증거를 바꾸지 않는다. final_audit 정상 생성·비-AI artifact 성공은 G03 연결 전 검증했다고 주장하지 않는다.
- scope별 필수 증거 없는 종료·단계 건너뛰기·전이 reason/status 불일치·finish CAS 0행/metadata 변경·열린 실행을 차단한다. intent 시작은 P5-41/P5-43대로 transcript_review이며 resume_intent_review는 intent에서 finish, full에서 summary다. standalone correction은 자기 성공 후 종료하고 full command correction만 결과 batch에서 새 wait를 요구한다.
- 채워진 legacy content/current/reviews/final ticket/chunks/calls/usage/result/receipts를 별도 D1에서 보존했다. open receipt 충돌과 강제로 만든 dangling FK는 CHECK assertion에서 전체 rollback하며 schema/모든 원래 행·history가 동일하다. 신규 v1 실행/legacy call 승격은 차단한다.
- 기존 0000~0012와 journal은 보존했다. 이번 schema 변경은 `generation_wait_contexts_c2`의 실행 전 거부 parent 조합 하나이며 Drizzle 임시 재생성 결과를 검토해 미적용 0013 snapshot/SQL에 반영했다. 새 0014를 저장소에 만들지 않았다.

최종 폐기형 lifecycle D1 544항목 + populated upgrade 4항목, 별도 무DB 9 files/545건, 전체 pnpm check 1,989건(unit271+Worker1,718)·lint/typecheck/db:check·Worker/client build 및 공백·문서·보존 검사 통과. 숫자는 별도 검사 집합이며 DB 항목을 Vitest 수에 더하지 않는다. 구체적인 로그·Git 상태·중간 실패는 HANDOFF 9절을 따른다.

**P5-45 첫 연결 게이트:** P5-43 `exactReceipt`는 resume 수신의 `after.stage`를 다음 실행 단계로 대조하지만 `assessGenerationFinish`는 완료 prefix 항목의 단계와 같아야 한다고 검사한다. 실제 DB의 resume 증거와 완료 prefix를 그대로 연결하면 transcript/intent wait에서 정합화가 필요하다. 현재 무DB 545건은 주입 fixture 검사이고 저장 reader와의 통합 증명이 아니다. DB 이력을 덮어쓰거나 순수 판정을 우회하지 않고, 다음 P5-45에서 실제 저장 증거→순수 계약 통합 회귀를 먼저 추가해 해결한다. P5-41/P5-43 코드는 이번에 보존했다.

G03의 실제 authority/lineage·human 후속-head probe·nested final ticket·비-AI artifact/설정·선택·하드 게이트, G05/G06 실제 Workflow/provider/자원/보존은 계속 미구현이다. SQL fixture의 고정 hash/`{}`는 codec/domain 증명이나 발행 자격이 아니다. 현재 0013을 기존 v1 adapter와 함께 운영 DB에 적용하지 않는다.

## 5. P5-44b 대기 진입·pending 교정 명령 등록

기존 0013 후보에 trigger 5개를 보강했다. 표·열·index/FK의 변경은 없어 Drizzle schema/snapshot/journal은 그대로다. 기존 context seal, 지연 FK와 함께 다음을 검사한다.

- wait/context/request/evidence의 같은 소유권·종류·진입 version, job의 wait fingerprint·sealed link와 허용 scope. 열린 step이 있으면 wait 진입을 거부한다.
- correction context의 input/content/metadata/settings/selection/ticket 투영이 원래 wait와 정확히 같아야 한다. 현재 input/content head는 기존 context guard로 대조한다. 실제 설정/선택 권위와 payload 의미 검증은 여전히 G03/후속 reader 책임이다.
- pending command의 context를 봉인할 때 같은 command/context/wait/job version의 correction dispatch가 반드시 있어야 한다. 같은 command의 두 번째 outbox 생성도 차단한다. 명령 등록은 job version/대기를 바꾸지 않는다.
- 폐기형 D1에서 정상 wait·등록, 각 구성원 누락과 seal/job의 0행 변경, 잘못된 wait/version/request/fingerprint/입력, duplicate key/ordinal·두 번째 pending, wait/command 불변, intent/summary scope 및 원고/제공 요약본 교정 거부를 확인한다. 각 실패 전후 57개 표 전체 행을 대조한다.

합성 fixture는 SQL 구조 검사용 `{}` payload를 사용하며 도메인 의미가 검증된 context나 G03 입력 해석/의도 분석 전체 경로로 보지 않는다. 같은-key replay의 읽기 전용 writer/probe, 실제 병렬 consume, 성공 결과와 재대기는 이번 검사에 포함하지 않는다. 최종 검사·보존 수치는 STATUS/HANDOFF의 P5-44b 기록을 따른다.

P5-44b 최종: 기존 upgrade chain + D1 106항목(기존63+추가43), 무DB545건, 전체1,989건과 lint/typecheck/db:check/build·문서/보존 검사 통과. consume/resume 경쟁과 결과/재대기는 다음 P5-44c 이후 같은 부모에서 계속 검증한다.

## 6. P5-44c 대기 소비 경쟁

0013 후보의 trigger 5개를 추가했다. resume outbox는 현재 활성 wait/context/진입 version을 가리켜야 한다. 수신 receipt는 같은 wait/command/attempt와 wait 해제 evidence를 요구하며, 교정은 등록 당시 context의 input/content head와 metadata를 다시 대조한다. command running·dispatch ack·옛 resume stale·job running과 wait 해제·event/evidence 중 일부만 저장되지 않도록 연결했다. 같은 wait의 미소비 resume가 하나라도 살아 있으면 교정 job 전이를 거부한다.

D1에서는 다음을 추가 확인한다.

- 각 구성원 누락과 ack/command/옛 resume/job UPDATE 0행, 다른 wait/context/command/attempt·단계·해제되지 않은 wait를 거부하고 57개 표 전체 행을 보존한다.
- 교정 등록 뒤 input/metadata가 바뀐 batch는 `lifecycle_wait_receiver`에서 거부된다. 옛 resume 단독 stale도 수신/소비 증거 없이 저장되지 않는다.
- 교정 pending이 먼저면 resume는 실패하고 교정만 소비한다. 이미 send_started 후 uncertain인 resume도 같은 소비 batch에서 stale로 닫힌다. 이후 두 요청의 중복/지연 소비는 무기록이다.
- resume가 먼저 소비하면 뒤늦은 교정 등록/소비가 실패한다. 별도로 등록과 resume batch를 동시에 제출해 승자 하나와 상태를 검사한다. 교정과 resume 수신을 동시에 제출했을 때도 교정만 성공하고 provider call이 증가하지 않는다.

최종 기존 upgrade chain+D1 138항목(이전106+이번32), 무DB545건, 전체1,989건·lint/typecheck/db:check/build와 문서/보존 검사가 통과했다. input/metadata 변경은 지정한 guard 오류까지 대조했다. 상세는 STATUS/HANDOFF 최신 기록을 따른다. 동시성 검사는 폐기형 D1의 batch 직렬화이며 실제 Workflow/network 순서 보장이 아니다. resume의 허용된 입력 변경·intent/content lineage 전수 도메인 판정, 설정/선택의 실제 권위, 같은-key 읽기 전용 replay, result/usage/새 wait는 후속 범위다. schema/snapshot/journal·기존 adapter/runtime에는 변경이 없다.

## 7. P5-44d 교정 성공 결과·비용·새 대기

0013 후보에 trigger 3개를 추가했다. `lifecycle_correction_step`은 running command의 원래 sealed context와 소비 receipt/evidence·request·command ordinal 및 현재 input/content/metadata를 최초 claim에 묶는다. command 번호를 NULL로 빼거나 request predecessor로 우회할 수 없다. context를 다시 만들거나 봉인하지 않는다.

`lifecycle_correction_outcome`은 해당 correction step의 성공이 원래 command·effect_started receipt·proposal input version +1·content 유지와 다음 transcript wait를 함께 가리키도록 한다. `lifecycle_correction_wait`는 command succeeded의 정확한 outcome attempt/event/version·call/usage에 대응하는 실제 settlement 및 부모 wait/command/step을 확인하고, 새 wait가 원래 source/document/confirmation/content/metadata/settings/selection/ticket 투영을 유지하는지 대조한다. 이전 지연 FK·seal·job/event guard와 합쳐 결과만 저장하고 새 대기를 누락하는 batch를 차단한다. schema/snapshot/journal·기존 adapter/runtime에는 변경이 없다.

폐기형 D1에서는 다음을 검사한다.

- 기존 consume 성공 fixture에서 원래 context와 최초 receipt/link를 연결한다. 누락·잘못된 command/predecessor/context/첫 attempt·소비 후 metadata 변경은 전체 rollback한다.
- 합성 effect/call 예약 뒤 immutable usage observation을 먼저 남긴다. proposal·chunk/seal/input head·completed call/usage/result link·outcome/success receipt·settlement·command succeeded·새 wait context/chunk/parent/seal·job/event/evidence를 한 batch로 저장한다. 실제 provider 호출이나 자동 confirm/merge는 없다.
- 각 구성원의 누락, UPDATE 0행, 옛 claim token, 다른 attempt/parent wait/command/outcome/call/usage, nullable 수치의 0 치환, 다른 settings/selection/confirmation과 잘못된 wait fingerprint를 거부한다. 실패 전후 57개 표 전체 행을 비교해 원래 context·관측 비용·기존 기록을 보존한다.
- 정상 성공 뒤 비용은 7 micro-USD의 합성 관측 1건이며 제안은 input version 3, 새 wait는 generation 2다. job의 다음 event 6과 다른 source의 input head 5 뒤에도 자기 outcome이 참조한 event 5·evidence·result/실제 proposal/chunk·call/usage/settlement 전체 행이 동일하다. 중복 result 저장과 재claim은 거부한다.

최초 실패 주입에서 settlement statement 누락이 거부되지 않았다. 새 wait guard에 정확한 정산 행의 존재를 직접 요구해 이 누락을 지정 오류로 차단했다. 지연 FK만으로 정산을 보장한다는 가정은 채택하지 않으며, 전체 후보의 다른 guard 감사는 계속 미완료다.

최종 기존 upgrade chain+D1 213항목(이전138+추가75), 무DB545건, 전체1,989건·lint/typecheck/db:check/build 및 문서/보존 검사 통과. 세부 근거는 STATUS/HANDOFF를 따른다. SQL의 구조용 `{}` payload와 고정 hash는 도메인 codec 검증을 대신하지 않으며, 이 SQL 조회는 후속 production exact-own probe 구현이 아니다. effect 전 거부/재대기와 검토서 4절 잔여 범위는 다음 부모 P5-44에서 이어간다.

## 8. P5-44 잔여 범위 구현·실패 주입 결과

새 guard 17개와 기존 관련 guard를 보강했다. context seal은 현재 입력 전체 tuple와 content/current 참조·metadata를 대조한다. step scope/owner/effect·재claim, outcome reason/call/usage와 자기 append 차이, 최종 event의 정산 존재, terminal 시 열린 receipt/command/dispatch, pending 거부 재대기·stale command 종료를 검사한다. 완료 proof와 다음 stage 이동을 분리해 임의 stage_completed로 finish에 진입하지 못하게 했다.

최초 content 정상 경로의 구성원 누락 검사에서 `sermon_content_current` 누락이 성공했다. `lifecycle_success_delta`가 현재 head뿐 아니라 같은 실제 current 행도 요구하도록 보강해 해결했다. 단순 head 증가나 FK 존재만으로 전체 저장을 증명하는 접근은 폐기했다. 기존 d의 settlement 누락과 같은 이유로 최종 구성원 존재를 명시적으로 확인한다.

이번 중간 실패에는 Drizzle 절대 out 경로 해석, SQL splitter의 CASE 경계, SQL 괄호, UPDATE trigger의 `old` alias와 OLD pseudo-row 충돌, populated 스냅샷의 열 번호 정렬도 있었다. 상대 임시 생성 경로·명시 공백/구문 검사·별도 alias·원래 열 이름 정렬로 수정했다. 정상 경로만 추리는 임시 진단 실행은 최종 검사 수치에 포함하지 않는다. 최종 전체 rehearsal에는 누락/0행/변조/경쟁과 매 실패의 57개 표 전체 행 대조가 모두 포함된다.
