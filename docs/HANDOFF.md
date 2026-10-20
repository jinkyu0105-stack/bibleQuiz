# 인수인계

## 이번 재개: 승인된 Preview push·배포 확인

2026-10-21 사용자가 main push와 Preview 완료 확인을 요청했다. 시작 HEAD 2e87173/clean, 원격 main 516a98e보다 24커밋 앞선 상태다. Pro 잔여 86% × 사용자 기준 10 = 860%, 별도 5시간 값 없음. 전체 `pnpm check` 최종 통과(2,568건 및 lint/typecheck/build). 첫 실행의 OPERATIONS_MANUAL_OUTDATED를 원본·앱 사본 동기화와 현재 새 퀴즈 안내로 수정했다. 로그 `/tmp/p926-preview-check-final.log`. 기존 번들 500kB 경고만 남고 빌드는 성공했다. 이 문서 작성 시점에는 아직 push 전이며, 커밋 후 GitHub Workers Builds 결과의 소스/Version ID와 Cloudflare 최신 배포의 100% 버전을 대조한다. Builds API는 현재 연결의 workers-ci.read 권한이 없어 GitHub 공식 check-run 결과를 사용한다. Production·migration·자료·실제 AI는 변경하지 않는다.

## 현재 작업: P9-26 제작 2~6단계 작업 소섹션

2026-10-21 사용자 요청을 로컬 구현·검사·문서에 반영했다. 1단계 ‘설교 정보’처럼 2~6단계의 제목·내용·관련 버튼을 함께 묶고 여백을 통일했다. 이번 요청은 로컬 완료, 부모 P9-26은 사용자 확인 대기다. 다음은 같은 화면의 사용자 피드백 반영이며 세션을 유지한다. 추천은 GPT-6.1-sol/high: 시각 보정과 저장·검수·접근성을 함께 확인한다. 새 번호·push·배포로 자동 확대하지 않는다.

## 실제 상태와 진입점

- 시작은 main c43b86a, clean이었다. 시작 Pro 잔여 89% × 사용자 기준 10 = 890%, 별도 5시간 값은 없었다. 검증한 변경을 로컬 커밋한다. 다음 재개 시 `git status --short`, diff, log로 최종 커밋을 확인한다.
- `src/features/admin-sermon-input/WorkflowSection.tsx`: 공통 제목·아이콘·상태와 본문 묶음. 같은 폴더 CSS의 metadataSection 재질을 재사용한다. 첫 묶음 위 24px, 묶음 사이 24px/모바일 20px, 안쪽 16px이다. 상태는 ‘검수와 저장’ 제목 옆에 둔다.
- `ContentGeneration.tsx`: 생성·작업 상태, 핵심 항목, 요약 문단·문제별 편집, 품질 평가, 검수·저장. 중복 시각 제목은 접근성 제목으로 유지한다. 원문 근거·편집·검수 동작은 그대로다.
- `ContentRegeneration.tsx`: 설명·필드·버튼 간격. `ContentPlacement.tsx`: 보기 설정, 어린이·장년 배치와 시험 결과, 저장·검사, 설교 요약, 미리보기, 단서 복사, 검수표, 공개 확인. 목표 수 입력 폭을 제한하고 모바일 10×10 줄바꿈을 막았다. 복사·발행 응답 메시지가 현재 단계에서도 보이게 했다.
- `WinnerSettings.tsx`: workflow 옵션에서만 공통 소섹션을 사용한다. 독립 설정 화면과 저장·검증은 유지했다. 공통 부품 갤러리 `/dev/design#workflow-section`에 실제 예시가 있다.
- 직전 카세트·아이콘·물음표·1단계 기준은 보존했다. 단계 선택은 진행 중 자동저장과 남은 편집 저장을 완료한 후 이동한다. 자동저장 900ms, WorkflowSave, 등록 전 브라우저 보관 키 `biblequiz:registration-input:v1`은 그대로다. 검수·AI·배치·Top N·발행은 개별 명시 조작이다.

## 확인 위치와 검증

- [실제 관리](http://localhost:5173/admin)
- [2~6단계 네 시간대·모바일 실제 화면](http://localhost:5173/docs/design/phase-9/workflow-sections/review)
- [공통 작업 소섹션](http://localhost:5173/dev/design#workflow-section)
- 관련 E2E 고유 41건과 lint/typecheck가 최종 통과했다. 초기 검사의 옛 제목 역할·넓은 details 선택·textarea 선택을 보완했다. 마지막 묶음은 첫 시도에서 종료 코드 143으로 중단됐다. 남은 4173 Vite만 정리한 뒤 재실행해 11통과/1중복 skip으로 확정했다. 5173은 유지했다. [상세 검사](work/P9-26.md#제작-26단계-작업-소섹션--2026-10-21).
- 다섯 단계 × 네 시간대 × 1440/375/320px의 60상태에서 가로 넘침·필드 경계 이탈·페이지 오류가 없었다. 펼친 근거·재생성·품질 평가도 네 시간대 PC/모바일로 확인했다. 기존 저장·검수·배치·발행 확인과 오류·선택 복원 회귀를 포함한다.
- 합성 자료를 넣은 실제 UI 48PNG와 비교 HTML, 총 49건의 HTTP 200 및 형식을 확인했다. 비교 페이지 60조합에서 이미지 로딩·넘침·오류 검사를 통과했다. 본문 촬영 때만 고정 헤더·하단바를 숨겼으며 비교 페이지에 명시했다. 기존 시안·캡처는 보존했다. 실제 설교나 AI 결과를 사용한 검사는 아니다.
- 실제 휴대폰/Safari와 사용자 Windows 화면의 표시 확인은 별도다. 전체 Phase/배포 완료가 아닌 UI 후속으로 전체 `pnpm check`는 실행하지 않았다. 새 의존성·원격 자료·실제 AI·schema·push·배포 변경은 없다.
- 폐기한 배치: 제목 밑에 붙은 첫 묶음, 전체 폭 목표 수 입력, 모바일 10×10 줄바꿈, 설명과 분리된 발행 버튼, 중복 시각 제목과 단독 상태 행. 업무 조건은 변경하지 않았다.

## 환경과 경계

Node 24.18.0/pnpm 11.14.0, bash login:false, 명시적 cwd를 사용한다. 필요하면 PATH에 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 추가한다. 일반 도구는 작동하며 localhost·브라우저·Git 쓰기는 require_escalated 검토 경로다. 도구 시작 실패는 codex-exec-recovery를 따른다. 5173 서버 명령은 `pnpm dev:demo --port 5173 --strictPort`다. `.wrangler/ui-demo-state`와 실제 자료를 보존한다. E2E 4173은 독립 임시 DB다. 브라우저 검사 중 소스·문서 저장은 Vite 재시작을 유발하므로 피한다.

마지막 원격 일치 확인은 main 516a98e이며 배포 완료는 미확인이다. 마지막 완전 대조 Preview는 ceb50e3/version 2227f720-c164-4c04-a014-cb2720fea411이다. 이번 변경은 로컬만이며 Preview 반영으로 안내하지 않는다. Production은 범위 밖이다.
