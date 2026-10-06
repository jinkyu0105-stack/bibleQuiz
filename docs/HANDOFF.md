# 인계 — P9-02 시안 재작업·사용자 검수 대기 / 부모 Phase9 진행 중

2026-10-06. **현재 P9-02 재작업·로컬 필수 검사 완료, 사용자 화면 검수 대기 / 부모 Phase9 진행 중 / 이전 P8-02·Phase8 완료 / 다음 P9-02 화면 검수 / 세션 유지.** 시작 Pro22% 사용·78% 잔여·별도5시간 없음 → 사용자 지정×10=780%. 위임 없음. 추천 **Astra·High** — 원본 시안과 실제 화면을 비교하면서 기존 기능 보존을 확인하는 현재 작업에 적합하다.

## 정확한 다음 한 작업

사용자는 918dba4의 시안 재현과 기존 배경4종을 거절했다. Phase7A 01/02 원본에서 배경을 다시 만들고 장년/어린이를 별개 구도로 구현하라는 직접 지시로 같은 P9-02를 재작업했다. 새 내장 imagegen4회는 이 지시의 범위이며, 실제 설교 AI 실행이나 배포 승인이 아니다. 다음은 **같은 P9-02의 사용자 화면 검수**다. [실제 PC/모바일 화면](design/phase-9/README.md)과 [구현·기능 대응](work/P9-02.md)을 확인한다. P9-03은 통합된 제안으로 번호를 재사용하지 않는다. P9-04 운영 반영은 별도 승인 전 착수하지 않는다.

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
