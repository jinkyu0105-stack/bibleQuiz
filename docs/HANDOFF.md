# 인계 — P9-05 하늘 탐색·동작 검토 완료 / 새 Air 계승 UI 개편 진행 중

## 현재와 다음 한 작업

2026-10-08 사용자는 Refero/Air를 참고한 전체 UI 개편 시작 순서를 승인하고 **밝은 하늘과 어두운 하늘 모두·시간대 선택·같은 구름 공간에서 하늘→지면 하강**을 명시했다. [P9-05](work/P9-05.md)에서 실제 Air 네 버튼/스크롤/마지막 잔디·공개 scene 동작을 확인하고 [새 디자인10.7](spec/design.md#107-air-계승-하늘-방향--2026-10-08)·[D-042](DECISIONS.md#d-042--air의-연속-하늘시간대-전환을-새-ui-방향으로-채택)과 독립 검토본을 만들었다. P9-05의 고정 범위는 완료, 전체 새 UI는 진행 중이다. 기존 P9-04·이전 Phase9 승인 범위 완료를 철회하지 않는다.

**다음P9-06: 공개 첫 화면 낮/밤·모바일 풀이·관리자 생성/검수 대표 시안.** 이번에는 착수하지 않았다. 사용자가 승인한 시작 흐름에 따라 대표 시안을 만들고 확인한 뒤 전체 앱 UI/기능 검사로 이어간다. 내부 단계마다 같은 승인을 재요청하지 않으며 새로운 비용·production 의존성/서비스·배포 경계는 별도다. `imagegen-frontend-web`/필요한 모바일 참고 skill은 현재 AGENTS catalog를 읽는다. 이미지 한 장에 여러 화면/섹션을 압축하지 않고 글자/성경 구절을 합성하지 않는다. 실제 한글 레이블은 HTML/명세로 다룬다. 기존 기능·정답/Access·한글입력·영속자료·출력 폰트/fontkit을 유지한다. 최종 타이포/표면/패널은 아직 확정하지 않았다.

## 직접 확인할 검토본

주소: `http://localhost:4189/docs/design/phase-9/air-sky-study/`. 네 시간대 버튼을 누르고 스크롤하면 같은 하늘의 구름을 지나 정원으로 내려간다. 구름은 스크롤 없이도 움직이며 멈춤/재개·움직임 감소 설정을 지원한다. PC 우측 세로/390px 모바일 하단 가로 제어다. 기본 리뷰 시점은 낮이며 최종 앱의 자동 초기 시간 정책은 미확정이다.

[원본](design/phase-9/air-sky-study/index.html) · [스타일](design/phase-9/air-sky-study/study.css) · [움직임](design/phase-9/air-sky-study/study.js). 자체 Canvas2D/noise texture/지면의 독립 움직임 검토다. 실제 Air3D/최종 이미지 품질·전체 UI 시안·앱 연결/배포 완료로 보고하지 않는다. Air 코드/이미지/3D/폰트를 복사하지 않았다. 원격 자료/API/DB와 연결하지 않는다.

loopback 정적 서버4189를 열어 두었다. 재개 시 먼저 주소 응답을 확인하고 없으면 프로젝트에서 `python3 -m http.server 4189 --bind 127.0.0.1 --directory /home/onegem/work/bibleQuiz`로 연다. 기존 개발 서버는 종료/변경하지 않았다. 시작 문서는 AGENTS→PROJECT_CONTEXT→DECISIONS→STATUS→HANDOFF→implementation의 관련spec/work→Git status/diff/log 순서다.

## 검사·증거·한계

- Chromium: 새벽/낮/노을/밤 단일 선택·구름 시간 진행·멈춤 정지·하강 지면 도착·390px 가로 넘침 없음/밤 전환·움직임 감소/해당 상태 시간대 전환·runtime error0. `node --check`, 최종 lint/typecheck, diff whitespace/문서 링크 확인. Phase/배포 완료 검사가 아니므로 변경 없는 기존 출시 check/IME/PDF/백업/유료 호출을 반복하지 않았다.
- 첫 lint는 docs 독립JS의 browser globals 선언 누락으로 실패했고 파일 선언으로 정리했다. 초기100ms 고정 대기의 media 확인 실패는 상태 조건/렌더 확인으로 바꿨으며 최종결과 JSON을 따른다. 시각 캡처의 최하단 제목/헤더 겹침을 수정하고 tint 재사용으로 반복 계산을 줄였다.
- 원본 데스크톱 네 버튼 실제 클릭·소프트웨어 WebGL 캡처·최하단scrollY=max12716을 대조했다. 원본 모바일 시간대 위치는 확인했으나 밤 클릭은 hero 가로채기로 실패했다. 원본의 React hydration/WebGL 경고와 초기 도입 애니메이션 중 최하단 오판은 성공으로 기록하지 않는다. 기술 근거와 제한은[P9-05](work/P9-05.md).
- 증거는 Git 제외 `.wrangler/design-references/p9-05-air-20261008/air/`와`study/`의 PNG·sanitized observations·verification JSON. 제3자 trackers/전체 DOM/network/원본 JS는 커밋하지 않는다.
- 검토본의 최종 대비·실기기fps/배터리·Firefox/WebKit·대표 화면 구성/한글 폰트 검수는 다음 디자인/앱 범위에 남아 있다. 원본3D를 도입할지 또는 자체 가벼운 레이어를 쓸지는 production 의존성 추가 전에 별도 판단한다. 새 dependency/Refero 설치·결제/AI API0.

## Git·배포·보존

시작 HEAD **2a12e0b**, main/worktree clean. 실제 원격 main **21b81dee578c6dad5decc3add9d71102a3595df6**, 로컬 문서2커밋 미푸시를 확인했다. 이번에는 검토본과 관련 문서만 로컬 커밋한다. 정확한 종료HEAD/미푸시 수는 git log/status로 확인한다. src/public/Worker/설정/SQL/package/lockfile은 변경하지 않는다.

| 대상 | 유지하는 version/소스 |
|---|---|
| Production app |7aea6843-5288-42da-9bef-bc673e1d9dfe / 소스37b7254, 직전27f75159-4019-4afc-b871-048e4e9d15f7|
| Production content |48a1269d-a9b2-4405-8bbc-745cdabec1b0 / 기존56bb1bf|
| Production backup |3fb0e7c7-368b-45a9-89f9-2818739e415d / 기존 배포|
| Preview app |3dc36ff6-f6d0-4627-bc43-6beeb3495391 / GitHub21b81de 자동 배포|
| Preview content |2df93f07-3703-42ec-b576-fd085e8c839f / 기존 배포|

이번에 push/원격 읽기검수/배포/migration/Secret/실제AI를 실행하지 않았다. 위 버전은 기존 배포 기록을 재사용한다. 일반 Preview는 main push 자동 배포만, Production은 별도 사용자 요청이다.0000~0038·실제 자료/키/유료 결과·celebration/garden-v1/garden-v2·출력TTF/fontkit 패치를 보존한다. 이전 CI/운영 검사·LCP5.4초·기기/관측 한계와 rollback은[P9-04](work/P9-04.md)에 유지한다.

`pnpm dev`는 영속 합성`.wrangler/ui-demo-state/`, 기존 실제 로컬은`pnpm dev:local`, E2E는 임시DB 격리다. 이번 정적 검토본과 혼동하지 않는다.

## 실행·사용량·세션

최신 시작 Pro4% 사용/96% 잔여, 별도5시간 없음, 사용자 지정×10=960%. Computer Use node_repl은 WSL URI해석 시작 실패였다. 복구 skill을 따라 기존 `/bin/bash`·login:false·명시workdir·승인 검토로 Linux Playwright1.62.1을 사용했다. 셸 PATH상 node/pnpm은 없어 먼저 확인하고 현재 프로세스에만 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 추가한다. 동일 실패 경로를 반복하거나 앱/보안 설정을 바꾸지 않는다. 도구 추가 설치는 필요하지 않았다.

세션 유지. 다음P9-06 추천 **GPT-6.1-sol·High** — 낮/밤과 공개·풀이·관리자 화면을 같은 시각 체계로 연결할 대표 시안 판단이 필요하다.
