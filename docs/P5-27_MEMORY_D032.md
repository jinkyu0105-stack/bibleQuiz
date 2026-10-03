# P5-27 D-032 로컬 동시 메모리 검증 — 2026-09-16

## 결과

사용자 승인 D-032에 따른 **로컬 메모리 검증은 통과**다. 사용자가 제공한 원격 그래프는 P99919.86MB를 보여주지만 Worker/시간창/version연결이 잘려 있어 **원격 판정은 보류**한다. 새 기준 승인 자체를 P5-27 완료로 보지 않는다. CPU 목표 실패는 별도로 남는다.

[실행기](../scripts/p5-27-measure-local-memory.mjs), [모든 숫자 표본](P5-27_MEMORY_D032.json). 현재 저장 코드/기존 standalone probe를 그대로 bundle하고 로컬 시험 wrapper만 추가했다. 세 상황을 각3번, 새 isolate9개에서 총180 invocation으로 검증했다. 각 시험의 최대 in-flight20/완료20/같은 isolate marker, 결과/query/최종 DB 행/외래키/quick_check를 검사했다.

| 20개 동시 상황 | 각 시험 결과 | JS used heap 관측 최대 | 보수적 합계 관측 최대 | query 최대 |
| --- | --- | ---: | ---: | ---: |
| 전형 자막20개 각각 저장 | 저장20·event20/chunks20/head20 | 4,534,084 bytes | 8,056,575 bytes (7.69MiB) | 5 |
| 200KB 자막20개 각각 저장 | 저장20·event20/chunks260/head20 | 15,460,916 bytes | 23,428,361 bytes (22.34MiB) | 6 |
| 같은 자막에200KB 원본20개 경쟁 | 저장1·명시적충돌19·event1/chunks13/head1 | 7,839,736 bytes | 16,921,211 bytes (16.14MiB) | 6 |

보수적 합계는 같은 관측 시점의 `totalSize + embedderHeapUsedSize + backingStorageSize`다. JS 예약 heap도 포함하며 각 구성요소의 별도 최대값도 JSON에 남긴다. 이 합계는 플랫폼 전체 isolate memory/RSS와 동일한 값이 아니다. 9개 시험 모두96MiB 예산 안이고 자동 replay0·불완전 event0·외래키 오류0·quick_check정상이다. 이 결과는 최초 원본 저장의 유한한 세 상황이며 모든 수정/AI/최대1MiB/전체 누적 이력의 메모리 지원을 증명하지 않는다.

## 방법과 한계

- 기존0000~0009를 메모리 D1에 재현하고 합성 설교만 준비한다. Wrangler config/자격증명/remote binding을 사용하지 않고 outbound fetch는403이다. 종료 시 DB/Worker를dispose한다. 실제자료·공유DB·원격배포·새schema/migration·앱runtime 변경 없음.
- 요청 시작을20개로 맞추는 **진입 대기 장치**를 시험 wrapper에만 둔다. 각 요청 소유의 `scheduler.wait(1)`로20개가 들어올 때까지 기다린 후 저장을 시작한다. 저장 코드 안에서는 강제 정지하지 않고 GC/예열/입력 축소도 하지 않는다. 최대in-flight20은 진입~응답 사이 겹침이며20개가 모든 저장 단계에서 같은 시점에 머문다는 뜻은 아니다.
- 실행 전/중/후 `Runtime.getHeapUsage`를 반복 조회했다. 각 시험6~7개·전체62개 표본이며 조회 사이1ms 대기는 실제 표본 간격1ms 보장이 아니다. 모든 시점/구성요소를 보존한다. CPU profiler/heap snapshot/강제GC는 실행하지 않아 저장 CPU 통과 수치로 해석하지 않는다. **정확한 순간 최대값이나 원격peak를 얻었다고 주장하지 않는다.**
- 첫 계측도구 검사는 Runtime.evaluate 미지원 오류로 종료됐고 저장20건은 성공했다. Runtime.enable만 추가해도 동일해 numeric counters를 로컬 응답 header로 옮겼다. 자연 발송은 최대in-flight15여서20으로 오표기하지 않고 진입 정렬을 추가했다. 공유Promise 방식은 일부 응답 실패가 있어 폐기하고 요청별 timer 방식으로 교체했다. 이 초기 네 번은 측정도구 준비 실패이며 성공한9개 시험과 섞지 않는다. 현재 방식은180개 모두 통과했다.

## 원격 지표

원격 접속용 Access 로그인은 이전에 성공했다. remote inspector 비지원은 [이전 진단](P5-27_FIRST_REQUEST_DIAGNOSIS.md#원격-측정-기능-확인--로그인-성공-이후)대로이며 반복하지 않았다.

[공식 Metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/#memory-usage)는 invocation 시점 메모리의표본percentile을 제공한다. 현재Wrangler 공개CLI/API에는 임의Worker메모리지표를 읽는 경로가 확인되지 않았고, 기존인증파일을 직접읽어API호출하는우회는하지않았다. 컴퓨터조작스킬의정상초기화도 `sandboxCwd is not a local file URI`로 UI접근전에실패했다. 설정/인증창조작/다른helper우회는없다.

후속으로 사용자가 제공한 `codex-clipboard-94582efc-ed42-49bd-ba68-252609837a94.png`를 직접 열어 확인했다. Windows경로를 WSL `/mnt/c` 경로로 읽은 것이며 UI조작/스크린캡처 우회가 아니다. 그래프제목은 `메모리 사용량`, 상단표시P50/P90/P99/P999는5.74/10.13/11.25/11.87MB, tooltip `9월16일10:15:00`은8.76/17.79/19.6/19.86MB다. `4 changes` 표식이보인다. 화면단위MB그대로기록하며표본percentile을peak로바꾸지않는다. Worker이름/선택시간범위/필터/시간대가잘려있으므로사용자에게윗부분화면을추가요청했다.

추가 이미지 `codex-clipboard-fa61fd5c-6393-4599-b19b-740d302464a3.png`에서 Worker `biblequiz-app-preview`, 기간 `지난 24시간`, 버전 필터 `전체 배포된 버전`을 확인했다. 그래프 하단에는 처음부터 날짜/시간 축이 있었다. 추가 요청의 목적은 날짜가 없어서가 아니라 Worker/집계 필터 확인이었으며 사용자에게 이를 명확히 설명하지 못했다. 요청한 상단 정보는 이제 확보했으므로 같은 화면을 다시 요구하지 않는다. 원격 메모리 지표 제공과 전체 버전 집계 범위는 확인됐지만 개별 r2 버전 수치는 아니다.

기존전형/경계/동시220개시험은 r1한국시간10:22:17~10:23:23, r2한국시간10:36:18~10:37:15다. tooltip한점이두시험을모두포함하는bucket인지/어느version인지아직확인되지않았다. 19.86MB가예산보다작다는사실과r2메모리gate통과는구분한다.

먼저 화면의지표제공여부를확인하고, 기존 r2시험 version `51b8a2fe-4783-4a21-a8bb-170f0e5311b1`과JSON의시작/종료시간에해당하는값을구분한다. 오늘전체값이나현재복구version값을r2저장측정으로간주하지않는다. 해당시간창표본을확인할수없으면다음CPU개선후승인된격리시험과함께수집한다. 지표준비없이DB/배포/220회를재실행하지않는다. 원격미확인은0/통과가아니다.

## 보존과 검사

제품저장코드·0000~0009·의존성·기존계측JSON·P5-23~26완료기록은보존한다. 실행기 구문 검사와 로컬180개 검증을 완료했다. 최종 `VITEST_MAX_WORKERS=2 WRANGLER_WRITE_LOGS=false pnpm check` exit0: unit262+Worker1,377=1,639건, lint/typecheck·정적검사/fixture·로컬build통과. 문서링크/공백/파일보존의최종결과는STATUS/HANDOFF에기록한다. 원격작업/앱UI변경이없어새배포/브라우저E2E는실행하지않았다. P5-27·부모Phase5진행중, 다음은원격그래프범위확인과별도CPU첫요청개선이다.
