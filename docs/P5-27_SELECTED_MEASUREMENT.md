# P5-27 — 선택 저장 경로 Preview 계측 (2026-09-16)

## 결론

D-031 저장 축소 후 큰 입력의 CPU가 크게 줄었고 두 trial 모두 저장 실패/CPU 강제 종료 없이 끝났다. 그러나 **CPU p95≤7ms/최대≤9ms는 미통과, isolate peak≤96MiB는 미측정**이다. P5-27/Phase5는 진행 중이다. 측정 도구를 반복 실행하는 대신 남은 최초 요청 비용과 메모리 측정 인증을 좁혀야 한다.

## 승인·대상·보존

- 사용자 `진행하세요 승인합니다`에 따라 기존 Access 보호 `biblequiz-app-preview`의 임시 standalone 진입점, 폐기형 합성 D1, 기존0000~0009 SQL 구조 재현, 로컬 service binding 수동 호출, 숫자 tail, 원래 version 복구/임시 DB 삭제만 실행했다. 새 schema/migration을 만들거나 공유 D1에 적용하지 않았다.
- 공개 호스트/임의 본문 요청은 거부하고 내부 합성 profile/index만 받는다. 실제 콘텐츠·AI 요청·전체 runtime/Workflow/UI/API·Production·Access 변경·secret·Cron·도메인·Paid·checkpoint/staging·새 영구 서비스·commit/push는 없다.
- 0000~0009 원문을 `scripts/p5-27-prepare-selected.mjs`로 합친 파일을 빈 임시 DB에 `--file`로 재현했다. 새3 tables·3 indexes·10 triggers, FK/quick_check를 확인했다. 이는 **정식 migration ledger 완료가 아니다**. 0008 `--command` 문제를 숨기거나 SQL 정본을 수정하지 않았다.
- 최초 trial은 새 저장 경로 자체, r2는 검증 함수를 그대로 두고 불필요한 하위 AI/이력 schema 초기화 연결을 분리한 경로다. `transcript-input-contract.ts`/`transcript-content.ts`로 공통 정의를 옮겼으며 기존 API 재export와 실패 코드는 보존한다. 배포 bundle은 605.39→586.21KiB, startup 표시값은 35→33ms다. startup 표시값을 요청 CPU로 환산하지 않는다.
- P5-23~P5-26 기록·0000~0009·이전 측정JSON·기존 미커밋 변경은 보존한다. 수정본3개 자동 삭제는 계속 폐기다.

## 조건과 모든 표본

원격 실제 작업은 **새 원본 import**다. 전형23-byte 100회, 경계200,000-byte 100회, 같은 설교/expectedVersion0 동시20회이며 합성 본문 준비/hash도 invocation 안에 포함했다. edit/AI/timed 입력/누적 이력 전체의 원격 성능 증명이 아니다. 각 trial은 새로운 빈 D1을 사용했고 자동 replay는0이다. 느린 표본/처음 관측한 표본을 제외하지 않았다. p95는 정렬 후 `ceil(n×0.95)`번째다.

| trial / 조건 | 요청 | 저장 성공 / 충돌 | CPU p95 / 최대(ms) | query 최대 |
| --- | ---: | ---: | ---: | ---: |
| 최초 / 전형 | 100 | 100 / 0 | 10 / 13 | 5 |
| 최초 / 200KB | 100 | 100 / 0 | 8 / 10 | 6 |
| 최초 / 동시 | 20 | 1 / 19 | 5 / 5 | 7 |
| r2 / 전형 | 100 | 100 / 0 | 7 / 13 | 5 |
| r2 / 200KB | 100 | 100 / 0 | 8 / 15 | 6 |
| r2 / 동시 | 20 | 1 / 19 | 7 / 7 | 7 |

[최초220개](P5-27_SELECTED_MEASUREMENT.json), [r2 220개](P5-27_SELECTED_MEASUREMENT_R2.json). 실행 시간은 각각66.561초/57.086초다. 양쪽 모두220 CPU 표본, 누락/중복/truncated/exception/CPU 초과/메모리 초과 응답0이다. 메모리 초과 응답0은 메모리 peak 통과 증명이 아니다. query는 batch 호출 수가 아닌 실제 prepared SQL 수다. 동시 패자19건은 `INPUT_CONFLICT`이고 transport/probe 실패는0이다.

이전 [2026-09-15 기록](P5-27_PREVIEW_MEASUREMENT.md)의 전형/경계/동시 p95 28/338/348ms, 최대49/440/394ms, CPU 초과46건과 구분한다. 새 경로는 이력 중복/전송 구조가 달라 직접 함수별 인과 실험은 아니지만, 동일 크기의 새 원본 저장에서 큰 감소를 관측했다.

## 남은 CPU와 메모리

- 숫자 isolate marker의 **처음 관측한 요청**과 이후 요청을 나누면 최초 trial은18/202건, r2는17/203건이다. 최대9ms 초과는 각각10/6건으로 모두 처음 관측한 쪽에 있다. 이후 요청은 p95/최대가6/9ms, 7/9ms다. 이것은 초기화 비용을 좁힐 단서이지 진짜 cold start 원인 확정이나 gate 통과가 아니다. 합격 판정에는 처음 요청도 포함한다.
- r2에서 불필요한 schema 연결 제거는 확인했지만 최대 CPU는 개선되지 않았다. 지역도 첫 trial NRT, r2 HKG로 달라 작은 차이의 원인을 코드 하나로 단정하지 않는다. 같은 suite의 무변경 반복·warm-up 제외·목표 완화로 통과시키지 않는다.
- 표준 remote dev inspector를 시도했으나 Access가 보호한 도메인에 service-token 인증이 없어 비대화형 연결이 거부됐다. 인증 파일/토큰을 추출하거나 Access를 끄지 않았다. 원격 isolate peak는 `null`이다. 동시20개도 각각11/12개의 관측 marker에 분산되어 같은 isolate에20개가 배치됐다는 근거가 없다.
- 공식 [메모리 지표](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/#memory-usage)와 [메모리 진단](https://developers.cloudflare.com/workers/observability/dev-tools/memory-usage/)의 시점·percentile 수치만으로 이 실행의 정확한 peak를 대신하지 않는다. 후속은 인증된 진단 연결의 가용성과 peak 관측 방법부터 확인하며 새 인증 정책/자격 증명 생성은 별도 범위 제시 없이 하지 않는다. 사용자에게 비밀값을 채팅으로 요구하지 않는다.

## 저장 의미와 원복

두 DB 모두 최종 head는 전형100+경계100+동시1, source/sealed event201개다. 동시 대상은 head1/event1/chunks13, 기존 history head0, FK 위반0, quick_check `ok`다. 가짜 최초 수정본/충돌 패자 기록/자동 재실행이 없다. D-030 편집 차단, stale version·불확실 응답·원자 rollback 등은 별도 로컬 회귀가 근거이며 원격 import 계측으로 전부 입증했다고 주장하지 않는다.

| 구분 | 최초 | r2 |
| --- | --- | --- |
| 임시 version | `7ef2476b-eb2e-477a-9ac9-cbd63df655bc` | `51b8a2fe-4783-4a21-a8bb-170f0e5311b1` |
| 임시 D1 | `ec15c91d-75dd-43ad-b805-fd83c841a6d8` | `45ecfef7-73c7-46e3-b86b-e446d5e171ac` |
| 종료 | 원복 후 영구 삭제 | 원복 후 영구 삭제 |

각 trial 뒤 원래 Preview `fc10f77d-ca54-4dfd-a94a-9fb3cffcf482` 100%와 공유 D1 `cb044032-7e26-452b-afae-b0cae3d93678`로 복구했다. 내부 health200/외부 Access302, 공유 migration0007/0008/0009 대기를 확인했다. 임시 DB의 합성 데이터는 영구 삭제되어 복구할 수 없으며 숫자 근거만 남긴다. 계측 version은 비활성 기록으로 남고 임시 로컬 trigger/tail은 종료했다. 계측 설정의 D1 ID는 삭제된 대상이므로 재사용하지 않는다.

## 검사·재개

관련4 files/333건과 lint/typecheck가 통과했다. 전체 검사 도중 r2 이름으로 바뀐 probe의 테스트 기대값3건을 바로잡았고, 별도 실행에서는 살아 있는 Wrangler dev의 임시 bundle이 lint에 잡혔다. 서버 종료로 임시 파일을 정리했으며 lint 규칙/timeout을 완화하지 않았다. 최종 `VITEST_MAX_WORKERS=2 pnpm check` exit0: unit262+Worker1,377=1,639건, 정적 검사·lint/typecheck·로컬 build 통과. 기존305개 중 의도한9개만 변경하고296개해시동일·신규9/삭제0, 링크/anchor132개·440표본요약일치·공백검사를 확인했다. 상세는 [HANDOFF](HANDOFF.md#9-git보존폐기한-접근)를 따른다. UI 변화가 없어 브라우저 E2E는 실행하지 않았다.

다음 한 작업은 P5-27의 **처음 요청 CPU를 구분하는 로컬 진단과 원격 메모리 인증 연결 확인**이다. 같은220회 원격 시험을 자동 재개하지 않는다. 새 경로의 모든 명령/큰 timed·교정 입력/응답 유실에 기존 P5-24 한도가 그대로 적용된다고 주장하지 않으며 해당 자원 경계도 후속 검증으로 남긴다. 새 형식 전체 audit·downstream·기존 데이터 변환·운영 연결은 이번 완료 범위가 아니다.
