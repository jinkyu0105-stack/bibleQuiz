# 다음 작업 인수인계

## 현재 작업과 Git

**P9-23 관리자 제목·이모지 가독성 보완 — 로컬 완료.** main `51fa60d` / clean에서 서비스 사전의 세 제목을 키우고 관리자 소제목 전반의 이모지를 보완했다. 로컬 커밋 제목은 `Improve admin section headings and emoji cues`다. 경로는 `/home/onegem/work/bibleQuiz`; 정확한 해시와 잔여 변경은 `git log -1`·`git status --short`로 확인한다. 문구·입력/실제 자료·원격 버전은 유지한다. push/배포는 없다.

다음은 사용자 로컬 화면 확인/피드백이다. 새 구현 ID나 원격 반영 승인을 만들지 않는다. [P9-23 후속 기록](work/P9-23.md#문구의미-색상공식-아이콘-후속-보정)에 실제 범위·검사 명령·초기 실패/보정과 한계를 모았다. P9-22 시안 적용 완료는 유지된다.

## 변경과 보존

- 최신 보완: 서비스 사전의 세 제목은 PC18px/모바일17px 굵은 글씨와 사용/문제/확인 이모지다. 오류/월간 비용/백업 소제목, 관리자 원문·검토·비용·참여 관리·사용 순서에도 의미별 장식 이모지를 연결했다. `AdminLabel`/`AdminEmoji`를 재사용하고 원문·입력·접근성 이름은 보존한다. 직전 오류/월간 비용의 구분선과 여백은 유지한다.

- 관리자 메뉴·제작 6단계·발행/수정 도구·참여/문의/필터/비용, 매뉴얼14주제·서비스10종·기능 검토 기록의 문구를 검토했다. ‘설교 자료’, ‘발행 취소’, ‘예상 비용’, ‘다시 공개’ 등으로 통일하고 어려운 안내를 목적/결과 중심으로 고쳤다. 실제 입력·설교/참여자 데이터·API/DB 정책·기술 식별자·가격 수치/확인일은 보존한다.
- 사이트 소개의 부자연스러운 개행은 `<br>`가 아닌 `ManualText`의 여러 단어를 묶는 `nowrap` 때문이었다. 이를 제거했다. 관리자 한글 단어를 유지하고 말풍선 용어의 바로 붙은 조사/어미만 함께 표시한다. 매뉴얼/기능 검토 기록의 Worker 사본도 동기화했다.
- `admin-help.ts`, `AdminHelp`/CSS, `AdminGuide`, `ManualReader`/CSS, `interior.css`:32개 개념·단계·목차·관리 메뉴 아이콘에 문맥별 다섯 의미 색상을 적용한다. 목차 호버는 진한 받침·테두리·왼쪽 표시, 말풍선은 중립 바탕·의미색 윗선/범주/꼬리다. 위쪽 우선/공간 부족 시 아래와 포인터·키보드·터치·Escape/초점 동작을 보존한다.
- `ServiceIcon`/CSS와 `public/images/services/`: OpenAI·Cloudflare·GitHub 공식 회사 로고 원본. 색/모양을 바꾸지 않고 밝은 받침을 사용한다. [출처·해시](../public/images/services/README.md). Cloudflare 서비스들은 같은 회사 로고, 서비스 주소는 지구본이다.
- `ThemeControl`의 수평 바닥선·세 수직선 형태는 그대로, stroke1.8→1.35px. 새 의존성·외부 서비스·새 이미지 생성은 없다. 기존 두 시안을 재사용해 실제 UI와 대조했다.
- 설명용 PNG8종을 최종 UI/문구로 재캡처했다(614,122bytes). 합성 연습 자료만 사용했고 현재 운영 자료/상태가 아니다. 확대·원본 크기·Tab 순환·닫기/초점 복귀를 유지한다. 글꼴은 캡처 메모리에 기존 Windows Segoe UI Emoji만 읽었으며 배포하지 않는다.

## 검사 결과와 한계

이번 제목 보정은 관련 Chromium PC/모바일44항목 중42통과·2실패였으며 이모지를 포함하지 않는 제목 문자열을 찾던 선택 조건을 정의 제목 범위로 고친 뒤 해당2건이 통과했다. 목록 숫자용 CSS의 이모지 글꼴 덮어쓰기와 조건부 문의/편집 제목을 추가 보완한 뒤 관련6건도 통과했다. lint/typecheck 통과. 실제5173 네 시간대 PC1440/모바일390의 오류/서비스16상태,24개 주제/서비스320px에서 크기/이모지·넘침0·pageerror0·API 쓰기0을 확인했다. 실제 캡처를 직접 열었다. 설명용 PNG8종도 현재 UI로 다시 촬영했다(캡처1건 통과). 8개 HTTP200·image/png·로컬 파일 일치를 확인했다. 상세 로그는 `.wrangler/releases/p9-23/emoji-*`이며 앞선 전체 관리자 검사와 최초 실패 기록은 [작업 문서](work/P9-23.md)에 보존한다.

이번 변경은 제목 표시와 CSS이며 build/전체 `pnpm check`/전체 E2E는 반복하지 않았다. WebKit의 기존 OS 라이브러리 누락은 미해결 상태로 Safari·실기기·화면 읽기 프로그램·Windows 사용자 화면의 직접 표시·원격 인증은 미검증이다. 기존 router hash 이동/fontkit 번들 경고도 유지한다.

## 화면·서버·실행

- 실제 매뉴얼: http://localhost:5173/admin/manual
- 퀴즈 관리: http://localhost:5173/admin
- 갱신 검수 예시 PNG: http://localhost:5173/images/admin-guide/review.png
- 다섯 의미 색상 비교: http://localhost:5173/docs/design/phase-9/admin-sidebar/palette
- 기존 시안: http://localhost:5173/docs/design/phase-9/manual-reader/reference.png 및 http://localhost:5173/docs/design/phase-9/admin-sidebar/reference.png

기존5173 `pnpm dev:demo --port 5173 --strictPort`를 재사용했다. 꺼졌으면 자료를 재생성하지 말고 서버만 켠다. Node24.18.0 / pnpm11.14.0. 필요할 때 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 현재 셸 PATH에 추가한다. 사용자에게 이미지는 WSL 경로만 주지 말고 이미지 첨부 또는 확인한 HTTP 주소로 전달한다. E2E는 별도4173 격리 서버를 쓰며 기존5173 DB를 바꾸지 않는다.

검증된 명령 경로: `/bin/bash`, `login:false`, 명시 workdir, `require_escalated` 승인 검토 실행. `codex-exec-recovery`에 따라 인계의 정상 경로를 재사용했다. 기본 exec 시작 전 ENOENT와 Node 도구의 WSL cwd URI 문제를 WSL 단절로 오해하거나 승인 거부를 우회하지 않는다. WebKit의 OS 라이브러리 누락은 별개의 환경 한계다.

앞선 문구·색상 보정 시작 Pro 잔여97% × 사용자 기준10 =970%, 마무리 조회는94% ×10 =940%다. 별도5시간 창은 없었다. 다음 구현 시작 시 현재값을 조회한다. 문서 순서는 AGENTS → PROJECT_CONTEXT → DECISIONS → STATUS → HANDOFF → implementation의 관련 디자인 명세 → P9-23 → Git 상태/차이/log다.

Preview는 P9-14 소스 `0fbde84` / version `cd6efb0e-2c05-4401-b0bf-692bdf18c5b1`, Production은 P9-04 소스 `37b7254` / version `7aea6843-5288-42da-9bef-bc673e1d9dfe`를 유지한다.

폐기한 접근: 문장 서술부 전체를 강제 묶기, 도움말 전체를 한 강조색으로 칠하기, 회사 로고를 범용 선 아이콘으로 대체하기, 실제 UI 대신 새 가상 시안 생성, 실제 자료를 정적 이미지로 사용, 입력/기술 식별자 자동 변환.

**현재 작업 P9-23 로컬 완료 · 부모 작업 관리자 이해 돕기 로컬 완료 · 다음 작업 사용자 화면 확인/피드백 · 세션 유지 · 다음 추천 GPT-6.1-sol/medium** — 한정된 문구·배치 보정과 관련 검사에 적합하다.
