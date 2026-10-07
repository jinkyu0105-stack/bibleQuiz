# 인계 — P9-04 운영 반영 완료 / Phase9 이번 승인 범위 완료

## P9-04 운영 배포 완료 — 2026-10-07

사용자의 명시 배포 지시에 따라 운영 앱을 소스 **37b7254**로 갱신했다. 실행 파일은 CI 통과21b81de와 동일하며 차이는 문서뿐이다. Production version **7aea6843-5288-42da-9bef-bc673e1d9dfe**·100%·2026-10-07 **19:46:57KST**. 직전 정상 버전27f75159가 코드 복귀 대상이다. [운영 사이트](https://biblequiz-app.jinkyu0105.workers.dev/) · [실제 명령·배포/검증 근거](work/P9-04.md).

운영 build/strict dry-run, binding33개 동일, 공개/DB/두 난도 API200·퀴즈 응답 배포 전후 동일, PC·모바일 두 난도 화면/새 배경/풀이 이동4조합·pageerror0, 관리자 로그인 이동을 확인했다. 기존 CI validate/browser 성공을 재사용했다. 실제 DB/키/유료 결과·0000~0038·content/backup·폰트/fontkit을 보존하고 원격 migration·유료 호출·새 GitHub push는 하지 않았다. content/backup의 기존 버전도 그대로다.

**P9-02 구현·CI 수정과 P9-04 운영 반영, Phase9의 이번 승인 범위는 완료**다. 추가 디자인 검수를 새 배포 조건이나 다음 필수 작업으로 두지 않는다. 기존 LCP5.4초/기기·관측 한계는 유지하고 향후 개선은 별도 요청 때 진행한다. 다음 필수 작업 없음·세션 유지·필요 시 추천 GPT-6.1-sol/Medium(운영 확인·작은 유지보수). 시작 Pro98% 잔여×사용자 지정10=980%. 결과 문서를 로컬 커밋하며 운영 소스와 구분한다.

## 현재 버전과 검사 정본

| 대상 | 현재100% | 소스·직전 복귀 대상 |
|---|---|---|
| Production app |7aea6843-5288-42da-9bef-bc673e1d9dfe|소스37b7254 / 직전27f75159-4019-4afc-b871-048e4e9d15f7|
| Production content |48a1269d-a9b2-4405-8bbc-745cdabec1b0|기존56bb1bf / 직전66eb96c5-ad4c-4d01-85dd-a13aef598acf|
| Production backup |3fb0e7c7-368b-45a9-89f9-2818739e415d|기존 배포 유지|
| Preview app |3dc36ff6-f6d0-4627-bc43-6beeb3495391|GitHub21b81de 자동 배포|
| Preview content |2df93f07-3703-42ec-b576-fd085e8c839f|기존 배포 유지|

[GitHub CI37604052032](https://github.com/jinkyu0105-stack/bibleQuiz/actions/runs/37604052032)는 validate/browser 모두 success다. `pnpm check` unit308/Worker2197/Workflow4/recoveryCLI2/Node14/Python7·lint/typecheck/DB/build, 브라우저193통과·기존 PC 터치 전용1건 건너뜀·재시도0. P9-04에서는 실행 소스 불변을 확인해 이를 재사용하고 Production build·strict dry-run·운영 읽기 검증만 추가했다. 기존500kB 출력 번들 경고 유지.

P9-02 구현·테스트 수정·중간 실패와 재검증은 [P9-02](work/P9-02.md), 실제 명령·운영 검증·rollback은 [P9-04](work/P9-04.md), 합성 디자인 캡처는 [phase-9](design/phase-9/README.md)가 정본이다. 운영 실제 화면 캡처와 배포 증거는 Git 제외 `.wrangler/releases/p9-04-ui-20261007/`에 보존했다. 해당 release의 production-dist는 새 운영 산출물이고 루트dist/배포 포인터는 배포 전 로컬 상태로 복구했다.

## 다음 작업과 보존 경계

사용자는 추가 시안 검수가 아니라 운영 최신화를 요청했다. P9-01/02/04의 이번 승인 범위는 끝났으며 P9-03은 통합된 제안으로 재사용하지 않는다. 새 작업을 자동으로 시작하지 않는다. 운영 사용 중 구체적인 수정 요청이 오면 해당 범위를 정한다. 새 세션을 강제하지 않고 현재 세션을 유지한다.

새 작업 시작 순서: AGENTS → PROJECT_CONTEXT → DECISIONS → STATUS → HANDOFF → implementation의 관련 spec/work → Git status/diff/log. 시작 때 최신 Pro 잔여×사용자 지정10을 확인한다. 현재 소스·기존 데이터·0000~0038·Secret·유료 응답·celebration/garden-v1·출력 TTF/fontkit을 유지한다. 완료한 실제 IME/PDF/백업/청구/출시 검사를 반복하지 않는다. 일반 Preview는 GitHub push 자동 배포, 운영은 별도 사용자 지시와 production 설정이다.

`pnpm dev`는 `.wrangler/ui-demo-state/`의 영속 합성 자료를 읽는다. 기존 실제 로컬 자료 실행은 `pnpm dev:local`, E2E는 임시 DB 격리다. dev fixture는 원격으로 넣지 않았다. 포트는 코드 버전이 아니며 로컬 DB와 원격 DB는 별개다. 사용자 기존 개발 서버는 종료하지 않았다.

## 알려진 한계

- P9-02 로컬 모바일 가정 LCP5.4초·성능75/접근성100. 운영/실기기 INP 측정이 아니다. 추가 최적화는 이번 배포에 끼워 넣지 않는다.
- 관리자 내부 로그인 후 전체 재검수·새 실제 AI/제출 쓰기는 이번 운영 확인에 포함하지 않았다. 기존 CI와 과거 실제 검수 근거를 재사용했다.
- P9-02 로컬 전체 실행의 관리자 초안 보존1건 간헐 실패는 원인 미확정이나 같은 검사8회·독립 전체·GitHub에서 통과했다. 조건을 완화하거나 제품 코드를 바꾸지 않았다.
- P9-04 Python 요청의 Cloudflare1010/403은 정상 Chromium 접속과 구분했다. 로그인 이동 response body/health 시각 전체hash를 잘못 비교한 초기 확인 스크립트는 수정했고 제품 장애로 기록하지 않았다.
- macOS·일부 Android 브라우저/키보드와 계정 지표 관측 한계는 보존한다. 과거 check:preview-generation의0036 예상/현재0038 차이는 옛 리허설 도구 문제이며 필수 pnpm check에 포함되지 않는다.
- OpenAI5회/USD0.57와2026년10월 Cloudflare 예상0 사용자 대조는 P8-02 당시 근거다. 미래0원 보장·현재 invoice 확인이 아니다. Supadata 사용량·격자 자동 제안 등은 [향후 계획](future/notes.md)에 유지한다.

실행은 기존 복구 경로 `/bin/bash`·login:false·명시workdir·승인 검토를 재사용했다. 실행 시작 오류/승인 거부/보안 설정 변경 없음. Node24.18.0·pnpm11.14.0의 기존 WSL PATH를 현재 실행에만 사용했다. 다음 추천 GPT-6.1-sol·Medium — 운영 확인·작은 유지보수에 적합하다.
