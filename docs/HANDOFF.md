# 인계 — P8-02 Supadata 운영 연결 로컬 검증 / 배포 묶음 승인 대기

2026-10-04. **현재 P8-02 진행 중 / 부모 Phase8 진행 중 / 다음 P8-02 / 세션 유지.** 추천 GPT-6.1-sol·높음 — 두 서버의 출처 호환과 실제 자료 보존을 확인해야 한다. Pro 사용10%·잔여90%·10080분/별도5시간 없음 → 사용자 지정×10=900%(공식 배수 아님). 위임 없음.

## 다음 첫 동작

사용자의 “다음 작업 진행하세요”에 따라 기존 Supadata Free 성공 결과를 운영 조회/원본 저장에 연결하는 로컬 구현·필수 검사·검토 가능한 묶음을 완료했다. **소스 커밋 `701475820e7d4281a4948bac820ff326d9e2ced1`**, 원격 미적용. [구체적 배포 범위/순서/무료2크레딧 검수/복귀](work/p8-02/supadata-integration.md)를 승인받으면 content 호환 코드→app 코드 후보→저장된 Supadata 키를 versions secret put으로 최종 후보에 연결→binding/지문 비교→배포한다. 새 AI 호출·Paid 전환·main push는 제외한다. 기존 무료 시험 승인을 새 운영 Secret 설치의 완료/포괄 승인으로 기록하지 않는다. 사용자 승인 이후 같은 내부 단계마다 재승인받지 않는다.

실제 키는 `~/.local/state/biblequiz/credentials/supadata.key`0600에 그대로 있다. 프로그램 표준입력으로 전달하며 키값을 모델/명령 인자/로그/Git에 출력하지 않는다. 재입력을 요구하지 않는다. Supadata 키는 app에만, 기존 OpenAI 키는 content에만 둔다. 비공개 content는 새 공급자 source ID를 읽어야 하므로 앱과 함께 호환 배포가 필요하다. 새 Supadata 원본을 저장한 뒤 과거 Worker 버전으로 통째로 복귀하면 읽기가 실패한다. 새 출처 읽기 코드는 유지하면서 앱 provider만 전환한다.

검사: 새 회귀22개와 기존 관련93개, 전체 `pnpm check` exit0(unit308/Worker2187/Workflow4/recovery CLI2/Node14/Python7), 최종 typecheck/변경시험 ESLint, Production build, 두 Worker strict dry-run, diff/link/JSON 검사를 통과했다. 초기 새 테스트의 dispatch 누락·교정 응답에 시간 필드를 넣은 fixture 오류를 고친 뒤 최종 전체 검사에서 통과했다. 실제 AI 요청은0이다. 실제 보관 자막768구간/12,993자 전체 글자/시간/정규 SHA 오프라인 대조도 일치했다. 실제 입력/PDF/E2E는 반복하지 않았다. 기존 큰 번들 경고는 남아 있다.

코드 진입점: `workers/_shared/services/supadata-transcript.ts`, app의 기존 video-preview/public-captions 두 라우트, 자막 source 계약2곳과 관리자 caption DTO/표시. oEmbed 제목 helper를 재사용하고 기존 공급자 경로는 보존한다. 새 의존성/migration 없음. source `supadata-native`, generated=null, 내부 track 표식으로 provenance를 유지한다. `202`는 동일 job만 전체30초 내 polling; 타임아웃 job의 영속 재개는 현재 구현하지 않았다. 별도 재요청을 자동 수행하지 않는다.

보관: Git 제외 `.wrangler/releases/p8-02-supadata-integration-20261004/`에 check/build/dry-run 로그, `offline-proof.json`, `remote-before-private.json`, `artifact-proof.json`(소스437파일/산출물77파일), 두 환경 빌드가 있다. 기본 dist/배포 포인터는 저장본으로 복원했다. 이전 `.wrangler/releases/p8-02-supadata-native-20261004/`의 실제 결과/키는 그대로이며 새 외부 조회0·크레딧 추가소비0이다. 이번 원격 조회에서 기존5개 Worker 버전/AI7·usage7·비용860448microUSD·세션1·제출2·migration39/FK0가 그대로였다.

기준 보존 커밋1ee9f36, 과거 비교c31c451, 복구 배포a5d4676, Supadata 시험bc976e3/기록43e406a를 유지한다. 현재 앱은 여전히 과거 복구 버전이며 새 연결을 배포했다고 말하지 않는다. 직접 YouTube 경로는 운영 challenge로 실패했고 Browser Run2회도 자막 대기 시간 초과였으며 Supadata Cloudflare native 시험만 성공했다. 수동 복사는 자동화 목표의 대체안이 아니다. 로컬 실제 원문·키·유료 결과·출력 의존성/폰트와0000~0038은 보존한다.

사용자는AI API비용발생을안내받고“시작합시다”로관리자화면에서직접진행하는검수를시작했다. 한단계씩실제버튼을안내하고서버상태/비용을읽기확인한다. 기존키연결/활성화는완료했으므로다시승인받거나재입력/키사본을요구하지않는다. agent유료호출은하지않았고명시범위밖의자동생성/재호출·Paid전환·구매·mainpush·실제데이터손실복원은실행하지않는다. 기존입력/PDF·유료결과검사를반복하거나새번호/새감사프로젝트/완료조건을추가하지않는다.

## 현재 설치와 배포

- Production app **ad9ebbf0-be59-4941-af42-ea063e97f984**100%, 소스 커밋 **a5d4676**. 직전 **033e9ead-1e0c-4c37-b9e1-75e7b9cbdfbf**는 이번 복구의 rollback 후보이며 기존 D1/DO와 호환된다; AI_GENERATION_ENABLED/CONTENT_FINAL_CHECK_WORKFLOW_ENABLED=true. 요청 제한·운영5분Cron·초안정리·백업=true를 유지했다. 직전 **602bb937-ab11-413e-b037-c89936f8e9f0**는 watch JSON 우선 사용 코드복귀후보다. 그전 **c6e396c0-44f8-4147-bc38-24e35cb8fdc0**는자동제목/장절보완완료·추가player POST 코드복귀후보다. 그전 **615eb2cd-a899-4d36-996b-8b0793696a20**는영상native조회복구완료/자동등록누락코드이며복귀후보다. 그전 **c0516ec1-1b0f-444e-8f3c-b0e54e1e4dd1**는AI연결완료/영상native오류가있는코드복귀후보다. 그전de4d4797-9ee9-483f-a96d-a7cfa5e68c5c는AI비활성호환후보다.
- 비공개 content **95fbc7a6-95f5-4bcc-a85b-30dad3a59e56**100%; AI_GENERATION_ENABLED/AI_RESPONSE_ARCHIVE_ENABLED=true, OPENAI_API_KEY Secret만 추가했다. key-only 중간version **c21931a8-2d8f-4e3e-92c9-b18090474af7**는 AI=false였고 코드/기존binding을 보존했다. 이전 키 없는 비활성version210f95a2-37a1-46bd-b1ed-44e0835c4e8c도 보존했다. 주소/Preview URL/Cron 없음, display-preparation/cleanup=false·합성목록[] 유지. 모델 gpt-5.6-terra/high.
- backup **3fb0e7c7-368b-45a9-89f9-2818739e415d**100%; 비공개 Standard R2·기존 D1/Analytics Secret·삭제manifest10분/주간SQL 예약 유지. 첫 주간SQL **2026-10-05 04:00KST**는 아직 미관측이며 기존 정상SQL/격리복원 증거를 재사용했다.
- Preview app7c356a97-f0f3-4793-ab7b-066b2ae2aeea/content2df93f07-3703-42ec-b576-fd085e8c839f·설정/자료 보존. Production/Preview SQL0000~0038·39개 유지.

일반 root/두 난도 API200, 관리자4개path의 Access302·기대AUD를 유지했다. Production Worker 전체 보호는preview only이고 관리자 self-hosted4경로/JWT는 유지한다. 공개 앱/backup에는 OpenAI 키를 주지 않았다. 기존 키를 승인에 따라 재사용하므로 OpenAI Project 청구는 로컬 시험과 합산될 수 있으나 운영 앱 원장은Production D1에 분리된다. spec13.6/D-005를 승인 내용에 맞췄다.

## 이번 기본 정보 보완 검사

이전 제목 보완 단계의 기록이다. 당시 제목이 없는 자막 차단 미리보기에 공개 oEmbed 제목을 보완했다. 당시 운영 app **033e9ead-1e0c-4c37-b9e1-75e7b9cbdfbf**100%, 직전 **602bb937-ab11-413e-b037-c89936f8e9f0** 보존. 관련96개·최종 `pnpm check` exit0(unit308/Worker2168/Workflow4/복구CLI2/Node14/Python6·lint/typecheck/Drizzle/build)·데스크톱/모바일 Chromium의 새 차단 화면 검사2개·Production build/strict/후보binding·공개200/관리자302 통과. 초기 타입 오류는 Workers RequestInit/TextDecoder 옵션을 바로잡아 최종 통과했다. 공개 HTTP 확인은 기본 Python UA403 뒤 기존 브라우저형 UA로200을 확인했고 보안 설정은 변경하지 않았다. 소스657개 중4개변경/653개동일, 산출물73개, 기본dist/deploypointer복구. 모든vars/Secret명·content/backup/Preview/Cron과 발행/참가1/제출2/call7/usage7/860448microUSD/migration39/FK0을 보존했다. 이번 agent의 실제 자막 요청0·oEmbed 로컬조회1·새AI/새migration/mainpush0. 운영에서의 제목 보완 결과와 새 원본 저장/사용자 AI 생성은 아직 미확인이다. `.wrangler/releases/p8-02-metadata-fallback-20261003`와 검증JSON의metadataFallbackRelease가 근거다.

## 이번 watch JSON 우선 사용 검사

관련87·최종pnpm check exit0(unit308/Worker2159/Workflow4/복구CLI2/Node14/Python6·lint/typecheck/Drizzle/build)·Productionbuild/strict/후보모든binding/앱100%·공개200/관리자302 통과. 소스657개중2개변경/655개동일·artifact73·기본dist/deploypointer복구. 모든vars/Secret명/다른Worker/Preview/Cron·기존발행/참가1/제출2/call7/usage7/860448microUSD/migration39/FK0보존. agent실제영상watch GET1/추가POST0/timed-text0/새AI0/새migration/mainpush0. `/tmp/p802-watch-check-final.log`·비공개묶음 `.wrangler/releases/p8-02-watch-player-20261003`와JSON watchPlayerRecovery를따른다. 실제계속차단시무료기존fallback을사용하고새외부서비스/유료안을먼저적용하지않는다.

## 이번 자동 등록 보완 검사

관련단위12/Chromium·모바일실제브라우저합성2·최종pnpm check exit0(unit308/Worker2154/Workflow4/복구CLI2/Node14/Python6)·최종lint/typecheck·Productionbuild/strict/후보검증/앱100%·공개200/관리자302 통과. 소스657개중4개변경/653개동일·artifact73,기본dist/deploypointer복구. 모든vars/Secret명/content/backup/Preview/Cron·발행/참가1/제출2/call7/usage7/860448microUSD/migration39/FK0보존. 새AI/agent실제영상/새migration/mainpush0. 첫lint의불필요escape와새E2E의dashboard mock/선택자누락을교정해최종통과했다. `/tmp/p802-metadata-check-final.log`·비공개묶음 `.wrangler/releases/p8-02-title-metadata-20261003`와JSON automaticRegistrationRelease가정본이다.

## 이번 영상 조회 복구 검사

관련82개·native수정전watch/network fail/수정후pass·최종pnpm check exit0(unit298/Worker2154/Workflow4/복구CLI2/Node14/Python6·lint/typecheck/Drizzle/build)·Productionbuild/strict/후보읽기/앱100%·공개200/관리자302·기존모든binding/Secret명·content/backup/Preview/예약보존통과. 소스657개중2개수정/655개동일·artifact73개,기본dist/deploypointer복구. 참가1/제출2/call7/usage7/860448microUSD·migration39/FK0불변·새유료AI0·agent실제영상0·mainpush0이다. 첫타입검사실패는새test의optional RequestInit만교정했다. 로그 `/tmp/p802-youtube-check-final.log`,비공개근거 `.wrangler/releases/p8-02-youtube-fetch-20261003`0700/0600과JSON의videoFetchRecovery를따른다.

## 이전 AI 연결 단계의 검사와 보존

필수 **pnpm check exit0**(unit298/Worker2153/Workflow4/복구CLI2/Node14/Python6·lint/typecheck/Drizzle/build), 최종 매뉴얼 lint/typecheck·Production build·app/content strict dry-run이 통과했다. 검사소스657개 중4개 변경/653개 동일·빌드산출물73개를 고정하고 검증한 후보만 content→app100%로 적용했다. 기본dist/deploypointer를 복구했다. 앱/콘텐츠의 승인된 flag 각각2개 외binding과 기존Secret명·backup/Preview version·Cron이 보존됐다.

배포 전 queued/dispatch_pending/running generation0·활성content Workflow0. 기존 참가1·제출2·provider call7·usage7·860448microUSD·발행본open·migration39·FK0을 배포 후 재확인했다. 새 유료 생성0·새키사본0·키값 출력0·새migration0·commit/push/reset/stash0. 실제 원본/키/유료결과·의존성/lock·폰트/fontkit 패치·기존 큰 dirty를 보존했다.

비공개 증거는 `.wrangler/releases/p8-02-ai-readiness-20261003`의deployed-proof/artifact-proof/preflight/secret-transfer/public-postflight이며0700/0600이다. 필수검사로그 `/tmp/p802-ai-check.log`, 최종lint/typecheck/build/strict/upload/activate 로그 `/tmp/p802-ai-*.log`. 상세정본은 [검증 JSON](work/P8-02-verification.json)·[실행 manifest](work/p8-02/execution-manifest.json)의productionAiReadinessRelease다. 이전 자동승인거절은 새 명시승인 전 미실행 기록으로 보존했다.

후보2개 업로드 뒤 OAuth 조회401로 중단했다. 읽기전용R2목록의 자동갱신 후 업로드한 동일version을 재확인해 활성화했으며 후보 재업로드·유료 호출·사용자 재인증은 하지 않았다. 설정조회가최신업로드flag=true를보여준것을활성version의binding=false와구별하고활성화전읽기검증을교정했다. 검증된 실행 경로는 /bin/bash·login:false·require_escalated다. 기본spawn ENOENT는 $codex-exec-recovery를 적용하고 같은 실패경로를 반복하지 않는다.

## 기존 검수와 알려진 한계

[기존 공개/자동 운영 검수](work/P8-02.md#자동-운영과-일반-공개-완료--2026-10-03)의 실제예약/manifest/R2·원격합성7일정리·공개HTTP/두난도렌더/50세션·대표마감/요청제한과 실제발행/입력/제출/결과복원 증거를 재사용한다. 실제50세션의 고정동일IP는 검증하지 않았고 이전통제된binding시험과구분한다. 첫주간SQL·계정전체청구·일부CPU/GB-s/state/build분과 macOS/개별Android키보드는 미확인 한계로 보존한다. 월USD0 목표와 실제계정청구 보장을 혼동하지 않는다.

영문 알림 재확인(두난도)·관리자 반복참여 방법은 사용자가 모든구현완료 뒤로 보류했다. [향후 검토10·11절](future/notes.md#10-모든-구현-완료-후--두-난도의-영문-입력-알림-재확인)을 유지하며 새 출시 gate로 늘리지 않는다.

## Cloudflare MCP와 브라우저

공식 cloudflare MCP 등록·좁은계정/Workers/Access읽기OAuth인증·실제GET200을 완료했다. 이번 AI 쓰기는 기존Wrangler승인인증을 사용했고 MCP쓰기권한은 확장하지 않았다. 관리화면정보가 필요하면 실제읽기MCP를 먼저 사용하고 사용자에게 같은항목을 반복 질문하지 않는다. MCP도구는 현재대화에서 로드돼있다.

Codex Windows앱이 관리하는 WSL CLI0.160.0은 `/mnt/c/Users/jinky/.codex/bin/wsl/095c52da468c9593/codex`에 있다. CLI OAuth가 기본브라우저URL을 열고 open_in_codex가 오른쪽패널에URL을 여는 것은 Chrome조작/Computer Use가 아니다. 실제공개스크린샷은 별도WSL Playwright1.62.1/headlessChromium이었다. 현재Browser제어도구는 없고 WindowsComputerUse는sandboxCwd 초기화에 실패했으며 보안모드/CDP/설정을 변경하지 않았다. 스킬만으로 접근권한을 만들지 않는다.

## Git

2026-10-04 사용자 승인으로 이전 HEAD `0ab476e4281734f4eab64cc6231be09092221651` 이후 누적 변경을 로컬 기준 커밋으로 보존한다. 정확한 새 HEAD는 `git log -1`로 확인한다. [보존·검사·배포 대응](work/p8-02/git-baseline.md)을 따른다. push/재배포는 하지 않는다. 앞으로 검증 단위마다 커밋하고 배포와 연결한다. 새 세션은 현재P8-02 미완료이므로 권하지 않는다.
