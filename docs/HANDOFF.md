# 다음 작업 인수인계

## 현재 작업과 Git

**P9-23 관리자 이해 돕기 — 로컬 완료.** 기존 이모지·말풍선·확대 가능한 스크린샷 구현 `a52d84a`의 main / clean 상태에서 후속 요청인 ‘말풍선은 위쪽 우선, 공간 부족 시 아래’를 반영했다. 경로는 `/home/onegem/work/bibleQuiz`. 이 문서를 포함해 `Prefer tooltips above their triggers` 제목의 로컬 커밋으로 보존한다. 정확한 해시와 잔여 변경은 `git log -1`·`git status --short`로 확인한다. push·배포·실제 자료 변경 없음.

다음은 사용자 로컬 화면 확인/피드백이다. 새 구현 ID나 원격 반영 승인을 만들지 않는다. [P9-23](work/P9-23.md)에 범위·검사 명령·초기 실패/보정과 한계를 모았다. P9-22 시안 적용 완료는 유지된다.

## 변경과 보존

- 공통 `AdminHelp`와 `config/admin-help.ts`: 관리자 제목·단계·안내의 장식 이모지,29개 개념의 쉬운 설명. 요소 위를 우선하고 위쪽 공간이 부족할 때만 아래로 표시한다. 호버/키보드/터치·Escape/바깥 클릭·스크롤 위치 보정. 설교·참여자·입력 데이터와 완전한 기술 식별자는 변환하지 않는다.
- `AdminScreenshots`/CSS/설정과 `public/images/admin-guide/` PNG8종: 실제 앱에 합성 연습 자료를 표시해 캡처했다. 현재 운영 상태나 실자료가 아니다. 매뉴얼7개 주제와 관련 관리자 작업에서 작게 보고 확대/원본 크기/스크롤할 수 있다. Tab 순환, 닫기와 원래 버튼 초점 복귀, 기존 입력값 보존을 확인했다.
- 공통 `AdminGuide`와 admin-weekly/sermon-input/bible-reference/operations의 안내·제목을 연결했다. 제작·저장·확정·발행·문의·삭제·필터·백업 실행 로직과 API/DB는 변경하지 않았다. 기존 의미 색상·선 아이콘·고딕 제목·직선 잔디·원문/키/연습 DB를 보존한다.
- 이번 변경은 공통 말풍선 위치 계산과 경계/상호작용 검사다. 초기 구현의 도움말/합성 캡처/fixture와 기존 문의 검사를 보존한다. 정본·DESIGN·DECISIONS·목차·작업/자산 문서를 갱신했다. PNG 총610,197bytes이며 글꼴 파일·새 의존성·새 이미지 생성/실제 AI는 없다.

## 검사 결과와 한계

이번 위치 보정의 도움말 E2E18항목은 최초15통과·3실패였다. 위로 이동한 말풍선이 덮는 제목을 바깥 클릭으로 쓰던2건, 크기 변경으로 화면 밖에 나간 용어의 도움말이 닫히는 기존 동작을 고려하지 않은1건이다. 검사 조건을 고친 후 위치3건·상호작용3건(Chromium PC/모바일·Firefox)을 모두 통과했다. 변경 없는 나머지12항목의 성공 결과는 재사용했다. 최종 lint/typecheck 통과. build/전체 `pnpm check`/전체 E2E는 작은 배치 보정에서 재실행하지 않았다.

실제5173의 네 시간대 PC1440·모바일390에서 위쪽 표시와 아래쪽 예외, 추가320px 양방향까지18상태를 확인했다. 가로 넘침·pageerror·API 쓰기0. 실제 캡처를 열어 확인했으며 Windows 사용자 화면의 직접 표시 확인과 구별한다. 캡처 도구의320px 재열기 조건도 보정했다. 정적 예시 PNG8종과 기존 기능/자료는 그대로다.

초기 구현 `a52d84a`의 관련 회귀54건, 강조 용어 보정 후 검사, lint/typecheck/build와24개 매뉴얼 주제/서비스·PNG8종 HTTP 검증은 [작업 문서](work/P9-23.md)에 보존했다. 선택적 WebKit8건은 `libgtk-4.so.1`, GStreamer 등의 OS 라이브러리 누락으로 시작하지 못했으며 이번에는 재시도하지 않았다. Safari/실기기/화면 읽기 프로그램/원격 인증은 미검증이다. 기존 router hash 이동 경고와 fontkit500kB 번들 경고는 별도 사항이다.

Git 제외 증거: `.wrangler/releases/p9-23/tooltip-above/`의 `e2e.log`(15통과·3실패), `e2e-position-final.log`(3통과), `e2e-interaction-final.log`(3통과), lint/typecheck 최종 로그, `visual-results.json`과 PNG18종. 초기 구현의 검사·실제 화면 증거는 상위 `p9-23/`에 보존한다.

## 화면·서버·실행

- 실제 매뉴얼: http://localhost:5173/admin/manual
- 퀴즈 관리: http://localhost:5173/admin
- 검수 화면 예시 PNG: http://localhost:5173/images/admin-guide/review.png
- 기존 다섯 의미 색상 비교: http://localhost:5173/docs/design/phase-9/admin-sidebar/palette
- 기존 시안: http://localhost:5173/docs/design/phase-9/manual-reader/reference.png 및 http://localhost:5173/docs/design/phase-9/admin-sidebar/reference.png

기존5173 `pnpm dev:demo --port 5173 --strictPort`를 재사용했다. 꺼졌으면 자료를 재생성하지 말고 서버만 켠다. Node24.18.0 / pnpm11.14.0. 필요할 때 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 현재 셸 PATH에 추가한다. 사용자에게 이미지는 WSL 경로만 주지 말고 이미지 첨부 또는 확인한 HTTP 주소로 전달한다.

검증된 명령 경로: `/bin/bash`, `login:false`, 명시 workdir, `require_escalated` 승인 검토 실행. `codex-exec-recovery`에 따라 인계의 정상 경로를 재사용했다. 기본 exec 시작 전 ENOENT와 Node 도구의 WSL cwd URI 문제를 WSL 단절로 오해하거나 승인 거부를 우회하지 않는다. 이번 WebKit 브라우저의 OS 라이브러리 누락은 별개의 실행 환경 한계다.

이번 보정 시작 사용량: Pro 잔여98% × 사용자 기준10 = 980%. 별도5시간 창은 없었다. 다음 구현 시작 시 현재값을 조회한다. 문서 순서는 AGENTS → PROJECT_CONTEXT → DECISIONS → STATUS → HANDOFF → implementation의 관련 디자인 명세 → P9-23 → Git 상태/차이/log다.

Preview는 P9-14 소스 `0fbde84` / version `cd6efb0e-2c05-4401-b0bf-692bdf18c5b1`, Production은 P9-04 소스 `37b7254` / version `7aea6843-5288-42da-9bef-bc673e1d9dfe`를 유지한다.

폐기한 접근: 모든 문장에 자동 이모지 삽입, 사용자 자료/기술 식별자 변환, 스크롤마다 설명 닫기, 실제 UI 대신 새 가상 시안 생성, 실자료를 정적 이미지로 사용, 폼 검사에서 넓은 라벨 부분 일치 사용.

**현재 작업 P9-23 로컬 완료 · 부모 작업 관리자 이해 돕기 로컬 완료 · 다음 작업 사용자 화면 확인/피드백 · 세션 유지 · 다음 추천 GPT-6.1-sol/medium** — 한정된 문구·배치 보정과 관련 검사에 적합하다.
