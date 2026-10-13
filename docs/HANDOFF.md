# 다음 작업 인수인계

## 현재 상태

**P9-21 사이드바 제목·잔디 정교화·시안 표시 로컬 완료.** [구현과 검사](work/P9-21.md). 시작 main / `64bdaa2`, clean. 다음은 사용자의 화면 확인이며 미완료 구현은 없다. 실제 종료 커밋은 `git log -1`로 확인한다.

[관리자](http://localhost:5173/admin) · [시안 PNG](http://localhost:5173/docs/design/phase-9/manual-reader/reference.png). 기존 `pnpm dev:demo --port 5173 --strictPort` 서버를 유지한다. 4189는 이번 확인에서 응답하지 않았다.

## 변경과 판단

‘관리 공간’ 제목을 복원하고 24px 명조·글자 명암으로 표면감을 줬다. 제목 뒤 12px 간격과 모바일 접기는 유지한다. 잔디는 스케치를 그대로 복사한 세 줄 대신, 가운데가 높은 세 풀잎의 곡률·비례·밑동을 다듬었다. 작은 꺼짐 배지·사진 복귀·저장·접근성·광원은 유지한다.

진입점은 AdminNavigation.tsx와 CSS, ThemeControl.tsx, sky.css, 관련 admin-glass E2E다. 매뉴얼의 콘텐츠·목차는 P9-20 그대로다. 디자인 정본/D-047 후속 정정·시안 README·작업 문서·STATUS와 이 인계를 갱신했다.

사용자는 Windows 앱에서 WSL 경로 이미지가 깨진다고 보고했다. 기존 시안을 이미지 데이터로 재첨부하고 5173 HTTP PNG 제공/브라우저 디코딩을 확인했다. 브라우저 열기 도구는 queued였으므로 사용자가 실제로 보았다고 단정하지 않는다. 앞으로 WSL 이미지 경로 Markdown만 제공하지 않는 규칙을 AGENTS에 기록했다. 시안을 새로 생성하거나 복제하지 않았다.

## 검사와 보존

- 관련 Chromium PC / 모바일 / Firefox 9건, lint/typecheck, diff 검사 통과.
- 실제 5173의 네 시간대 제목·잔디 켜짐/꺼짐, 강제 색상 제목, 390/320px 모바일과 시안 디코딩 확인. 가로 넘침/pageerror 0건. 증거 `.wrangler/releases/p9-21/`.
- 작은 SVG·CSS 수정으로 전체 빌드/Phase 검사를 반복하지 않았다. 실기기/GPU·원격 인증 화면 및 사용자 측 시안 표시 확인은 이번 자동검사에 포함하지 않는다. 기술 검사와 미감 승인은 구분한다.
- 기존 가상 자료에 쓰지 않았고 새 패키지·migration·실제 AI 실행·push·배포가 없다. P9-18 연습 모드 경계와 기존 키/자료를 보존했다.
- 폐기한 접근: 스케치를 완성 아이콘처럼 그대로 베끼기, WSL 파일 링크만으로 이미지 전달, ‘관리 공간’ 제거.

## 원격·실행 환경

Preview: P9-14 소스 `0fbde84`, version `cd6efb0e-2c05-4401-b0bf-692bdf18c5b1`. Production: P9-04 소스 `37b7254`, version `7aea6843-5288-42da-9bef-bc673e1d9dfe`. 이후 UI 수정은 로컬이다.

Node 24.18.0 / pnpm 11.14.0. 검증된 `/bin/bash`, login:false, 명시 workdir와 승인 검토 실행 경로를 사용한다. PATH `/home/onegem/.nvm/versions/node/v24.18.0/bin`. 시작 Pro 잔여 81% × 사용자 지정 10 = 810%, 별도 5시간 창 없음.

**현재 작업 P9-21 로컬 완료 · 부모 작업 UI 보정 로컬 완료 · 다음 작업 사용자 화면 확인 · 세션 유지 · 다음 추천 Astra/max** (스케치 의도와 시각적 완성도를 함께 검토).
