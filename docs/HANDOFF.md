# 인계 — P8-02 향후 계획 이관·청구 대조·종료 판단

2026-10-06. **현재 P8-02 청구 검수 대기 / 부모 Phase8 진행 중 / 다음 P8-02 / 세션 유지.** 추천 GPT-6.1-sol·높음 — 기존 출시 조건과 실제 청구 증거를 대조한다. Pro16% 사용·84% 잔여·별도5시간 없음 → 사용자 지정×10=840%(공식 상품 배수 아님). 위임 없음.

## 이번 완료와 판정

격자 자동 제안·후보 생성 조건 개선은 향후13절에 보관했다. 이어 사용자가 Supadata 사용량 표시도 보류하도록 명시해 [향후14절](future/notes.md#14-향후-개발--supadata-사용량-표시)에 기록하고 D-041·release/architecture의 출시 범위를 맞췄다. Supadata 표시 때문에 종료를 다시 막지 않는다. 기존 자막 취득과 Free 연결은 유지한다. 관리자 UI/영문 알림/반복 시험도 기존 보류를 유지한다.

## 다음 첫 작업 — 공급자 청구 범위를 맞춘다

OpenAI `biblequiz-nonprod`의 표시 금액USD0.57를 사용자에게 받았다. 같은 이름 프로젝트2개 중 하나는 미사용이라는 보고도 받았다.9월24일 기존 프로젝트 선택/없으면 생성 안내는 기록에 있지만 두 번 생성한 경위는 미확인이다. 프로젝트 변경/삭제를 하지 않았고 중복 원인 조사를 새 출시 조건으로 넣지 않는다.

- OpenAI 날짜 범위 질문이 대기 중이다:10월1일~오늘인지 다른 기간인지. 이미 받은 금액/이름을 다시 묻지 않는다. 선택 기간·프로젝트 범위를 맞춘 뒤 새 설교5회USD0.490526와 약USD0.08 차이를 구분한다. 기존 공유 키의 로컬/Preview 비용과 과거 원장 이전분 때문에 운영 누적12회USD1.350974와 단순 비교하지 않는다. 필요하면 해당 기간의 일별 비용만 확인한다.
- Cloudflare Billing → Billable Usage의 표시 기간·총금액 질문은 아직 답변 대기다. 고정 구독료/발행 청구서는 구별한다. MCP 인증10000·OAuth 갱신 후 billing/history403 근거는 조사 문서에 있다. 같은 실패를 반복하거나 새 키/권한 확대를 요구하지 않는다.

남은 범위는 **공급자 청구 대조·상태/인계와 종료 판정(최종 pnpm check 통과)**이다. 이번은 문서 변경뿐이므로 기능 배포를 새로 요구하지 않는다. DO/Workflow/CPU/Builds/Access 미관측은 알려진 한계로 보존하며 새 감사 프로젝트로 늘리지 않는다. 완료한 실제 입력/PDF·백업/복원을 반복하지 않는다.

## 현재 설치·보존

소스701475820e7d4281a4948bac820ff326d9e2ced1 → Production app f8174f94-d983-4855-8d2d-d02756c41f44 / content66eb96c5-ad4c-4d01-85dd-a13aef598acf. backup3fb0e7c7-368b-45a9-89f9-2818739e415d 유지. Preview app7c356a97-f0f3-4793-ab7b-066b2ae2aeea / content2df93f07-3703-42ec-b576-fd085e8c839f 유지. 두 환경0000~0038, 폰트/fontkit·실제 자료/원문·유료 결과·키 보존. app에 Supadata, 비공개content에 OpenAI, backup에 R2가 연결돼 있다. 실제 키값은 출력/Git/대화에 넣지 않는다.

2026-10-06 소스6ad6931에서 최종 `pnpm check` exit0: unit308/Worker2187/Workflow4/recoveryCLI2/Python7·Node 도구·lint/typecheck/Drizzle/build 모두 통과. 기존500kB 번들 경고 외 실패 없음. 저장 로그는 `.wrangler/releases/p8-02-supadata-integration-20261004/final-closeout-check-20261006.log`0600이며 SHA/정확한 소스는 두 검증 JSON의 `releaseCloseoutDecision.mandatoryCheck`에 있다. 기존 배포 소스7014758 이후 기능 로직 변경 없이 문서·생성 매뉴얼 텍스트만 변경됐음을 확인했다. 이 검사 커밋을 원격 배포 소스로 쓰지 않는다.

완료한 실제 입력/PDF·백업/격리복원을 반복하지 않았고 새 AI/원격 쓰기/배포/main push0이다. 청구 답변만 받으면 코드 변경이 없으므로 전체 검사를 반복하지 않는다. 이번 문서 diff·링크·JSON 두 기록 일치 검사 결과도 보존한다. 출시 전체 완료는 아직 선언하지 않는다.

## 도구와 재개 경계

실행은 `/bin/bash`, `login:false`, 명시 workdir와 `require_escalated`가 검증된 경로다. 시작 ENOENT 발생 시 codex-exec-recovery를 사용하고 동일 실패 경로를 반복하지 않는다. 과거 /tmp 조회 도구는 세션 후 없어질 수 있으므로 자료 유실로 판단하지 않는다. 기존 Wrangler OAuth를 읽기 명령으로 갱신해 사용한다. 승인 거절은 우회하지 않는다.

스크린샷 Windows 경로는 /mnt/c로 읽을 수 있다. 별도 WSL Chromium과 사용자 Chrome/내장 브라우저 로그인은 다르다. Playwright 로그인 연결은 사용자가 나중으로 보류했다. 도구가 없는데 사용자 화면을 보고/조작했다고 말하지 않는다.

비공개 근거는 `.wrangler/releases/p8-02-supadata-integration-20261004/`의 closeout/placement JSON이다. 실제 후보·원문·계정 응답은 Git 제외다. 이번 시작 HEAD 6ad6931, main clean. 변경은 조사 문서·현재 안내·향후 계획·생성 매뉴얼 문자열이며 Git diff와 마지막 commit으로 확인한다. main push/배포하지 않는다.
