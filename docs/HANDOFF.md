# 인수인계

## 현재 작업: P9-26 조작판 재질·잠금 확정·입력 소섹션

2026-10-21 최신 사용자 요청을 로컬에 반영했다. 물음표22px/아래2px, 단계 클릭 진한 테두리 제거, 부드러운 광택과450ms 대각선 빛 스침, 잠금3번 배치 통일,공통 색유리 아이콘14종을 적용했다. 설교 정보는 위 안내와28px 떨어진 독립 소섹션이며 장절은24px 떨어진 다음 묶음이다. 공통fieldset margin:0/h3 규칙과의 간섭을 해당 폼에서 해결했다.

현재 P9-26 이번 요청 로컬 완료 · 부모 사용자 확인 대기 · 다음 재질/호버/소섹션 확인 · 세션 유지 · 추천 GPT-6.1-sol/high. 새 번호·push·배포로 자동 확대하지 않는다.

## 실제 상태와 재개 지점

- 시작main53c2815/clean. Pro잔여91%×사용자기준10=910%, 별도5시간 값 없음. 검증한 변경을 로컬 커밋한다. 다음 시작 시 git status/diff/log로 정확한 최종 커밋을 확인한다.
- 단계 외형: `QuizWorkflowSteps.tsx`/CSS. 번호별 data-lock-layout/분기/코너 자물쇠 CSS 제거. 모든 잠금은 이름과 묶어 가운데 정렬한다. 현재는 실행색 글씨/면/배지,이전은 눌림,미도달은disabled/대기. 포인터 진한 outline은 없고 키보드/강제색 초점은 유지한다.
- 재질: `GlossyIcon`/CSS는 얇은 사각 색유리,반구/진한 원형 링 없음. `HelpButton`CSS는 그림22px/아래2px/터치44px. `DialogCloseButton`과 기존 모달 동작은 유지했다.
- 입력: `SermonDrafts.tsx`/CSS. 소섹션 ‘설교 정보’와 ‘성경 장절 입력’. 필드 이름/순서/disabled/검증/등록 동작 유지. 외부 제목/날짜 검사도 기존 그대로다.
- 갤러리 `/dev/design#workflow`, `#glossy-icons`, `#help-button`. 자물쇠 위치 선택은 끝났고 ‘새 작업의 잠금 상태’ 예시로 바꿨다. API/규칙은 `src/components/README.md`,정본은 `docs/spec/design.md` 마지막 제작 단계 절.
- 저장 큐/provider/hook의 제품 코드는 변경하지 않았다. ‘다음 단계’는 진행 중인 자동 저장과 남은 편집 저장을 마친 뒤 최신 검수 조건을 확인한다. 실패/재검수 필요 시 입력과 현재 단계를 유지한다. ‘다음은 이동만’이라는 옛 설명을 쓰지 않는다.
- 등록 전 브라우저 보관 키는 `biblequiz:registration-input:v1` 한 벌. 진입/임시저장으로 DB 작업을 만들지 않는다. 확정/배치/Top N/AI/발행은 개별 명시 조작이다. `.wrangler/ui-demo-state`,실제 설교,원격 자료/schema는 변경하지 않았다.

## 검사와 확인 위치

- [실제 새 퀴즈 만들기](http://localhost:5173/admin/new?step=1)
- [네 시간대 실제 비교·소섹션](http://localhost:5173/docs/design/phase-9/workflow-controls/review#form)
- [실제 움직임·공통 아이콘](http://localhost:5173/dev/design#workflow)
- 관련 Chromium/모바일 E2E 최종 고유22건 통과,행렬/포인터 환경 중복2skip. 최초 접근성 이름 충돌2건/행렬시간초과1건/수동저장 타이머 경합1건을 보완해 관련 검사만 재실행했다. clock 적용 후 저장 큐0ms까지 멈춘 검사 문제도10ms 진행으로 해결했다. 제품 저장 로직은 변경하지 않았다. [상세 기록](work/P9-26.md#조작판-재질과-입력-소섹션-보정--2026-10-21).
- 최종 차이 검토에서 단계 키의 키보드 초점 offset을 안쪽5px로 보강하고 관련2건을 다시 통과했다. 포인터 외형 변화는 없다.
- lint/typecheck 최종통과. 전체pnpm check는 UI후속에서 미실행이며 Phase/배포 완료로 보고하지 않는다.
- 24상태(네 시간대×2560/1440/768/425/375/320px) 단계 한 행/맞닿음/넘침0.5173실제 새 폼12상태(네 시간대×1440/375/320px)도 넘침0,물음표22px/아래2px,안내와소섹션28px. 독립 브라우저 연습 입력 자동저장/녹색상태,모달,갤러리,hover를 촬영했다. DB쓰기/페이지오류0. `/tmp/p926-refined-live.json`.
- 새27PNG `refined-*` HTTP200/image/png. 비교 페이지12상태 이미지decode/넘침/오류검사 통과. `/tmp/p926-refined-http.json`. 기존generated/connected자료는 보존했다. 직접 이미지로 네 시간대/모바일 재질·입력 묶음을 확인했다.
- 실제폰/Safari/사용자 Windows표시 확인은 미수행이다. HTTP/decode성공을 사용자 기기 확인으로 보고하지 않는다. 브라우저 검사/촬영 중 코드·문서 저장은 Vite reload를 일으키므로 하지 않는다.
- 폐기: 클릭 강조 테두리,날카로운 가운데 광택,다섯 잠금 위치비교,제목 옆 선만으로 나누던 폼. 새 hover는1회transform/opacity,감소 모션에서정지. 외부아이콘파일은 사용하지 않았고공개작품과설명만참고했다.

## 환경·배포 경계

Node 24.18.0 / pnpm 11.14.0. bash, login:false, 명시적 cwd를 사용한다. pnpm PATH가 필요하면 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 추가한다. localhost·브라우저·Git 쓰기는 require_escalated 검토 경로다. 5173 서버를 유지하며, 재시작 명령은 `pnpm dev:demo --port 5173 --strictPort`다. 로컬 demo DB는 보존하고 E2E 4173은 격리 DB를 사용한다. 도구 시작 실패는 codex-exec-recovery를 따른다.

마지막 원격 일치 확인은 main 516a98e이며 배포 완료는 미확인이다. 마지막 완전 대조 Preview는 ceb50e3 / version 2227f720-c164-4c04-a014-cb2720fea411이다. 이번 변경은 push하지 않았으며 Preview 반영으로 안내하지 않는다. Production은 범위 밖이다.
