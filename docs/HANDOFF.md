# 다음 작업 인수인계

## P9-26 제작 단계·입체 버튼 후속 — 2026-10-20

카세트 형태의6단계를 불투명 프레임 안에 구현했다. 번호1–6 유지, 이전 단계 눌림·현재 실행색 경계·잠긴 단계 자물쇠/대기,6/3/2열 반응형이다. 단계 제목과 설명은 본문 상단으로 통합하고, 이어하기/설교 정보 폼을 정리했다. 기존 수동 저장은 주간 화면에서 ‘임시 저장’으로 표시하며 다음 버튼은 이동만 한다. 새로고침 입체감과 작은 물음표 버튼을 공통 부품/갤러리에 등록했다. 도움말 모달 연결은 후속이다. [시안·실제 비교](design/phase-9/workflow-controls/review.html) · [상세](work/P9-26.md#제작-단계입체-버튼-후속--2026-10-20).

관련 E2E 고유35건은 수정·재검사 후 통과(동일 화면행렬의 모바일 중복 실행1skip). 최초32건29통과/3실패 후 이동 링크 복원·모바일 더보기/편집기 준비 대기 보완. 추가 도움말 검사에서 새 제목의 장식 이모지를 복원했다. 최종 화면행렬·모바일 도움말은 문서 저장에 따른 개발 서버 reload로 중단된 검사를 단독 재실행하여 통과했다. lint/typecheck 및 diff --check 통과. 네 시간대×5폭20상태 넘침0, 실제5173 새 화면1440/375px 쓰기요청0·오류0, 이미지13장 HTTP200/image/png. 실제폰/Safari와 전체Phase 완료 검사는 하지 않았다. 원격 자료·AI 콘텐츠·push/배포 변경 없음.

현재 P9-26 이번 범위 로컬 완료, 부모 사용자 확인 대기. 다음은 이번 화면 피드백, 세션 유지. 추천 GPT-6.1-sol/high: 저장·단계 이동 조건을 보존하면서 UI를 조정하는 범위다.

## 재개 지점과 주의 사항

- 시작 main `fbcea1d`/clean, Pro 잔여99%×사용자기준10=990%(별도5시간 값 없음). 이번 변경은 로컬 커밋으로 남긴다. 다음 시작 때 실제 log/status를 확인한다.
- 핵심 파일: `src/components/QuizWorkflowSteps.tsx`, `quiz-workflow-steps.ts`, module CSS, `HelpButton.tsx`; `AdminSermonInput.tsx`, `ContentGeneration.tsx`, `SermonDrafts.tsx`. 새 외부 의존성·API·DB schema는 없다.
- ‘다음’은 기존 가드에 따른 이동만 한다. 자동/수동 저장, 확정·검수·실제 AI 실행·발행의 구분을 유지한다. ‘임시 저장’은 자막 또는 현재 분석/요약/문제 편집기별 기존 저장이다. 모든 단계의 모든 폼을 일괄 저장하는 새 기능은 아니다.
- `/admin/new` 빈 화면을 열거나 기존 작업으로 이동하는 행위는 저장하지 않는다. ‘새 작업 등록’만 새 작업을 만든다. 기존 초안은 보존하고 목록 연필은 그대로 해당 작업을 연다.
- 사용자 요청으로 현재 이전 단계는 눌리고 현재/이후는 올라온 모양이다. 완료 여부와 현재 위치를 임의로 혼동하지 않는다. 숫자는 항상 표시한다. 새로운 단계명은 설교 준비/핵심 정리/문제 검토/격자 구성/최종 점검/공개하기다.
- 작은 물음표는 갤러리에 준비만 했다. 사용자가 언급한 향후 용어 안내 모달 전환은 이번에 실행하지 않았다. 기존 도움말 접기와 AdminMenu 사이드바 모션은 유지한다.
- 공통 nav flex가 단계 ol을 절반 폭으로 줄이는 문제는 width100%로 수정했다. 검수 대상 이동 링크와 기존 제목 장식 이모지는 회귀 검사로 복원했다. 테스트에서 모바일 더보기 열기와 편집기 표시 대기를 보완했다. 개발 서버 전체 reload를 피하려면 브라우저 검사/촬영 중 문서를 저장하지 않는다.

## 확인 위치와 검사

- http://localhost:5173/admin/new
- http://localhost:5173/dev/design#workflow (실제 카세트 키), #help-button (작은 물음표), #refresh
- http://localhost:5173/docs/design/phase-9/workflow-controls/review
- 시안2장과 실제 합성 GET 자료8장, 빈 로컬 화면2장, 버튼1장을 구분해 제공한다. HTTP 응답 확인은 Windows 사용자가 실제로 보았다는 확인과 다르다.
- 검사 로그: `/tmp/workflow-e2e.log`, `workflow-focused.log`, `workflow-final-e2e.log`, `workflow-final-help.log`, `workflow-final-audit.log`, `workflow-matrix-final.log`, `workflow-help-mobile-final.log`, `workflow-types-final.log`, `workflow-lint-final.log`. 최종 도움말 모바일/화면행렬 단독 통과, 여섯 단계 조작 PC/모바일 통과. 필수 lint/typecheck 통과. Phase·배포 완료가 아닌 UI 후속이므로 전체 pnpm check는 반복하지 않았다.

## 환경·배포 경계

Node24.18.0/pnpm11.14.0. bash/login:false/명시 cwd. PATH가 필요하면 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 추가한다. localhost·브라우저·Git 쓰기는 require_escalated 검토 경로다.5173 로컬 서버를 유지하며 재시작은 `pnpm dev:demo --port 5173 --strictPort`. `.wrangler/ui-demo-state` 보존, E2E4173은 격리 DB다. 도구 시작 실패는 codex-exec-recovery를 따른다.

마지막 원격 일치 확인은 main516a98e/배포 완료 미확인, 마지막 완전 대조 Preview는 ceb50e3/version2227f720-c164-4c04-a014-cb2720fea411이다. 이번 로컬 변경을 Preview에 반영됐다고 안내하지 않는다. Production은 범위 밖이다. 부모 P9-26 사용자 확인 대기·세션 유지, 다음은 현재 화면 피드백이며 새 작업번호나 push로 자동 확대하지 않는다.
