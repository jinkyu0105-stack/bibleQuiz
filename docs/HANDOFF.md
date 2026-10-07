# 인계 — P9-02 CI 수정·검증 / 부모 Phase9 진행 중

## P9-02 CI 수정 검증 — 2026-10-07

사용자의 CI 통과 지시에 따라 인증 시계·제목·격자 폭·철회 완료 메시지 검사를 수정했다. 전체 실행에서 추가 확인한 영문 안내 검사도 브라우저 시계를 제어하도록 수정했다. 제품/인증 실행 코드·데이터·migration·키·유료 결과·이미지·폰트/fontkit은 변경하지 않았다. 원인과 수정 범위는 [P9-02](work/P9-02.md#github-ci-검사-수정--2026-10-07)를 따른다.

`pnpm check` 통과(unit308/Worker2197/Workflow4/recoveryCLI2/Node14/Python7·lint/typecheck/DB검사/build). 후속 브라우저 테스트 수정 뒤 lint/typecheck도 다시 통과했다. 영문 안내 시간 제어는 PC·모바일 반복8건 통과했고 최종 독립 전체 브라우저193건 통과·기존 터치 전용1건 건너뜀(PC에서만 해당)·실패/재시도0이다. 기존500kB 출력 번들 경고만 남는다. 기존dist/배포 포인터는 검사 후 복구했다. GitHub CI는 수정본 푸시 후 확인하며 아직 성공으로 기록하지 않는다.

현재 P9-02 진행 중(검사 수정/검증), 부모 Phase9 진행 중. 다음은 같은 P9-02의 GitHub CI 통과 확인과 사용자 화면 검수다. 세션 유지, 다음 추천 Astra·High(실제 실패와 검사 기준 구분). 시작 Pro0% 사용/100% 잔여·별도5시간 없음·사용자 지정×10=1,000%. 이번 main 푸시는 Preview 자동 배포이며 운영 배포·원격DB 변경·유료 호출은 제외한다.

## 현재 Preview 자동 배포 완료 — 2026-10-07

사용자 승인으로 미전송34개 커밋과 배포 경로 결정 문서를 main에 푸시했다. GitHub 원격 소스는 **f7359e5456774344785a6415103a1a5a512dcd58**. Workers Builds `fd0b1362-01a4-444d-800d-a58529cacd58`의 동일 커밋 check가 **completed/success**이며, Preview app 활성 version **00fa46eb-ead1-49f4-8a22-4118f62c11fb**·traffic100%·deployment8daa53c1-475b-42b5-a174-92520604c6f1·2026-10-07 17:26:11KST를 API 읽기로 대조했다. 직전 Preview7c356a97은 이전 버전이다. Production app27f75159·소스56bb1bf는 불변이다. content/backup·DB migration·Secret·실제 AI는 변경하지 않았다.

일반 Preview는 GitHub main 푸시 → 자동 배포로 통일하고 직접 배포하지 않는다. Cloudflare Builds trigger 조회API10000은 인증 오류였으나 GitHub check와 Cloudflare deployments GET으로 실제 성공을 확인했다. 비로그인 Python 이미지 요청403은 실제 로그인 화면 검수로 간주하지 않는다. 사용자 검수는 [Preview](https://biblequiz-app-preview.jinkyu0105.workers.dev/) Access 로그인 뒤 장년/어린이 첫 화면, [푸시 커밋 검사](https://github.com/jinkyu0105-stack/bibleQuiz/commit/f7359e5456774344785a6415103a1a5a512dcd58)의 Workers Builds Success 대조로 진행한다. 로컬 시험 데이터와 원격 시험 내용은 같지 않다.

기존 pnpm check와 추가 개발 실행 lint/typecheck·Chromium1건 근거를 재사용했다. 이번 lockfile/Cloudflare 설정/Preview 발행 fixture 검사 통과. 선택 실행한 과거 check:preview-generation은0036 예상 목록과 현재0038 차이로 실패했다(필수 pnpm check에 미포함, 이번 migration 없음). GitHub CI37593642253은 완료 후 validate 실패(인증 캐시 만료 검사1건), browser 실패(제목·격자 폭4건, 철회 메시지2건은 재시도 통과)로 확인됐다. 사용자 지시로 같은 P9-02에서 검사 수정·로컬 전체 검사·GitHub CI 재확인을 진행한다. [CI](https://github.com/jinkyu0105-stack/bibleQuiz/actions/runs/37593642253). 직전 배포 결과 문서 e5ebc46은 로컬에 보존했다. 이번 CI 수정 지시에는 수정 커밋의 main 푸시·Preview 자동 배포·GitHub CI 통과 확인을 포함하며 운영 배포는 제외한다.

부모 Phase9 진행 중·현재 P9-02 사용자 검수 대기·다음 P9-02 Preview 화면 확인·세션 유지. 시작 Pro0% 사용/100% 잔여·7일 값·별도5시간 없음·사용자 지정×10=1,000%. 다음 추천 GPT-6.1-sol/High. 운영 배포는 사용자 다음 요청 전 실행하지 않는다. 배포 정본은 [Preview 반영 경로](spec/architecture.md#preview-반영-경로).



2026-10-07. **현재 P9-02 기본 개발 실행 수정 완료·사용자 화면 검수 대기 / 부모 Phase9 진행 중 / 이전 P8-02·Phase8 완료 / 다음 P9-02 화면 검수 / 세션 유지.** 시작 Pro25% 사용·75% 잔여·별도5시간 없음 → 사용자 지정×10=750%. 위임 없음. 다음 추천 **GPT-6.1-sol·High** — 실행/데이터 연결과 사용자 화면 검수 수정에 적합하다.

## 이번 기본 개발 실행 수정

사용자는 `pnpm dev`로 어제4177 화면이 기본으로 나오길 요청했다. `scripts/start-dev-server.mjs`가 기존39 migration과 장년·어린이 합성 자료를 `.wrangler/ui-demo-state/`에 자동 준비하고 같은 저장소로 Vite를 실행한다. 재시작/seed 재실행은 기존 기록/수정을 덮어쓰지 않는다. 시험 내용과 정답은 실제 자료가 아니며 운영에 넣지 않는다. 기존 `.wrangler/state/`·실자료/키/유료 결과·정적 자산·출력/폰트·0000~0038·dist/배포 포인터는 변경하지 않았다.

사용자 기존5173 서버는 임의 종료하지 않았다. 사용자가 그 터미널에서 **Ctrl+C → pnpm dev → 표시된 Local 주소**를 열면 새 기본이 적용된다. `/?level=child`·`/?level=adult`가 두 첫 화면이다. 과거4173/4177 서버는 종료되어 있었고, 포트는 디자인 버전이 아니다. 기존 로컬 자료 직접 실행은 `pnpm dev:local`로 유지하며 E2E launcher도 이 명령으로 전환했다. 브라우저 저장소는 주소별이므로 과거4177 임시 답안이5173으로 자동 이동하지 않는다. Access·Turnstile 게이트는 유지한다.

실제 `pnpm dev --port 5174`에서 두 난도 AVIF 로딩/hero/풀이 이동을 확인했고 두 번째 실행5175의 두 난도 최신 API200을 확인했다. 재seed 전후 sermons/quiz_sets/variants/entries/solutions/site_state 전체 행 해시가 같고 수정 요약도 보존됐다. 보존 시험용 수정은 원래 합성 요약으로 복구했다. lint/typecheck 통과. 변경된 E2E launcher로 실제 격리 D1→Worker→브라우저 Chromium1건 통과. 이번 확인용5174/5175 서버는 종료했고 사용자5173은 유지했다. 검사 로그 `/tmp/p9-default-dev.log`·`/tmp/p9-default-dev-restart.log`·`/tmp/p9-demo-reseed.log`·`/tmp/p9-default-e2e.log`. 전체 출시/실제 입력/PDF/유료/배포 검사는 반복하지 않았다. Context7 검색에서 해당 플러그인을 찾지 못해 Cloudflare 공식 API/명령과 설치 버전으로 확인했다.



## 정확한 다음 한 작업

사용자는 918dba4의 시안 재현과 기존 배경4종을 거절했다. Phase7A 01/02 원본에서 배경을 다시 만들고 장년/어린이를 별개 구도로 구현하라는 직접 지시로 같은 P9-02를 재작업했다. 새 내장 imagegen4회는 이 지시의 범위이며, 실제 설교 AI 실행이나 배포 승인이 아니다. 다음은 **같은 P9-02의 수정본 GitHub CI 통과 확인 뒤 사용자 화면 검수**다. [실제 PC/모바일 화면](design/phase-9/README.md)과 [구현·기능 대응](work/P9-02.md)을 확인한다. P9-03은 통합된 제안으로 번호를 재사용하지 않는다. P9-04 운영 반영은 별도 승인 전 착수하지 않는다.

재개 순서: AGENTS → PROJECT_CONTEXT → DECISIONS → STATUS → HANDOFF → implementation의 design/responsive·관련 users/generation·P9-02 → Git status/diff/log. 최신 Pro와 사용자 지정×10을 확인한다. 새 미커밋 변경은 보존하고 완료한 실제 입력/PDF/백업/청구/출시 검수를 반복하지 않는다.

## 이번 변경·검사·남은 한계

- 장년: 전체 숲/왼쪽 메뉴/오른쪽 아래 어두운 패널. 어린이: 종이 정원/왼쪽 제목/하단 정보 띠/오른쪽 메뉴. `SermonHero.tsx`의 별도 구조이며 그림에 문구를 합성하지 않았다. 가로2장/세로2장 master와 AVIF/WebP/JPEG24종을 실제 `/images/garden-v2/`에 연결했다.
- 두 난도의 요약 전문/고지·설교일·장절·읽기/풀이 링크, 난도/테마, 입력/저장/제출/삭제/연습/출력 계약을 보존했다. 관리자 선택본/9항목/근거/이전본/비용/재생성/확정·발행 확인도 유지했다. 메뉴·현재 단계·다음 버튼과 격자/단서·결과·참여·지난 퀴즈를 보완했다.
- 제목/본문에 OFL 자체 호스팅 WOFF2를 추가했다. 공식 unicode-range 부분 글꼴로 나눠 실제 필요한 파일만 받는다. 출력 TTF·fontkit·package/lockfile은 변경하지 않았다.
- `pnpm check` exit0: unit308/Worker2195/Workflow4/recoveryCLI2/Node14/Python7 및 lint/typecheck·Drizzle·build. 기존 출력/fontkit500kB 번들 경고는 남는다.
- 관련 Chromium36건 통과. 새 구도/전체 요약/풀이 이동과 반응형/이미지 실패/입력 보존/모션/대비는 Chromium·모바일·Firefox18건 및 WebKit6건 통과. WebKit은 처음 설치 파일, 다음에는 host 라이브러리 누락으로 시작하지 못했으나 공식 Ubuntu 파일을 `/tmp`에만 추출하고 ELF 누락0 확인 뒤6건 통과했다. 시스템/앱 보안 설정을 바꾸지 않았다.
- 결과/참여 캡처는 합성 동작 검사에서 촬영했다. 결과를 숨긴 뒤 촬영하려던 보조 코드와 애니메이션 도중 찍힌 캡처는 폐기하고 실제 표시 중/전환 완료 후 다시 찍었다. 제품 오류로 남긴 항목은 없다. 기능 검사 통과를 사용자 디자인 승인으로 쓰지 않는다.
- 캡처의 자료는 합성이며 원격/실자료 검수가 아니다. 최종 관찰·성능 수치는 [verification.json](design/phase-9/verification.json)에 기록한다. 918dba4의 과거 Lighthouse93/접근성100을 이번 수치로 재사용하지 않는다.

최종 로컬 모바일 가정 측정은 장년/어린이 모두 성능75·접근성100이다. 글꼴 전송은 약806KB→282KB, 최초 표시3.3→2.7초로 줄었다. LCP는 둘 다5.4초여서2.5초 기준 미달이며, 운영/실기기/INP 측정이 아니다. 과거93점을 이번 결과로 쓰지 않는다. 배포 전 이 한계를 같은 P9-02에서 검토한다.

## 현재 운영 버전

배포 소스 **56bb1bf71124b0c0391100cb89becb73b5f2d418**. 이 뒤 문서 커밋은 배포 소스가 아니다.

| 대상 | 현재100% | 직전 코드 rollback |
|---|---|---|
| Production app |27f75159-4019-4afc-b871-048e4e9d15f7|f8174f94-d983-4855-8d2d-d02756c41f44|
| Production content |48a1269d-a9b2-4405-8bbc-745cdabec1b0|66eb96c5-ad4c-4d01-85dd-a13aef598acf|

backup3fb0e7c7-368b-45a9-89f9-2818739e415d, Preview app7c356a97-f0f3-4793-ab7b-066b2ae2aeea/content2df93f07-3703-42ec-b576-fd085e8c839f는 보존했다. 두 환경0000~0038, 실제 자료·키·유료 결과·출력 의존성/폰트/fontkit을 유지했다. main push/새 migration/Secret 변경/새 AI 호출0. 기본dist/배포포인터 복구 완료. DB 데이터 복원을 Worker rollback과 혼동하지 않는다.

## 비용과 남는 한계

OpenAI 사용자 확인:2026-09-29~10-06,10월4일 발생,5회,USD0.57. 저장 응답의 캐시 쓰기149284토큰을 반영한 합산USD0.565168(호출별 micro-USD 올림 합계USD0.565169)과 표시액이 일치한다. 기존USD0.490526는 캐시 쓰기 누락 산식이었다. 원장/fingerprint/봉인 응답은 보존하고 과거 추정치 안내를 표시한다. 새 계산 버전은 `openai-terra-2026-10-06-cache-write`; 쓰기량 미보고는 기존 가격과 `provider_partial`이다.

Cloudflare는 사용자가 Billable Usage의 `Oct 2025 · 예상비용0`을 보고한 뒤 연도를 `2026`으로 정정했다. **2026년10월 현재 예상 사용료0**으로 대조 완료했다. 직접 invoice 조회·고정 구독료 총액 확인·미래0원 보장이 아니다. 기존 Workers Free 보고와 무료 포함량 이내 사용량 관측을 함께 보존한다. 기존 Billing403/MCP10000을 반복하거나 새 키/권한을 요구하지 않는다. OpenAI 동명 미사용 프로젝트의 생성 경위는 미확인이며 출시 조건을 늘리지 않는다.

DO GB-s·Workflow 과금 step/state·일부 CPU/Builds/Access 수치, macOS/개별 Android 키보드는 기존 관측 한계다.0이나 전수 검증으로 바꾸지 않는다. 사용자 지정 보류는 구현 완료가 아니다.

## Git·검사 자료·실행 환경

재작업 시작 main·HEAD918dba4·worktree clean. 변경은 프런트엔드/관련 E2E/승인된 새 배경/무료 웹 글꼴/문서/합성 캡처다. Phase7A 원본·celebration 원본/파생본·garden-v1·출력 TTF/fontkit·migration/config/lockfile은 해시/차이로 보존 확인했다. `assets.json`의5 master·26파생 파일 크기와SHA256를 검증했다. 배경 master4종 교체 전 파일은 Git918dba4에 남아 있다.

검사 전 기존dist와 `.wrangler/deploy/config.json`을 보관한 뒤 복구했다. 전체 검사 빌드는 `/tmp/p9-redo-check-7czcak4n/checked-dist/`, 글꼴 최적화 후 최종 빌드는 `/tmp/p9-redo-final-build-wemb1fo8/checked-dist/`, 전체 검사 로그는 `/tmp/p9-redo-check.log`, 브라우저는 `/tmp/p9-redo-e2e.log`·`/tmp/p9-redo-cross-browser.log`·`/tmp/p9-redo-webkit-final.log`, 캡처 원본은 `/tmp/p9-redo/`·`/tmp/p9-redo-admin/`이다. 임시 자료의 장기 보존은 보장하지 않으며 현재 화면과 요약은 docs/design/phase-9에 저장했다.

실행은 기존 `codex-exec-recovery`의 검증된 `/bin/bash`·login:false·명시workdir·승인 검토 경로를 재사용했다. 승인 거절/앱 보안 변경 없음. Node24.18.0·pnpm11.14.0의 기존 WSL 경로를 현재 PATH에만 추가했다. 이미지 최적화 sharp와 초기 글꼴 변환 도구는 임시 환경에서만 사용했다. 최종 웹 글꼴은 공식 부분 글꼴을 자체 호스팅한다.

합성 E2E 서버를 새로 시작하려던 시도는4173 포트가 이미 사용 중이어서 종료했다. 기존 서버의 환경이 임시 격리 E2E D1을 가리키는지 확인한 뒤 해당 로컬 서버와 합성 응답을 재사용했다. 기존4173 서버는 종료하지 않았다. 이번에 만든 성능 측정 전용4175/4176 서버만 종료했다. 문서 로컬 링크185개와 `git diff --check`를 통과했다.

같은 틀의 좌우 반전, 기능을 빼서 시안에 맞추기, 새 이미지가 실제 화면에 연결되지 않은 상태, 자동 검사만으로 디자인 완료 판정하기는 채택하지 않는다. P9-02 사용자 검수 전까지 세션을 유지한다. 로컬 커밋은 운영 배포 소스가 아니며 push하지 않는다.
