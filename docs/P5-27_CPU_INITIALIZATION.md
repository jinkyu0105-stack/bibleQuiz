# P5-27 첫 요청 초기화·중복 UTF-8 변환 개선 — 2026-09-16

## 변경과 안전 경계

이 작업은 D-031 저장 경로의 CPU 개선이다. 입력 계약·보존 정책·SQL·0000~0009·CAS/봉인·정상 성공 후 재조회 생략·불확실한 자기 저장 건 확인을 변경하지 않는다. P5-23~P5-26 완료 기록과 이전 계측 JSON은 그대로 보존한다.

- `prepare-input-schema.ts`는 기존 동기 입력 schema의 object/union/array/nullable/optional 그래프를 공개 Zod API로 한 번 순회한다. 필수 필드 없는 빈 객체를 거부하는 경로로 object 키와 action/format 분기를 초기화한다. 입력 schema 자체를 교체하거나 정상 요청의 검사를 생략하지 않는다. 유효한 가짜 원본·DB/HTTP 예열·합성 저장은 실행하지 않으며 `_zod` 변경, eval, 전역 Zod 설정, 새 의존성도 없다.
- 이 helper는 현재 필수 필드를 가진 비공개 schema 전용이다. 빈 객체를 허용하는 object면 시작 시 오류로 닫는다. 임의 refinement/transform/lazy schema를 위한 범용 컴파일러가 아니다. 순수 검사 규칙 준비 비용을 첫 요청에서 시작 시점으로 옮기므로 비용 제거로 표현하지 않는다.
- 수동 입력은 텍스트의 바이트 길이 확인에 사용한 UTF-8 배열을 SHA-256 계산에도 사용한다. 저장 JSON도 길이와 해시에 같은 배열을 사용한다. 서로 다른 원문/저장 JSON 해시를 합치지 않고, 정규화·절단·검사 결과의 요청 간 캐시도 하지 않는다.
- 메모리 문자열과 Zod 복사는 계속 필요한 경계에 남는다. 유효 입력마다 한 번만 인코딩한다는 새 검사는 수동 prepare/verify와 실제 저장 JSON을 각각 확인한다.

설치 Zod4.4.3의 두 object parser가 첫 parse에서 키를 준비하는 코드를 확인했다. [공식 공개 schema API](https://zod.dev/api?id=shape)와 [safeParse](https://zod.dev/basics?id=parsing-data)를 사용하며, 현재 설치되지 않은 `z.compile()`이나 라이브러리 업그레이드는 도입하지 않는다.

## 로컬 비교

[숫자 근거](P5-27_CPU_INITIALIZATION.json). 이전 원본 bundle과 최종 변경 bundle을 각각 새 isolate6개에서 측정했다. 전형23-byte/경계200,000-byte는 새 isolate3개씩, 처음1회+이후4회다. 각 묶음에는 같은 isolate 동시20개 경쟁도 포함하므로 묶음당50개 요청이다. 기존 profiler에 이전 bundle 입력과 bundle SHA-256/로컬 준비 wall time 기록만 추가했다. 첫 요청·느린 표본은 모두 포함한다.

| 첫 요청 활성 CPU 표본 수 | 이전 코드 | 최종 코드 |
| --- | --- | --- |
| 전형, 새 isolate3개 | 31 / 32 / 31 | 24 / 24 / 26 |
| 200KB, 새 isolate3개 | 48 / 46 / 41 | 37 / 42 / 38 |

활성 표본은 V8 CPU profiler의 idle/program 이외 표본이며 GC를 포함한다. 표본 수를 Cloudflare 청구 ms로 환산하지 않는다. 로컬 준비 wall time도 프로세스/서버 초기화를 포함하며 플랫폼 startup CPU가 아니다. 개선 방향의 소표본 근거이지 원격 p95/최대 통과는 아니다.

중간형은 빈 객체 대신 undefined로 object를 준비해 generic parser 초기화가 남았고 lint와 실행이 일부 겹쳤다. 해당50개 결과도 JSON에 별도 보존하며 최종 비교에 섞지 않는다. 최종형은 필수 필드가 빠진 빈 객체를 사용해 두 parser를 준비하고 다른 검사와 겹치지 않게 재측정했다. 최종형50개 모두 정상/동시1승자19충돌·query5/6·외래키 검사를 통과했다.

코드가 변경됐으므로 D-032 로컬 메모리 시험도 최종 코드로 다시 수행했다. 전형 독립20개·200KB 독립20개·같은 version 경쟁20개를 각각3회, 총180개에서 모두 통과했다. 상세 구성요소와 모든 시점 표본은 JSON에 보존한다. 정확한 원격 순간 최대 메모리로 표현하지 않는다.

## 원격 단계

명시적 재승인 뒤 폐기용 DB 두 개에 기존0000~0009 원문만 재현했다. 공유 Preview DB·정식 migration ledger·Production은 변경하지 않았다. 원래 version은 `fc10f77d-ca54-4dfd-a94a-9fb3cffcf482`, 공유DB는 `cb044032-7e26-452b-afae-b0cae3d93678`다.

첫 version `e23731a9-b42b-4a43-83ed-89a76c1cc1ae`의220건은 저장/경쟁은 정상이나 CPU를 전부 수집하지 못했다. 원인은 계측 명령에서 Worker 이름과 env를 함께 지정해 존재하지 않는 `-preview-preview`를 조회한 오류다. pipefail 없는 pipeline의 exit0도 성공으로 오인했다. 이220건을 CPU 통과로 세지 않으며 원본 응답/DB검사를 JSON에 별도 보존한다. tail 명령은 위치인자 없이 config/env만 사용하고 pipefail을 켠다. 실행기는 정확한 기대version의 읽기 전용 ready 응답과 온전한 CPU tail이15초 안에 확인돼야 저장을 시작하도록 수정했다.

최종 version `ef7039b8-734b-4c5f-b096-da8e2946c659`는 KST18:01:09.844~18:02:22.696에 실행했다. 각100회 및20개동시를 실제 시행했고 응답220개와 tail220개가 profile/index로 일대일 일치한다. 첫 요청과 느린 표본도 모두 포함했다.

| 상황 | 결과 | query 최대 | CPU p95 | CPU 최대 |
| --- | --- | --- | --- | --- |
| 전형100개 | 100성공 | 5 | 7ms | 12ms |
| 200KB100개 | 100성공 | 6 | 10ms | 15ms |
| 같은 설교20개동시 | 1성공·19충돌 | 7 | 10ms | 13ms |

**CPU 목표 p95≤7ms/최대≤9ms는 미통과다.** 원격예외/CPU강제종료/잘린tail/수집누락/자동재시도는0이다. 첫 실제 요청4ms만으로 개선 성공을 주장하지 않는다. 전체 원격분포의 개선을 입증하지 못했다. 9ms초과10개 중6개는 관측marker의 첫 요청이 아니므로 초기화만 원인이라고 단정할 수 없다. marker16개는 임의 관측표식이며 정확한 isolate 식별을 보증하지 않는다. 원인 확정 없이 무변경220회나 같은 profiler를 다시 실행하지 않는다.

최종DB heads/events201·chunks1413·unsealed/legacy heads0, foreign_key_check0·quick_check정상이다. bundle590.55KiB/gzip89.87KiB, 첫배포 startup25ms·최종30ms다. fixture의 고정 runId 문자열은 이전 `p5-27-selected-r2-20260916`을 그대로 사용했으므로 시험 구분은 version과 시각을 기준으로 한다.

로컬 service-binding trigger에 request-stream-after-response/internal-error 진단 출력이 있었다. 종료코드는 에이전트의 시험 종료용 중단에 따른1이며 정상 종료라고 표현하지 않는다. 최종220개 실제 응답/원격 tail은 모두 완전했고 원격예외0이므로 별도 기록한다. 이 로컬 진단의 원인은 확정하지 않았다.

사용자에게 최종version 메모리지표 화면을 요청했다. 사용자는 ‘특정 버전’ 목록에 이전버전만 보인다고 보고했으며 새로고침 후 확인을 안내했다. 다른버전/전체버전 값으로 대체 판정하지 않는다. 기존 사진을 반복 요구하거나 로그인/인증정보 추출·Access해제를 하지 않는다.

원래version100%·공유DBbinding·health200/Access302 복구를 확인한 후 `4000e4f2-1509-4f51-8752-09368540f4fd`와 `6dac1a8d-7f73-4e9b-bc05-02fea622f5a6` 두 시험DB를 삭제했다. 최종 DB목록은 기존 공유DB1개뿐이다. 합성DB 삭제는 복구 불가이나 seed·모든 숫자결과는 보존한다. 로컬trigger와 tail을 종료했고 commit/push·공유DB변경은 없다.

## 검사와 재개

- 새로고침 후 사용자 사진 `codex-clipboard-a1e3339a-96d3-4649-9e7c-8fff05c5e705.png`를 직접 확인했다(SHA-256 `e0779d5337f4f987c369a295cae1c811da274e309d055835611968d627de1822`). 특정버전1개·지난24시간·P50/P90/P99/P999=7.43/10.22/11.17/11.43MB다. 배포표식에 e23731a9/ef7039b8/fc10f77d가 보이지만 선택버전 번호는 접혀 있어 글로만 확인을 요청했고 사용자가 ef7039b8 선택이 맞다고 답했다. 선택식별은 사용자 확인이며 직접 보이는 메뉴로 과장하지 않는다. 로컬180건/23.80MiB·원격초과오류0과 합쳐 D-032 메모리 검증을 통과로 판정한다. 배포표식 자체를 선택버전 증명으로 쓰거나 percentile을 순간peak로 바꾸지 않는다. 새로고침 안내를 처음부터 하지 않아 생긴 사용자 부담을 반복하지 않는다.
- 실행기 방어 추가 후 최종 전체 검사도1,644건/exit0이다. 로그 `/tmp/biblequiz-p527-cpu3-final-check.log`; 문서 로컬링크70개 누락0·`git diff --check` 통과. 원격시험·복구·삭제까지 기록 완료했고 선택버전 확인까지 완료돼 남은 것은 CPU원인 분석이다.
- 관련4파일270건 통과 후 최종 전체 `VITEST_MAX_WORKERS=2 WRANGLER_WRITE_LOGS=false pnpm check` exit0: unit262+Worker1,382=1,644건. lint/typecheck·정적검사·격리 fixture·로컬 build 통과.
- 첫 관련 검사 실행은 sandbox의 localhost listen EPERM으로 시작하지 못했으며 로컬 포트 허용 후 통과했다. 이것을 제품 저장 실패로 세지 않는다. 초기 TypeScript의 Buffer/코어 schema 자료형 불일치는 수정 후 전체 검사에서 통과했다. 기존 timeout/검사 조건을 완화하지 않았다.
- 원격 실측·시험DB 정리·최종 보존 검사를 STATUS/HANDOFF에 기록했다. 앱 UI/실제 API 연결 변경이 없어 브라우저 E2E는 실행하지 않았다.
- P5-27·부모 Phase5는 진행 중이며 같은 세션을 유지한다. D-032 메모리는 통과했으나 CPU7/9ms 미통과가 남아 다음 번호나 운영 연결을 열지 않는다.
