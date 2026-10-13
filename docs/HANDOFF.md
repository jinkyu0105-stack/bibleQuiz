# 다음 작업 인수인계

## 현재 상태와 다음 행동

**P9-20 운영 매뉴얼 시안 적용·사이드바·잔디 스케치 로컬 완료.** [구현·검사와 실패 보정](work/P9-20.md). 다음은 사용자 화면 확인이며 승인 범위의 미완료 구현은 없다.

[운영 매뉴얼](http://localhost:5173/admin/manual) · [관리자](http://localhost:5173/admin). 기존 `pnpm dev:demo --port 5173 --strictPort` 서버를 유지한다. 이번에는 4189를 확인하지 않았다.

## 변경과 보존

시작 Git은 main / b1a5d8d, clean이었다. 사용자가 명시 요청한 `imagegen-frontend-web`로 콘텐츠 패널 시안을 만들고, 목차와 단일 본문·모바일 선택 메뉴를 구현했다. 참고 PNG는 `docs/design/phase-9/manual-reader/`에 있고 런타임에서 내려받지 않는다.

진입점은 `ManualReader.tsx`, `manual-reader.module.css`, `manual-sections.ts`, 기존 Manual·ManualText·operations CSS다. 기존 14개 주제와 10개 서비스 설명을 모두 유지한다. 문장 내부 개행은 공백으로 읽고 짧은 서술부는 함께 표시한다. 매뉴얼 원문의 제작 순서를 3단계로 묶었으며 생성 사본도 동기화했다.

AdminNavigation과 CSS에서 ‘관리 공간’과 불필요한 여백을 없앴다. ThemeControl의 잔디는 사용자 스케치처럼 바닥선 하나와 세 줄이고, 켜짐 체크 배지는 제거했다. 꺼짐의 작은 빼기 배지·사진 전환·설정 저장·광원·접근성 이름은 유지한다. 관련 E2E 2개 파일, 디자인 정본·D-047·STATUS·이 인계를 갱신했다.

메인·하늘·외부 유리·기능·인증·자료 정책을 보존했다. `.wrangler/ui-demo-state`는 쓰기 없이 조회했다. 기존 가상 자료와 연습 모드 경계는 [P9-18](work/P9-18.md)을 따른다. 새 패키지·DB 변경·실제 AI 실행은 없다.

## 검사와 알려진 한계

- 관리자 PC/모바일/Firefox 최초 18건: 16통과·2실패. 같은 이름의 목차/다음 안내 버튼을 구별하도록 검사 선택자를 수정했다. 보정한 매뉴얼과 잔디 검사 9건 전부 통과했으며 **고유 24시나리오**의 통과 근거가 있다.
- 최종 lint/typecheck/build, 매뉴얼 사본 동기화, diff 검사 통과. 기존 fontkit 등 500KB 청크 경고는 남는다. Phase/배포 완료가 아니므로 전체 `pnpm check`는 반복하지 않았다.
- 실제 5173의 다섯 폭(1440~320px), 낮/밤, 320px 전체 24주제 선택·초점·다음 안내, 강제 색상 키보드와 네 시간대 잔디를 확인했다. 최종 가로 넘침/pageerror는 0건이다. 실기기/GPU·원격 인증 UI는 이번에 검사하지 않았다.
- 첫 실제 캡처에서 공통 nav flex가 목차를 좁히는 문제를 찾아 scoped block/padding으로 수정했다. 초기 Fast Refresh export 린트는 parser 파일 분리로 해결했다. 임시 시각 검사의 노을 식별자 sunset은 실제 dusk로 고쳤다.
- 반복 상자·채운 잔디 실루엣·문장 중간 강제 줄바꿈을 폐기했다. 증거는 Git 제외 `.wrangler/releases/p9-20/`에 있다. 비밀값을 추가하거나 출력하지 않았다.

검토한 파일만 명시적으로 stage해 로컬 커밋한다. 실제 종료 커밋은 `git log -1`로 확인한다. push하지 않는다.

## 원격과 재개 환경

Preview는 P9-14 소스 `0fbde84`, version `cd6efb0e-2c05-4401-b0bf-692bdf18c5b1`을 유지한다. Production은 P9-04 소스 `37b7254`, version `7aea6843-5288-42da-9bef-bc673e1d9dfe`를 유지한다. P9-17 이후의 UI·로컬 체험 변경과 이번 변경은 로컬이며 별도 사용자 지시 전 원격 반영하지 않는다.

Node 24.18.0 / pnpm 11.14.0. 검증된 `/bin/bash`, login:false, 명시 workdir와 승인 검토 실행 경로를 재사용한다. pnpm PATH는 `/home/onegem/.nvm/versions/node/v24.18.0/bin`이다. 시작 Pro 잔여 82% × 사용자 지정 10 = 820%였으며 별도 5시간 창은 없었다.

**현재 작업 P9-20 로컬 완료 · 부모 작업 매뉴얼 재설계 완료 · 다음 작업 사용자 화면 확인 · 세션 유지 · 다음 추천 Astra/max** — 시안과 실제 화면의 위계·여백을 함께 판단한다.
