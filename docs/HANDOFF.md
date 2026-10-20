# 다음 작업 인수인계

## P9-26 연결형 조작판·글로시 공통 부품 — 2026-10-21

여섯 제작 단계 키를 하나의 외곽 안에 맞닿게 바꾸고 밝은 윗빛·중앙 반사·아래 음영을 강화했다. 이전 키는 눌림, 현재는 실행색 경계, 이후는 올라온 면이다. 양끝만 둥글며 클릭해도 접합이 벌어지지 않는다. 키높이는112/76/64px이며320px에서도 한 행이다. 사용자 사진은 연결감만 참고하고 데스크톱/좁은 화면 생성 시안2장을 만든 뒤 구현했다.

자물쇠는 사용자 비교용으로2글자 왼쪽 고정/3자물쇠와 글자 묶음 가운데/4숫자 왼쪽/5왼쪽 위/6오른쪽 위다. 실제 잠금 조건은 그대로다. 아직 한 위치로 통일하라는 선택은 없으므로 임의 통일하지 않는다.

물음표 그림은24px, 조작 영역44px다. 도움말·난이도 선택창·스크린샷 확대의 닫기는 공통 입체 부품을 사용한다. 글로시 아이콘14종을 공통화하고 저장 상태에 연결했다. 초록 체크는 실제 저장 성공일 때만 표시한다. 상단 ‘← 퀴즈 목록’과 미사용 CSS는 제거했다. 원래 단계 이동·자동/수동 저장·잠금·등록 조건과 사이드바는 유지한다.

현재 P9-26 이번 요청 로컬 완료 · 부모 사용자 확인 대기 · 다음 연결형 재질/자물쇠 위치 확인 · 세션 유지 · 추천 GPT-6.1-sol/high. 새 번호·push·배포로 자동 확대하지 않는다.

## 실제 상태와 재개 지점

- 시작main `1e68fc8`, clean. Pro잔여93%×사용자기준10=930%, 별도5시간 값 없음. 이번 검증 단위를 로컬 커밋한다. 다음 시작 시 `git status --short`, diff와 최근 log로 정확한 커밋을 확인한다.
- 단계 외형: `src/components/QuizWorkflowSteps.tsx`와 CSS. 사용자 번호별 비교는 `data-lock-layout`이며 저장/업무 조건은 props를 그대로 쓴다.
- 공통 부품: `GlossyIcon.tsx`/CSS, `DialogCloseButton.tsx`/CSS, `HelpButton` CSS. `AdminSermonInput` 저장 바에 GlossyIcon, `HelpDialog`/`QuizChoiceDialog`/`AdminScreenshots`에 공통 닫기를 연결했다.
- 실제 예시: `/dev/design#workflow`의 ‘자물쇠 위치 비교’, `#glossy-icons`의14종, `#help-button`의 물음표·닫기. 공통 API는 `src/components/README.md`를 따른다.
- 이전에 구현한 `workflow-save.ts`/provider/hook의 직렬 저장 큐는 변경하지 않았다. ‘다음 단계’는 진행 중인 자동 저장과 남은 편집 저장을 마친 뒤 최신 검수 조건을 확인한다. 실패/재검수 필요 시 현재 단계와 입력을 보존한다. ‘다음은 이동만’이라는 옛 설명을 재사용하지 않는다.
- 등록 전 입력은 브라우저 `biblequiz:registration-input:v1` 한 벌이다. 화면 진입/임시 저장으로 DB 작업을 만들지 않는다. 새 화면은 빈 폼이며 ‘불러오기’로 보관한 입력을 선택한다. 확정·배치 적용·Top N·AI 실행·발행은 명시적인 개별 조작이다.
- 기존 `.wrangler/ui-demo-state`·실제 설교 자료·원격 AI·DB schema·외부 의존성은 변경하지 않았다. 생성 시안은 승인된 디자인 참고 이미지이며 실제 AI 콘텐츠 호출과 다르다.

## 검사와 확인 위치

- [실제 새 퀴즈 만들기](http://localhost:5173/admin/new)
- [새 시안·네 시간대 실제 비교](http://localhost:5173/docs/design/phase-9/workflow-controls/review)
- [공통 글로시 아이콘](http://localhost:5173/dev/design#glossy-icons)
- 관련 Chromium/모바일 E2E 최초18통과/1실패/중복행렬1skip. 425px 제목 줄 높이로 키가86px이던 문제를 수정하고 행렬/자물쇠2건 재검사 통과. 최종 고유 통과19건. 저장·여섯 단계·잠금·키보드·모달/중첩확대·난이도선택 동작을 포함한다. [상세 기록](work/P9-26.md#연결형-조작판과-글로시-공통-부품--2026-10-21).
- lint/typecheck 최종통과. typecheck 최초 optional className 오류는 문자열 기본값으로 수정했다. 이후 미사용 CSS 제거·문서만 정리했다. 전체 `pnpm check`는 이번 UI 후속에서 실행하지 않았으며 Phase/배포 완료로 보고하지 않는다.
- 네 시간대×6폭(2560/1440/768/425/375/320px)24상태 한 행·1px 접합·넘침0. 실제5173 새 화면4시간대×1440/375/320px12상태와 갤러리375/320px 넘침0. 독립 브라우저 연습 입력 자동저장·초록 체크·닫기 입체감/초점복귀 확인. DB 쓰기/페이지오류0. `/tmp/p926-connected-live.json`.
- 새 PNG26개 HTTP200/image/png. 비교 페이지1440/375/320px×4시간대12상태 이미지decode·넘침0·페이지오류0. `/tmp/p926-connected-http.json`. 실제 PNG를 열어 네 시간대·모바일 재질을 비교했다. 기존 시안과 캡처를 덮어쓰지 않았으며 이번 접두사는 `connected-`다.
- 촬영 스크립트의 선택창 버튼 이름 불일치로 마지막 캡처가 시간 초과된 것은 실제 ‘선택창 열기’ 이름으로 수정해 완료했다. 제품 실패와 구분한다. 이전 독립 키/넓은 모바일 줄 높이 방식은 새 연결형/짧은 높이로 대체했다.
- 실제폰/Safari·사용자 Windows 화면 표시 확인은 미수행이다. 로컬 HTTP/decode 검증과 사용자 기기에서 보였다는 확인은 구분한다. 브라우저 검사 중 문서 저장은 Vite reload를 일으킬 수 있어 검사·촬영 중에는 편집하지 않는다.

## 환경·배포 경계

Node24.18.0/pnpm11.14.0. bash/login:false/명시 cwd. pnpm PATH가 필요하면 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 추가한다. localhost·브라우저·Git 쓰기는 require_escalated 검토 경로다. 5173 로컬 서버를 유지하며 재시작은 `pnpm dev:demo --port 5173 --strictPort`. `.wrangler/ui-demo-state` 보존, E2E4173은 격리 DB다. 도구 시작 실패는 codex-exec-recovery를 따른다.

마지막 원격 일치 확인은 main516a98e/배포 완료 미확인, 마지막 완전 대조 Preview는 ceb50e3/version2227f720-c164-4c04-a014-cb2720fea411이다. 이번 변경은 push하지 않았으며 Preview에 반영됐다고 안내하지 않는다. Production은 범위 밖이다.
