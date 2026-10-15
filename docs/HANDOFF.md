# 다음 작업 인수인계

## 현재 작업

**P9-25 모바일 헤더·화면 설정 로컬 완료.** 사용자 요청의 오로라 제거, 모바일 헤더 한 줄·원형 관리 버튼, 우측바 전체를 하단 네 번째 버튼에 모으기와 배경 너비 축소를 구현했다. 시작main d6c0c4e, clean. 기존 자료/영상/유리/나머지 세 효과 보존. 새 의존성·유료 호출·실제 자료·push/배포·Production 제외.

## 현재 동작과 진입점

`ThemeControl`이 기존 컨트롤 한 벌과 `PageDock` 네 번째 화면 설정 버튼을 연결한다. PC 우측바 유지,700px 이하 메인에서는240px 하단 바와 필요할 때만 열리는236px 비모달 설정창이다. 시간대/재생/효과/선명하게/잔디 모두 포함한다. `mobile-settings.css`가 팝업과 가로 화면을 맡는다. 공통 헤더는`sky.css`의60px 한 줄·44px 원형 관리 링크,380px 이하 보조 브랜드만 숨김이다. 다른 페이지의 배경 설정은 기존 본문 뒤 위치를 유지한다.

`HomeEffectsControl`·`flow-settings`·`hero-effects`에서 오로라 버튼/설정 읽기/GPU 분기를 제거했다. 옛 저장값은 무시하고 반사·빛줄기·비단결은 유지한다. 닫힐 때 패널만 초기화하고 실제 효과 값은 유지한다. `EffectControls`는 제목/닫기를 고정하고 수치 부분만 스크롤한다. 작은 세로 화면은 위로,560~700px 너비/540px 이하 높이는 옆으로 연다. 중첩Escape·외부 터치/초점 이탈·저장 거부·OS 접근성·회전 후 초점 복귀를 보존한다.

[실제 메인](http://localhost:5173/) · [전후·네 시간대·최신 설정창](http://localhost:5173/docs/design/phase-9/home-effects/mobile-review). 실제PNG9장과flow-review의 최신PNG참조를HTTP200/image/png·파일 일치·1280/390/320px 디코딩/넘침0로 확인했다. Windows 사용자 표시 확인과는 별개다. 과거 오로라 촬영 파일은 역사 자료로 보존했지만 현재 안내에는 나오지 않는다.

## 검사·한계

최종 Chromium PC/모바일60건 통과·실패/자동 재시도0. Firefox8건 통과 후44px을43.999992px로 보고한 측정 오차1건을 보정해 재검사1건 통과. 단위319건·lint/typecheck/build 통과. 실제5173 네 시간대×1440/390/320px의12조합(닫힘/설정/수치 패널)·667px 가로와320px 다른 경로 헤더를 촬영하고 직접 대조했다. 페이지/GPU 오류·넘침·쓰기API0. 관련 전체 동작은 [P9-25 기록](work/P9-25.md)을 따른다.

첫E2E49통과/11실패는 새 팝업 진입/새로고침 대기·숨긴 요소 가정·등장 중 위치 비교·가려진 제목 클릭과 실제 회전 초점 문제를 드러냈고 모두 보정했다. 전체check·전체E2E·원격CI·실제 휴대전화 하드웨어 검수는 이번에 반복하지 않았다. 기존 fontkit500KB 번들 경고와 이전 초기 로딩 성능 한계는 유지한다. 근거는 ignored `.wrangler/releases/p9-25/`의 `final-e2e.log`, `firefox*.log`, `unit.log`, `final-{lint,typecheck}.log`, `build.log`, `visual-*.json`, `landscape.json`, `report-proof.json`. 실제 영상/유리/렌더 상한은 보존하며 성능 향상 수치를 주장하지 않는다.

## Git·실행·다음

이번 P9-25는 검증한 파일을 로컬 커밋한다. 시작HEAD d6c0c4e, 로컬 추적origin/main a8abc99. 이번 push/원격 상태 재조회 없음. 직전 확인 Preview1b8025b1-777c-470d-ae5d-be2740506c39·Production7aea6843-5288-42da-9bef-bc673e1d9dfe이며 이번 코드의 배포 완료로 쓰지 않는다. 다음 작업 시작에서 실제`git status/diff/log`를 다시 확인하고 기존 변경을 보존한다.

Node24.18.0/pnpm11.14.0. 기본명령 시작실패 대응은 검증된`/bin/bash`, login:false, 명시workdir, require_escalated 승인 검토 경로를 사용한다. 승인 거부는 우회하지 않는다. 필요 시`/home/onegem/.nvm/versions/node/v24.18.0/bin`을PATH에 추가한다. 서버5173/.wrangler/ui-demo-state 보존; 재시작은`pnpm dev:demo --port 5173 --strictPort`. E2E4173은 격리자료. 실제 촬영/E2E 중 소스·정적 파일을 수정하지 않는다.

사용량 시작Pro99%×사용자 기준10=990%, 별도5시간 창 없음. 다음 신규 구현 전에 다시 확인한다. 읽기 AGENTS→PROJECT_CONTEXT→DECISIONS→STATUS→HANDOFF→implementation 관련 정본→P9-25→Git. **현재P9-25 완료 · 부모 모바일 화면 정리 로컬 완료 · 다음 사용자 화면 피드백(필수 후속 없음) · 세션 유지 · 추천GPT-6.1-sol/medium** — 범위가 한정된 UI 보정과 관련 검사에 적합하다.
