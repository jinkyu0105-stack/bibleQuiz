# 다음 작업 인수인계

## P9-26 투명 조작판·저장 후 이동·도움말 모달 — 2026-10-20

사용자가 선택한 원본 시안의 투명 이중 프레임·깊은 키·구분선·저장 바를 실제 제작 화면에 적용했다. 이전 단계는 눌린 면, 현재/이후는 올라온 면이며 잠금 숫자를 유지한다. 320px에서도 여섯 키가 한 행이다. 본문은 별도 불투명 영역이고 첫 제목 옆 물음표로 단계 도움말 모달을 연다. 네 시간대 시안4장·좁은 화면 시안1장을 생성하여 실제 화면과 비교했다.

‘임시 저장’은 화면 상단에 항상 있으며 실제 저장과 연결했다. ‘다음 단계’와 단계 키는 진행 중인 자동 저장과 남은 편집의 저장 완료를 기다린다. 실패하면 입력을 보존하며, 수정으로 검수가 풀리면 현재 단계에 남고 이유를 표시한다. 기존의 “다음은 이동만”, “도움말 모달 미구현”, “6/3/2열” 설명은 현재 구현과 다르므로 재사용하지 않는다.

등록 전 입력만 브라우저에 임시 보관한다. 새 화면을 열거나 임시 저장을 눌러도 DB 작업을 만들지 않는다. 재진입은 빈 폼을 유지하고 ‘불러오기’로 보관한 입력을 선택한다. 기존 퀴즈의 자막·분석·요약·문제 저장은 기존 버전 검사 API를 재사용한다. 설교 메타데이터는 확인 체크 후 저장하며, 배치 선택·Top N·확정·검수·AI 실행·발행은 각각의 명시 조작을 유지한다.

현재 P9-26 이번 범위 로컬 완료 · 부모 사용자 확인 대기 · 다음 화면 피드백 · 세션 유지 · 추천 GPT-6.1-sol/high. 새 작업번호·push·배포로 자동 확대하지 않는다.

## 재개 지점과 실제 상태

- 시작 main `993648b`, clean. Pro 잔여96%×사용자기준10=960%, 별도5시간 값 없음. 검증한 이번 변경을 로컬 커밋으로 남긴다. 다음 시작 때 실제 `git status`, diff, log로 커밋을 확인한다.
- 외형: `QuizWorkflowSteps.tsx`와 module CSS, `HelpButton` CSS, `HelpDialog.tsx`/CSS, `interior.css`, `Workspace.tsx`. 조작판과 본문의 중복 외곽을 제거했으며 기존 사이드바 모션은 유지한다.
- 저장: `admin-weekly/workflow-save.ts`, `WorkflowSaveContext.tsx`, `useWorkflowSave.ts`, `useAutosave.ts`에서 기존 저장 요청을 직렬 실행한다. 상태·시각은 실제 결과이며 저장 없이 새 시각을 만들지 않는다.
- 연결: `AdminSermonInput.tsx`, `ContentGeneration.tsx`, `SermonDrafts.tsx`. 등록 전 입력 키는 `biblequiz:registration-input:v1` 한 벌이다. 여러 버전 보관 기능으로 설명하지 않는다.
- 갤러리: `/dev/design#workflow`, `#help-button`, `#refresh`. 도움말의 작은 스크린샷 확대를 닫아도 원래 도움말은 유지한다. Esc/Tab/Shift+Tab/바깥 클릭/원래 물음표 초점 복귀 확인.
- 새 API·DB schema·외부 의존성 없음. 실제 설교 자료·원격 AI·기존 로컬 DB를 변경하지 않았다.

## 검증과 확인 위치

- [실제 새 퀴즈 만들기](http://localhost:5173/admin/new)
- [네 시간대·모바일 시안 및 실제 비교](http://localhost:5173/docs/design/phase-9/workflow-controls/review)
- [컴포넌트 갤러리](http://localhost:5173/dev/design#workflow)
- 관련 Chromium/모바일 E2E: 자동 저장 순서·재진입 보존·충돌/수동 실패·다음의 저장 대기·빈 화면 중복 생성 방지·여섯 단계 기존 조작·도움말/예시 확대·메타데이터 등록·원문 보호를 검사했다. 마지막 회귀 묶음17통과/화면행렬 모바일 중복1skip. 초기 실패와 수정·재검사는 [작업 기록](work/P9-26.md#투명-조작판저장-후-이동도움말-모달--2026-10-20)을 따른다.
- 네 시간대×2560/1440/768/425/375/320px,24상태에서 한 행·넘침0. 최종 실제5173 새 화면1440/375px는 쓰기요청0·페이지오류0·넘침0. 실제 화면 PNG를 열어 시안과 비교했다.
- 새 PNG17개 HTTP200/image/png, 비교 페이지1440/375/320px×4시간대12상태 decode 성공·넘침/페이지오류0. `/tmp/p926-cassette-http.json`. 갤러리 도움말 열기/닫기 확인. Windows 사용자 화면에서 실제로 보였다는 확인과 HTTP 검증은 구별한다.
- 최종 lint/typecheck 통과. `git diff --check`로 문서·코드 공백 검증. 실제폰/Safari는 미검수이며 이번 UI 후속은 Phase/배포 완료가 아니므로 전체 `pnpm check`를 반복하지 않았다.
- 브라우저 검사 중 문서를 저장하면 Vite 전체 reload가 발생할 수 있다. 검사·촬영 중 편집하지 않는다. 최신 실제 캡처는 `cassette-actual-*`, `cassette-new-*`, `help-*`이며 이전 시안/캡처도 보존했다.

## 환경·배포 경계

Node24.18.0/pnpm11.14.0. bash/login:false/명시 cwd. pnpm PATH가 필요하면 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 추가한다. localhost·브라우저·Git 쓰기는 require_escalated 검토 경로다. 5173 로컬 서버를 유지하며 재시작은 `pnpm dev:demo --port 5173 --strictPort`. `.wrangler/ui-demo-state` 보존, E2E4173은 격리 DB다. 도구 시작 실패는 codex-exec-recovery를 따른다.

마지막 원격 일치 확인은 main516a98e/배포 완료 미확인, 마지막 완전 대조 Preview는 ceb50e3/version2227f720-c164-4c04-a014-cb2720fea411이다. 이번 변경은 push하지 않았으며 Preview에 반영됐다고 안내하지 않는다. Production은 범위 밖이다.
