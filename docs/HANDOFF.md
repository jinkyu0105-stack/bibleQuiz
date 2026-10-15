# 다음 작업 인수인계

## 현재 작업과 Git

**P9-23 메인 효과 조작·작은 목록·스크롤 — 로컬 검증 완료, Preview 반영 준비.** 실제 /home/onegem/work/bibleQuiz의 main/origin5f13983·clean에서 시작했다. 현재 변경은 이번 요청 범위이며 관련 없는 변경은 없었다. 정확한 커밋/상태는 git status --short·git log -3·git rev-list --left-right --count origin/main...HEAD로 확인한다. 사용자의 앞선 main push 승인은 Preview 자동 반영만 포함하며 Production/원격 자료/AI/migration은 제외한다.

## 구현과 코드 진입점

- HomeEffectsControl/VeilControls: 빛줄기를 누르면 켜지고 인접 제어판을 연다. 별도 조절 버튼을 없애PC60×158·모바일132×44px 캡슐을 쓴다. 닫기/Escape는 빛을 유지하고 빛줄기 버튼으로 초점을 돌린다. 다시 열기는 켜짐을 유지하며 열린 상태에서 다시 누르면 끈다. 저장/범위 입력/초기화는 보존한다.
- home-page의 별도 참여 가능 퀴즈 구역만 제거했다. public-page/API/자료는 그대로다. RecentArchive/ArchiveCards의 홈 전용 iconActions가 제목 오른쪽44px 원형 링크와 작은 날짜/장절을 사용한다. 전체 /archive 카드와 개별 퀴즈 화면은 유지한다.
- useHomeSectionScroll/sky.css: 실제 푸터 높이를 관찰해 마지막 목록과 푸터를 묶는다. 긴 내용은 자연스럽게 읽고,1440×900에서는 한 번의 마지막 휠로 최하단에 도착한다. 메인의 스크롤 중에는 backdrop 굴절/흐림만 쉬고240ms 뒤 복원한다. 개인 선명하게/움직임 값은 바꾸지 않는다. 경로 이동 시 타이머/관찰자/표시를 정리한다.
- [정본](spec/design.md#효과-선택기와-veil-rays) · [구현/측정/실패와 재검사](work/P9-23.md#메인-목록과-스크롤-후속).

## 확정 검사와 한계

`pnpm check`2548건·lint/typecheck/build/구성 검사 통과. 관련 PC/모바일39항목 통과·PC전용1항목 모바일 제외, Firefox14항목 통과이며 초기 실패2건의 단독 재검사를 포함한다. 최초 실행은 Chromium38통과/1실패/1제외, Firefox13통과/1실패다. Chromium의 Router 임시 위치 관측은 실제 도착/이동 종료 대기로 보정했다. Firefox의 종료값 관측 실패는 동일 코드의 단독 trace 검사에서 통과했으며 최초 전체 성공으로 보고하지 않는다. 원격 전체CI는 별도로 확인한다.

실제5173에서 네 시간대×1440/390/320px의 제어판/목록24장·말풍선3장, 넘침/pageerror/쓰기API0을 확인했다. 소프트웨어 GPU의 같은 스크롤에서 평균 프레임 간격3회 중앙값191→84ms였으나 실기기 보장은 아니다. Lighthouse 모바일 성능28/접근성100·LCP7.9초/TBT6110ms로 초기 효과의 부담은 남는다. 실기기·Safari·화면 읽기 프로그램·Access 로그인 뒤 원격 저장은 미검증이다. 기존 fontkit 큰 청크/선명하게 이름 진단은 범위 밖이다.

근거는 ignored .wrangler/releases/p9-23/home-*의 로그/JSON/trace/PNG다. 마지막 전체check의 소스와 후속 문서만의 변경을 구별한다. 임시4187은 종료했으며5173과 .wrangler/ui-demo-state를 보존했다.

## 현재 Preview와 다음 동작

푸시 전 Preview는 **5a00bd79-65ac-41d9-816b-5ccfe8739b7d**·100%·2026-10-15 10:29:16KST이며 소스5f13983이다. Production app은 **7aea6843-5288-42da-9bef-bc673e1d9dfe**·100% 그대로임을 읽기 전용으로 확인했다. 다음은 검토한 파일만 stage/로컬 커밋하고 main push 후 정확한 소스/CI/Workers Builds/version을 대조하는 것이다. 원격 자료·Secret/Access·migration은 바꾸지 않는다.

## 실행과 화면 확인

- [실제 홈](http://localhost:5173/): 재생 아래 별 아이콘 → 빛줄기. 마지막 목록은 제목 오른쪽 원형 아이콘을 누른다.
- [실제 밤 제어판](http://localhost:5173/docs/design/phase-9/home-effects/rays-inline-night.png) · [작은 마지막 목록](http://localhost:5173/docs/design/phase-9/home-effects/archive-compact-day.png) · [모바일](http://localhost:5173/docs/design/phase-9/home-effects/rays-inline-mobile.png). 대표PNG4개의HTTP200/PNG 응답을 확인했으며 사용자 Windows 표시 확인과는 구별한다.

5173이 꺼지면 프로젝트 루트에서 `pnpm dev:demo --port 5173 --strictPort`. Node24.18.0/pnpm11.14.0이며 필요하면 현재PATH에 /home/onegem/.nvm/versions/node/v24.18.0/bin만 추가한다. E2E는 별도4173, 동시에 여러 번 실행하지 않는다. 명령은 검증된 /bin/bash·login:false·명시workdir·require_escalated 검토 경로를 쓴다. 도구 시작 실패는 codex-exec-recovery를 따르며 승인 거부는 우회하지 않는다. 이번 임시 검수 파일 작성의 자동 검토 시간 초과는 미작성 확인 후 한 번 재시도해 정상 진행했다.

마지막 사용량 Pro잔여53%×사용자 지정10=530%, 별도5시간 창 없음. 새 구현 전 현재 값을 확인한다. 읽기 순서는 AGENTS→PROJECT_CONTEXT→DECISIONS→STATUS→HANDOFF→implementation의 관련 정본→P9-23→Git 상태/diff/log다.

폐기한 접근: 홈 제거를 이유로 공개 API/자료 삭제, 원형 링크에 새 무거운 굴절 인스턴스 추가, 선명 모드를 강제 켜서 해결, 스크롤마다 같은 DOM 속성 쓰기, 짧은 스크롤 측정을 실기기 FPS 보장으로 표현하기.

**현재 P9-23 로컬 검증 완료 · 부모 메인 후속 보정의 Preview 반영 준비 · 다음 main push/원격 검증 · 세션 유지 · 다음 추천 GPT-6.1-sol/high** — 소스와 검사/배포 결과를 함께 확인한다.
