# 다음 작업 인수인계

## 현재 작업

**P9-25 모바일 정리·새로고침 첫 화면 개선 로컬 완료, 승인된 Preview 반영 중.** 시작4f8a2aa/clean·origin/main a8abc99. loadHome이 메인 자료를 지연하고 HomeContent의 이번 주 영역만 Await로 기다린다. 최상위 AppLoading과 영역 QuizLoading에서 큰 임시 박스를 제거했다. 기존 직접 풀이·오류/재시도·자료/영상/유리는 보존한다. 이전 로컬5개 커밋도 함께 main push한다. 이번 사용자 지시는 Preview까지 명시 승인하며 Production·원격 데이터·AI·인증 변경은 포함하지 않는다.

## 검사·한계

pnpm check 최종2552건/lint/typecheck/build 통과·종료파일0. 첫 실행은 완료 로그 뒤143이므로 재실행해 정상 종료를 확인했다. 첫 관련42건33통과/9실패, 전체314건304통과/6실패/4조건제외 뒤 남은6건 재검사 모두 통과. 실패는 이전 모바일 설정창 접근 가정 및 본문/폰트 준비 전의 스크롤 검사였으며 공통 도우미와 준비 조건으로 수정했다. 마지막 테스트 변경 뒤 lint/typecheck 통과. 실제5173 네 시간대×390/1440px8조합의 API 대기/완료를 비교해 제목 위치 유지·오류/넘침0. 원자료 ignored `.wrangler/releases/p9-25-loading/`. 실기기 검수·인증 후 Preview 화면은 아직 확인하지 않았다.

## 배포·다음

배포 전 Preview1b8025b1·100%, 바인딩16개·AI=false, Production7aea6843·100%. main push→Workers Builds 자동 배포→정확한 SHA/Worker version와 GitHub CI를 각각 확인하고 이 문서를 갱신한다. 직접 wrangler 배포로 우회하지 않는다. [상세 작업](work/P9-25.md#새로고침-첫-화면과-최신본-preview-반영). 휴대전화 주소 https://biblequiz-app-preview.jinkyu0105.workers.dev/ 는 기존 Cloudflare 계정 로그인이며 로컬 연습자료와 Preview DB는 다르다.

Node24.18.0/pnpm11.14.0, /bin/bash·login:false·명시workdir·require_escalated 승인 검토 경로. PATH 필요 시 /home/onegem/.nvm/versions/node/v24.18.0/bin 추가. 서버5173/.wrangler/ui-demo-state 보존, 재시작 pnpm dev:demo --port 5173 --strictPort. E2E4173 격리자료. Pro95%×사용자 기준10=950%. 다음 시작은 실제 사용량·Git 상태와 AGENTS→PROJECT_CONTEXT→DECISIONS→STATUS→HANDOFF→implementation 관련 정본→P9-25 순서 확인.

**현재 P9-25 진행 중 · 부모 로컬 개선 완료/Preview 반영 중 · 다음 배포·원격CI 확인 · 세션 유지 · 추천 GPT-6.1-sol/high** — 소스와 배포 대조에 적합하다.
