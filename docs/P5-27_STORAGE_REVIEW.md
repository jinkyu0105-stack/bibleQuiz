# P5-27 저장 설계 재검토 — 2026-09-15

## 0. D-031 확정과 적용 범위

사용자는 네 저장 축소 정책을 채택하고 `현재 수정본 1개+직전 2개` 자동 삭제는 폐기했다. 아래 1~6절은 그 결정 전의 저장 실체/후보 검토 기록이다. 당시 승인 범위·34-query·중복 저장 설명을 최신 구현 결과로 혼용하지 않는다.

| 승인 사항 | 이번 적용 상태 |
|---|---|
| 처음 가져온 자막은 원본만 저장, 실제 수정 때 수정본 추가 | 2026-09-16 로컬 변경 승인. 새 0009/private service에 구현. 기존 0008/이력은 보존 |
| 새 저장에 필요한 자료만 검사, 과거 전체 본문 검사 제외 | 새 명령별 경로에 구현. 일반 텍스트 자막 수정은 과거 본문0회, 시간 구간 자막/복원/AI는 해당 자료만 읽음 |
| 정상 성공 뒤 본문 재조회·비교 0회 | 기존 writer/grouped와 새 경로에 적용. 모든 statement의 정상 응답/예상 변경 행 수가 일치할 때만 생략 |
| diff는 요청한 두 본문만 그때 계산 | 새 내부 helper는 선택한 두 본문만 읽음. 저장 중 diff 계산 없음. 실제 UI/계산기는 미구현 |

정상 성공 분기는 [D1 batch의 원자 실행](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), [D1Result의 success/changes](https://developers.cloudflare.com/d1/worker-api/return-object/), 기존 원래 bound verified/seal 제약에 근거한다. 응답 누락·배열 빈 slot·불완전 meta·실제 행 수 불일치를 단순 성공으로 인정하지 않고 기존 자기 attempt 확인으로 보낸다. 응답 유실 뒤 다른 commit이 추가돼도 자기 기록만 확인하며 자동 재실행하지 않는다. 불확실할 때는 원래 자기 저장 건의 전체 byte 확인을 유지한다. 원격 성공/CPU 개선률을 추정하지 않는다.

**추가 승인/구현:** 2026-09-16 사용자는 로컬 저장 구조 변경·새 migration·합성 시험만 승인했다. [0009](../migrations/0009_sermon_input_selected_storage.sql)는 원본 자체를 현재 본문으로 식별하는 `events/chunks/heads` 세 private table과 원자성/불변/같은 설교의 기존·새 head 배타 제약을 추가한다. 기존 [0008](../migrations/0008_phase5_private_sermon_history.sql)을 고치거나 가짜 초기 수정본/부분 전체-state로 우회하지 않는다. [새 service](../workers/_shared/services/sermon-input.ts)와 [store](../workers/_shared/repositories/sermon-input-store.ts)는 runtime 비연결이다. 기존 DB 자동 변환·새 형식 전체 audit·downstream intent/summary/candidate 연결·checkpoint/staging·전체 runtime/Workflow/UI/API·원격 변경은 하지 않았다.

새 경로는 본문 JSON을 TEXT 조각으로 저장해 BLOB→숫자 배열 변환을 피한다. 최초 원본1개, 실제 수정마다 본문1개이며 head는 version 숫자만 가진다. 일반 텍스트 자막 수정은 head metadata만 읽어 출처/수정 허용/현재 version을 확인하고 새 입력을 검사한다. 시간 구간 자막은 원본 시간/ID, 복원은 지정 본문, AI 교정은 해당 바탕/제안/결정만 읽는다. 출처 원고/요약본의 수정·복원·AI 제안/결정/병합은 service와 DB에서 차단한다. 새 경로에 원래 bound 전체 재전송 검사는 없으며 SQL seal은 자기 조각 수/길이·참조/head 전이를 지킨다. 불확실한 응답만 자기 metadata/모든 TEXT 조각의 정확 일치로 증명한다.

원본/수정 이력의 기존 데이터는 삭제하지 않는다. 3개 보관 cap을 후속 후보로 남기지 않는다. 기존 7일 초안 정리·source별 보존 조건과 D-030 정책은 유지한다. 검사 결과와 정확한 다음 작업은 STATUS/HANDOFF에 기록하며 P5-27/Phase5는 미완료다.

2026-09-16 로컬 구조 검사: 전형1KiB/경계200,000-byte 각100회에서 import와 edit 각각 SQL5/6개, 성공 후 본문 재조회0을 확인했다. 20개 같은 version 동시 저장은 단일 승자, 누락 seal/chunks/head는 전체 rollback, 응답 유실 뒤 후속 저장이 있어도 자기 attempt만 확인했다. 기존 24개 table/합성 데이터의 0009 전후 보존·반복 migration no-op/FK/quick_check를 통과했다. 전체 검사 최종 결과는 STATUS/HANDOFF를 따른다. 원격 CPU/메모리 측정은 이번에 하지 않았고 기존 P5-27 JSON은 그대로다.

직전 2026-09-15 검증 기록: 집중5files/142건과 전체 unit262/Worker1,155를 통과했다. 당시 200KB import는 SQL7+21+0=28(이전34), batch3회였다. 새 경로의 SQL6개와 과거 원격CPU 숫자를 같은 구현의 측정으로 섞지 않는다.

> 후속 확정 정책(D-030): **설교 자막만 수정·교정 가능**하며 목사님 제공 설교 원고·요약본은 받은 그대로 사용한다. 아래 저장 개수/수정 경로는 정책 반영 전 코드의 관측이지 세 종류 모두 수정 가능한 제품 계획이 아니다. 새 로컬 경로에 차단을 구현했으며 기존 경로는 보존했다. `원고`를 입력자료 전체의 통칭으로 사용했던 설명은 부정확했다. 과거 원격200KB 자료는 실제 원고가 아니라 `sermon_summary`로 지정한 합성 텍스트였다.

## 1. 승인과 판단

사용자는 기존 저장 방식을 고수하지 않고 월 USD 0 목표와 원고/수정 이력을 보존하는 **저장 부분의 재검토**를 승인했다. 이번은 코드·DB 구조·원격 설정을 바꾸는 승인이 아니다. 기존 hex 응답 미세 개선 실험을 다음 첫 작업으로 자동 실행하지 않고, 아래 구조 후보를 먼저 판단한다. P5-23~P5-26 완료 기록과 P5-27의 기존 개선/실패 근거를 보존한다.

문제는 수천 개의 원고나 동영상 때문에 저장 공간이 찬 것이 아니다. 빈 이력에 약200KB 합성 원고 하나를 넣을 때도 실행이 중단됐다. 저장되는 내용 자체보다 **같은 내용의 복사·직렬화·전송·원래 값 대조와 누적 이력의 전체 재검증**이 현재 처리 구조에서 비용을 만든다. 정확한 원격 CPU 기여율은 미확정이다. 원격 수치에는 합성 입력 준비와 계측 wrapper도 포함되므로 이를 순수 저장 코드 CPU로 단정하지 않는다.

## 2. 무엇을 저장하는가

8개 논리 이력 종류는 다음과 같다. 모든 종류를 저장 버튼마다 한꺼번에 추가하는 것이 아니다.

| 종류 | 사용자 관점의 의미 | 추가되는 때 |
|---|---|---|
| sources | 처음 가져온 원고/자막 원본과 출처 정보 | 새 원고 가져오기 |
| revisions | 수정·복원·교정 반영 후의 작업본 전체 | 현재 코드는 모든 입력자료 가져오기/수정을 허용. D-030 이후 수정은 자막만 허용해야 함 |
| confirmations | 누가 어느 작업본을 확정했는지 | 사람의 원고 확정 |
| correctionProposals | 교정 제안 묶음 | 제안 등록 |
| correctionDecisions | 제안의 수락/거절 묶음 | 사람의 항목 결정 |
| intentEvents | 설교 의도 분석·수정·선택·확정 이력 | 해당 작업 |
| summaryEvents | 요약 생성·수정·복원·검수 이력 | 해당 작업 |
| candidateEvents | 어린이/장년 문제 후보와 선택·검수 이력 | 해당 작업 |

제목·날짜·장절 등의 비공개 metadata는 별도 저장 부분이다. 배치/발행 결과·AI 최종 감사·job/Workflow 영수증은 이 8개 stream에 구현돼 있지 않다. 동영상/음성 파일이나 성경 본문 전문을 저장하는 시험이 아니다. 현재 저장 adapter는 공개 runtime에 연결되지 않았고 시험 자료는 합성 데이터다.

### 실제 원격 시험의 첫 원고 하나

ASCII `x` 200,000개인 약200KB 원고를 처음 넣었다. 원본과 초기 작업본의 본문 내용이 같지만, 출처·수정 관계 등의 metadata가 다른 별도 JSON 원소로 각각 저장된다. 본문만 약400KB이며 JSON metadata가 추가된다. 200,000글자의 한글 원고나 실제 주간 평균 크기를 뜻하지 않는다.

| 물리 표 | 역할 | 정상 저장 후 행 수 |
|---|---|---:|
| sermon_history_commits | 이번 저장 한 건의 완료/버전 정보 | 1 |
| sermon_history_records | 원본 1개·작업본 1개의 목록/순서 | 2 |
| sermon_history_payloads | 각 내용의 길이·조각 수·검증 정보 | 2 |
| sermon_history_chunks | 원본 4조각·작업본 4조각의 실제 내용 | 8 |
| sermon_history_references | 작업본이 어느 원본에 속하는지 | 1 |
| sermon_history_heads | 지금 사용할 원고/버전의 위치 | 1 |
| **합계** | **내용 조각 8 + 관리 기록 7** | **15** |

6개 표는 설교마다 새로 만드는 것이 아니라 공유하는 표다. 15행은 합성 metadata seed/이미 있는 sermon 행을 제외한 history 행 수이며 원고 15개라는 뜻도 아니다. 64KiB(65,536bytes) 이하로 자르므로 원고 길이·JSON escaping·metadata에 따라 조각 수는 달라진다. 위 수치는 [원격 동시 시험의 정상 commit 결과](P5-27_PREVIEW_MEASUREMENT.md) `[1,2,2,8,1,1]`와 일치한다.

### 수정할 때 늘어나는 양

현재 manual edit/restore/merge는 변경된 글자만이 아니라 **변경 후 원고 전체**를 revision 하나로 새로 보존한다. 기존 원본·작업본을 덮어쓰지 않는다. 따라서 같은 원고를 가져온 뒤 수동 수정 저장10회를 했다고 가정하면 원본1 + 초기 작업본1 + 수정본10 = 본문 포함 논리 원소12개다. 모두 약200KB라면 본문만 약2.4MB이며 metadata/관리 행은 별도다. 이는 코드에서 산출한 예시이지 새 실측이 아니다. 키 입력마다 자동 저장하는 UI를 구현했다는 뜻도 아니다.

확정만 하는 명령은 본문 복사 대신 confirmation 한 개를 추가한다. 보통 명령은 새 논리 원소1개, import만 source/revision2개를 추가하며 이전 전체 이력을 DB에 다시 INSERT하지 않는다. 대신 다음 절처럼 이전 전체를 **읽고 메모리에서 검사**한다. 로컬 안전 상한은 설교 이력별64회 commit·128개 논리 원소·8MiB payload·256조각 등이고, 이 상한까지 무료 운영을 보증한 것은 아니다.

## 3. 저장 한 번이 비싸진 이유

현재 packed 경로는 다음을 수행한다.

1. 같은 설교의 기존 원본/수정본/분석 등 전체 이력을7개 SQL로 가져온다. 7은 고정이지만 돌아오는 내용량은 이력과 함께 증가한다. 다른 모든 설교를 함께 읽는 것은 아니다.
2. 전체 내용의 형식·checksum·참조·확정 자격을 검사하고 명령을 처리한다. store DB read 중복은 이미 줄였지만 service는 여전히 전체 상태를 요구하고 writer는 next snapshot/prefix/reference를 검사한다.
3. 새 원소만 JSON/UTF-8로 만들고 조각별 및 전체 checksum을 계산한다. 원본/초기 작업본처럼 내용이 같아도 별도 원소이므로 각각 처리한다.
4. 새 행을 INSERT하고, 원래 bound 값을 다시 보내 verified UPDATE로 저장 값과 exact 대조한 뒤 head/seal을 같은 원자 batch에서 처리한다. checksum만 대조하는 것으로 대체하지 않는다.
5. 정상 batch 응답이 있어도 자기 attempt의 새 내용/관계 전체를6개 SQL로 다시 받아 바이트까지 대조한다. 응답 유실 시 남의 성공을 자기 성공으로 오해하지 않는 기능도 같은 경로가 담당한다.

200KB import의 counter가 있는 원격 표본에서는 **읽기7 + 저장/검증21 + 결과 확인6 = SQL34개**였다. SQL34개는 HTTP 왕복34회나 저장 행34개가 아니다. 로컬 tracker의 batch 배열은 `[1,6,21,6]`에 해당한다. 예산 내 query 개수라도 복사/JSON/비교 CPU와 메모리를 보증하지 않는다. 원격 중단50건에는 counter가 없어 전체220건의 query 통과로 쓰지 않는다.

직전 [전송 검토](P5-27_TRANSPORT_REVIEW.md)의 같은 크기 로컬 준비 계획은 bound 총808,008bytes와 보수적 wire 추정3,229,982bytes였다. 이는 원본+작업본 내용을 쓰기/verified 두 번 bind하는 효과를 포함한다. 실제 네트워크 사용량·DB 파일 크기·메모리 peak가 아니며 응답 전송량을 포함한 종합 실측도 아니다.

## 4. 권장 재설계 후보와 유지 조건 — 미채택

새 설계는 자막의 편집 이력과 목사님 제공 원고·요약본의 읽기 전용 입력 경로를 구분한다. 원고·제공받은 요약본에도 편집용 작업본/수정 이력이 필수라는 전제를 제거한다. 기존 초기 revision/물리 사본을 어떻게 호환·참조할지는 상세안에서 정하며 기존 이력을 지금 삭제하거나 포맷을 변경하지 않는다.

단순 hex 전송 최적화만 주 작업으로 반복하지 않는다. 다음 **두 축을 함께** 다루는 저장안의 상세 설계를 권장한다.

| 축 | 바꾸려는 일 | 보존할 것 / 주의점 |
|---|---|---|
| 현재 작업에 필요한 정보만 읽기 | 버전이 붙은 현재 상태와 해당 명령에 필요한 원고·근거만 읽고, 과거 전체 검사/복원은 별도 경로로 분리 | 원본·이력 삭제 없음. DB의 작고 검증된 현재 상태와 필요한 참조를 원자적으로 유지해야 함. 과거 무관한 손상 발견 시점이 달라지는 정책을 명시해야 함 |
| 같은 본문은 한 번 보관하고 논리 기록에서 참조 | 최초 원본과 작업본은 별도 기록을 유지하되 동일한 immutable 본문을 공유; 복원 시 같은 내용의 재복사도 줄일 후보 | 출처·작업 checksum/순서/행위자/검수는 합치지 않음. 단순 hash 일치만으로 원래 바이트 대조를 생략하지 않음. 서로 다른 수정본은 별도 내용으로 보존 |

본문 공유만으로 모든 수정본의 중복이 사라지지는 않는다. 한 글자 바뀐 원고를 변경분만 저장하는 방식은 재조립·긴 복원 사슬·손상 전파를 추가하므로 이번 1순위로 채택하지 않는다. 최신 원고로 기존 기록을 덮어쓰거나 과거 이력을 버리는 안도 채택하지 않는다.

**현재 상태만 읽는 안은 첫 import의 비용을 해결하지 않는다.** 따라서 첫 원고의 중복 본문과 원래 bound 검증/정상 응답 뒤 재조회 경로도 함께 설계해야 한다. 기존 exact verified/seal 증명을 유지하면서 응답 확인을 작은 영속 영수증으로 대체할 수 있는지는 별도 증명이 필요하다. 지금 probe를 삭제하거나 `success=true`/head/hash만으로 성공을 인정하는 변경은 하지 않는다.

새 private 물리 구조/codec·내부 command용 port가 필요할 수 있다. 현재 `TranscriptRevisionStore`는 전체 state를 읽고 반환하는 인터페이스라 DB 쿼리만 줄여서는 전체 clone/검증 비용이 남는다. 공개 UI/API 전체나 Workflow를 구현하지 않고 이 저장 내부 계약을 먼저 설계할 수 있으나, 코드를 바꾸는 범위와 검증을 확정하기 전 구현하지 않는다. 현재1MiB 입력 계약·보존 기간·사람 검수·수정 후 무효화 정책은 임의로 낮추거나 변경하지 않는다.

## 5. 다음 한 작업과 중단 기준

다음은 같은 **P5-27 저장 재설계 상세안**이다. 위 두 축의 물리 참조/원자 저장/현재 상태 검증/손상·복원·응답 유실 계약과 내부 port 변경을 문서로 확정하고, 작은 로컬 feasibility 실험의 포함·제외 범위를 함께 제안한다. 사용자의 이번 승인을 schema/migration 생성·적용이나 설계 후보 채택으로 확대하지 않는다.

구현 승인 뒤의 첫 실험은 전체 adapter 교체가 아니다. 새 원고 최초 저장과 같은 원고를 여러 번 수정한 뒤 다음 저장을 분리해, 복사/전송/검증 대상 바이트·query·전체 상태 재구성 여부와 원자성/응답 유실을 확인한다. 최초 큰 입력 실패는 이력 길이 최적화로 해결됐다고 쓰지 않는다. 작은 실험도 유망하지 않으면 다른 미세 최적화를 줄줄이 반복하지 않고 무료 목표/입력 규모/실행 분할 등의 선택을 다시 설명한다. Paid·새 서비스·staging·Workflow 도입은 이번 승인에 포함하지 않는다.

원격CPU p95≤7ms/최대≤9ms·query≤40·isolate peak≤96MiB·기존 의미 회귀 목표는 유지한다. 새 설계가 통과할지는 미확정이며 memory 측정 방법도 별도 미해결이다. 기존 원격 시험은 원복/합성DB 삭제 완료 상태 그대로다. P5-27/Phase5 진행 중, 새 번호 없음.

## 6. 코드/검사 근거

- [stream/record 저장](../workers/_shared/storage/history-record.ts), [원본·수정·확정 service](../workers/_shared/services/transcript-revisions.ts), [64KiB codec](../workers/_shared/storage/history-json-codec.ts)
- [writer의 새 원소·원래 bound 검증·자기 attempt 확인](../workers/_shared/repositories/sermon-history-writer.ts), [packed 전체 이력 read](../workers/_shared/repositories/sermon-history-packed-spike.ts), [기존 grouped 검사](../workers/app/sermon-history-free-spike.test.ts)
- [원격 계측](P5-27_PREVIEW_MEASUREMENT.md), [로컬 개선](P5-27_LOCAL_OPTIMIZATION.md), [전송 검토](P5-27_TRANSPORT_REVIEW.md), [기존 자원 상한](P5-24_RESOURCE_ENVELOPE.md), [P5-25 선행 대안](P5-25_FREE_EXECUTION_ARCHITECTURE.md)

이번에는 문서/코드/기존 숫자를 읽어 대조했으며 새 DB 시험·성능 계측·pnpm check·E2E는 실행하지 않았다. 문서만 변경하므로 공백/링크/원본 보존을 검사한다. 직전 `VITEST_MAX_WORKERS=2 pnpm check`의unit262/Worker1,144 통과를 이번 재실행으로 표시하지 않는다. Production·실제 콘텐츠·코드/schema/migration·원격 조회/설정/배포·commit/push 변경 없음.
