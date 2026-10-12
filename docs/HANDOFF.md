# 다음 작업 인수인계

## 현재 작업과 다음 첫 행동

2026-10-12 **P9-13 관리자 콘텐츠 안내와 사용 흐름 개선 — 로컬 구현·검사·문서 완료**. 사용자는 사이드바는 이해되지만 콘텐츠의 기능을 파악하기 어렵다며 처음 온 운영자가 자연스럽게 배울 수 있게 고쳐 달라고 요청했다. 기존 Air/공통 버튼/사이드바와 실제 기능을 보존하고, 도구를 상황별로 펼치는 구성과 목적·순서·결과 안내를 구현했다. [상세 범위](work/P9-13.md) · [화면 정본](spec/design.md#관리자-콘텐츠-안내--p9-13).

현재 소스는 로컬5173에 적용했다. [도구 화면](http://localhost:5173/admin/tools), [주간 운영](http://localhost:5173/admin)에서 확인한다. 추가 push·배포, Production/Preview 실제 자료·AI/인증/DB 변경은 이번 요청에 포함하지 않았다.

다음 필수 구현은 없다. 사용자 화면 피드백이 오면 AGENTS→PROJECT_CONTEXT→DECISIONS→STATUS→HANDOFF→implementation의 관련 spec/work→실제 Git status/diff/log 순서로 확인하고 기존 변경을 보존한다. 추가 push·배포는 이번 결과에 포함하지 않는다. 결과는 검토된 UI·검사·문서와 함께 로컬 커밋으로 남긴다.

## 변경 범위와 보존

- 공통 `src/components/AdminGuide.tsx`와 CSS: 목적 설명, 3단계 사용 순서, 도구 접기. native details는 자식 편집기를 계속 마운트한다. 접고 펼쳐도 입력을 유지하고 여러 도구를 동시에 열 수 있다.
- `admin-bible-reference`의 tools: 공개 퀴즈 수정/초안·입력 점검으로 6개 도구를 묶는다. 제출 전/후 수정 경로와 일반 주간 발행을 구분한다.
- `admin-weekly`의 Dashboard/Policy/PrivacyInbox/Submissions/Workspace/WinnerSettings, `admin-operations`의 페이지/상세/Manual, `AdminSermonInput`의 6단계 안내. 버튼을 입력 다음 줄에 배치하고 필터/조치/보관·백업의 의미를 설명한다.
- 새 안내·키보드·입력 보존 E2E와 기존 tools E2E 진입 보정. `tests/fixtures/admin-tools.ts`가 사용자가 누르는 summary로 도구를 연다. 새로고침 뒤에도 다시 열도록 하며 기존 기능 assertions/서버 확인은 약화하지 않았다.
- docs/spec/design/users·DECISIONS·STATUS·PROJECT_CONTEXT·implementation·components README·P9-13 기록. PROJECT_CONTEXT/implementation의 오래된 ‘Preview 미반영’ 설명을 실제 P9-12 배포 기록에 맞게 정정했다.

API·서버·DB/migration·권한/확정/잠금·기존 입력 저장·원문/유료 결과·키·이미지/폰트/패키지/lockfile·좌측 패널·검토본4189는 변경하지 않는다. native 접기를 조건부 렌더링으로 바꾸거나 안내 클릭만으로 저장/AI/조치를 실행하지 않는다.

## 검사와 한계

`pnpm check` exit0: unit315/Worker2197/Workflow4/recoveryCLI2/Node14/Python7·lint/typecheck·구성/build. 최종 관리자 E2E Chromium52(2.3분)·모바일52(2.1분), 관련 Firefox5(37.6초) 통과. 각 명령 exit0, 구조화된 JSON의 unexpected/flaky/skipped는0이다. 실제 기능 assertions/확인 조건을 유지했다.

중간 검사의 접힌 도구/새로고침 진입과 실제 keyboard focus 기대를 수정했다.104건 묶음1회는 최종 결과 기록 전 SIGTERM/143으로 종료해 완료로 집계하지 않았다. 동시 작업과 겹친 PC 실행의50통과/2시간 초과는 소스를 고정한 독립 최종 실행에서 모두 통과했으나 정확한 원인을 단정하지 않는다. [실패 지점과 최종 근거](work/P9-13.md#중간-실패와-재확인).

1440px PC·390px/320px 모바일에서 캡처를 확인했고 가로 넘침 없이 표시된다. 별도 합성 화면 탐색 pageerror0, 예외 등록 버튼 높이 약49px. 합성 API로 기능을 검사하며 실제 Access 로그인/원격 저장을 완료했다고 쓰지 않는다. WebKit/실기기/GPU 성능은 이번 검증에 포함하지 않는다. 기존 fontkit 번들 크기 경고는 유지한다.

## Git·환경

시작 `/home/onegem/work/bibleQuiz`, main **f5166d5**, clean. origin/main **2d2b1aa**보다 직전 완료 문서1커밋 앞섰다. 기존 커밋을 보존했다. 종료 전 실제 Git status/diff에서 위 UI·검사·문서만 변경되었음을 확인했다. 검토한 파일만 명시적으로 stage해 결과를 로컬 커밋한다. 임시 캡처/로그는 Git 제외 `.wrangler/design-references/p9-13/`에 두고 stage하지 않는다.

이번 작업에서 원격 환경은 변경하지 않았다. 마지막 확인된 배포 기준:

| 대상 | version/소스 |
|---|---|
| Preview app |7f09d123-0067-43b8-bcc9-732e6896f6bc / GitHub2d2b1aa|
| Production app |7aea6843-5288-42da-9bef-bc673e1d9dfe /37b7254|
| Production content |48a1269d-a9b2-4405-8bbc-745cdabec1b0 /56bb1bf|
| Production backup |3fb0e7c7-368b-45a9-89f9-2818739e415d|
| Preview content |2df93f07-3703-42ec-b576-fd085e8c839f|

Preview 배포 계약은 main push→Workers Builds이며 Production 승인이 아니다. [P9-12 배포·검사](work/P9-12.md), [Production 기준](work/P9-04.md)을 따른다. Preview AI false와 별도 DB를 유지한다.

Node24.18.0/pnpm11.14.0. 검증된 `/bin/bash`, login:false, 명시 workdir, 승인 검토 실행 경로를 재사용한다. pnpm이 PATH에 없으면 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 PATH에 추가한다. 기존5173/4189 서버와 `.wrangler/ui-demo-state`는 재생성하지 않는다. E2E4173은 별도 임시 DB다. 전체 검사 종료 후 기존 `.wrangler/deploy/config.json`을 복구했다.

시작 Pro94% 잔여×사용자 기준10=940%, 별도5시간 없음. **현재 P9-13 완료 · 부모 관리자 콘텐츠 개선 완료 · 다음 사용자 화면 피드백(필수 후속 구현 없음) · 세션 유지 · 다음 추천 GPT-6.1-Sol/high** — 기존 디자인과 기능을 함께 보정한다.
