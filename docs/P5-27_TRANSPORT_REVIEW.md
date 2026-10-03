# P5-27 D1 BLOB 전송 검토 — 2026-09-15

## 결론과 범위

이번 하위 단계는 **검토와 로컬 호환성 검사**다. 제품 reader/writer/packed 코드의 전송 방식은 변경하지 않았다. 원격 조회·설정·배포·migration·실제 콘텐츠·commit/push도 없다. P5-23~P5-26 완료와 [직전 바이트 개선](P5-27_LOCAL_OPTIMIZATION.md)을 보존한다.

다음 후보는 **DB에서 돌아오는 chunk 응답만 hex 문자열로 투영**하는 로컬 실험이다. 쓰기 bind는 기존 ArrayBuffer 그대로 둔다. 전체 쓰기를 `unhex(?)`로 바꾸면 기존 bound-row 상한을 넘으므로 채택하지 않는다. 읽기 후보도 아직 구현·성능 계측하지 않았고 CPU 7/9ms 또는 isolate peak 96MiB 달성 근거가 아니다.

## 관측 근거

`workers/app/p5-27-transport-feasibility.test.ts`의 폐기형 로컬 D1 검사 3개가 통과했다. 숫자는 합성 자료뿐이며 원문/ID/hash/인증 정보를 수집하지 않았다.

| 검사 대상 | 관측값 | 해석 |
|---|---:|---|
| 64KiB, 0~255 반복 바이트의 JSON 숫자 배열 | 233,985 bytes | JSON 표현 크기이며 실제 네트워크 총량은 아님 |
| 같은 바이트의 JSON hex 문자열 | 131,074 bytes | 이 합성 입력에서 약44% 작음; CPU 감소율이 아님 |
| 기존 200,000-byte import mutation 계획 | 21 statements | 실제 준비된 계획을 실행 직전에 가로채 이력 쓰기는 0 |
| 기존 계획의 최대 statement bound 합계 | 69,768 bytes | 기존 상한 내 |
| 모든 ArrayBuffer bind를 hex로 바꾼 계획의 최대 합계 | 139,136 bytes | 기존 131,072-byte 상한 초과 |
| 기존 계획의 bound 총량 / 보수적 wire 추정 | 808,008 / 3,229,982 bytes | 기존 측정 함수 결과, 실제 전송량/CPU 아님 |

64KiB chunk 하나도 hex 본문만 131,072 bytes다. 여기에 식별자·claim 등 다른 bind가 붙는다. 여러 parameter로 문자열을 나눠도 statement의 총 bound 크기는 줄지 않는다. 상한 인상·chunk 계약 변경으로 우회하지 않는다. 변환 계획은 실행하지 않았으며, 원래 계획도 mutation batch 직전 중단 후 전체 history snapshot 불변을 확인했다. 테스트 준비용 metadata seed만 로컬에 썼다.

설치된 workerd의 `Uint8Array.toHex/fromHex`와 로컬 SQL `hex/unhex`는 빈 BLOB·0/255/128·전체 256 byte 값·64KiB·UTF-8 문자 중간 조각을 통과했다. 원격 호환성을 확인한 것은 아니다. 현재 TypeScript ES2023 lib에는 해당 native API 선언이 없어 테스트 안에서만 좁은 타입을 선언했다. 새 의존성은 없다.

## 보존해야 할 손상 탐지

SQLite `hex`는 BLOB 이외의 값도 변환한다. 로컬에서 BLOB `X'4142'`와 TEXT `'AB'`는 모두 `4142`, NULL과 빈 BLOB은 모두 빈 문자열이었다. **`hex(body)`만 받아들이면 기존 TEXT/NULL 손상 거부를 잃는다.** SQL `typeof(body)`와 원래 `length(body)`를 함께 투영하고, BLOB 타입·길이·정확한 hex 문법과 바이트 일치를 엄격히 검증해야 한다. 네 malformed hex 입력은 native decoder에서는 오류, SQL `unhex`에서는 NULL이었다. 동작 차이를 일반 문자열 강제 변환으로 숨기지 않는다. [SQLite 공식 함수 문서](https://www.sqlite.org/lang_corefunc.html), [D1 SQL 공식 문서](https://developers.cloudflare.com/d1/sql-api/sql-statements/).

## 다음에 제안하는 한 실험 — 아직 미구현

1. 로컬 격리 packed read와 own-attempt probe의 **chunk SELECT 응답**만 별도 private transport 경로로 바꾼다. 기존 raw D1 경로의 number-array 검증은 유지하며 임의 문자열 수용으로 넓히지 않는다.
2. `typeof(body)`, `length(body)`, `hex(body)`를 가져온다. reader는 엄격한 크기/타입/문법 확인 뒤 소유 byte 배열로 한 번 복원한다. own-attempt는 원래 기대 바이트의 canonical hex와 모든 바이트를 대조하고 metadata/행 수/순서/소속도 그대로 확인한다. hash-only 또는 probe 생략은 금지다.
3. INSERT·원래 bound verified·head/seal·CAS·원자 batch·H0/H1·전체 이력/hash/reference·실패/응답 유실 의미·query/SQL/bound/wire 상한은 바꾸지 않는다. 손상·응답 유실·충돌·20개 동시 회귀와 같은 로컬 profiler의 전후 비교를 요구한다.
4. 효과가 없거나 의미/예산이 달라지면 실험 변경만 철회하고 직전 바이트 개선은 보존한다. CPU 목표와의 큰 차이가 남으면 이를 설명하고 추가 설계 판단을 요청한다. 원격 220회를 자동 반복하지 않는다.

Production·공유 Preview DB·실제 콘텐츠·새 schema/migration·전체 runtime/Workflow/UI/API·checkpoint/staging/Paid·새 서비스/의존성·입력 계약 변경은 계속 제외한다. 원격 CPU 실패/peak 미측정은 [원격 보고서](P5-27_PREVIEW_MEASUREMENT.md) 그대로이며 P5-27/Phase 5는 진행 중이다.

## 검사와 재현

- 집중 검사: `pnpm exec vitest run --config vitest.worker.config.ts workers/app/p5-27-transport-feasibility.test.ts`, 3/3 통과. Vitest task metadata `transportReview`에 위 숫자 두 묶음을 남기며 기본 reporter는 이를 출력하지 않는다.
- 관측 로그: `/tmp/biblequiz-p527-transport-xPb9QT/review.log`, 숫자 전용 임시 reporter `reporter.mjs`. 로컬 테스트 DB는 테스트 런타임 종료와 함께 폐기했다.
- 첫 전체 검사에서 기존4files의9건이 시간 초과했다. 해당4files를 `--maxWorkers=1`로 재검사해135/135통과했으며 시간 제한/검증/제품 코드는 바꾸지 않았다. 기본 병렬 실행 안정성이 해결됐다는 의미는 아니다.
- 최종 `VITEST_MAX_WORKERS=2 pnpm check` exit0: unit262·Worker1,144건 및 정적 검사/격리fixture/lint/typecheck/build 통과. 파일 병렬 실행 수만2로 제한했으며 저장소 설정은 변경하지 않았다. 로그 `check-bounded.log`.
- 전체 검사·Git/문서 보존의 최종 결과는 [HANDOFF 최신 기록](HANDOFF.md#p5-27-2026-09-15-전송-검토-기록)을 따른다. 이번에는 새 CPU profiler·원격 계측·E2E를 수행하지 않았다.
