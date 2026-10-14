# 다음 작업 인수인계

## 현재 작업과 Git

**P9-23 메인 첫 화면의 Mercury 반사 — 로컬 완료.** `/home/onegem/work/bibleQuiz`, main `6771250`/clean에서 재개했다. 이번 로컬 커밋 제목은 `Add a transparent mercury reflection to the home hero`다. 최종 해시/작업 폴더는 `git log -1`·`git status --short`로 확인한다. 다음 화면 피드백도 같은 P9-23에서 처리한다.

## 현재 구현

- 사용자가 ‘메인페이지에만 해보세요’라고 실제 적용을 확정했다. `home-page.tsx`의 첫 소개 구역에만 `HeroMercury.tsx`·`hero-mercury.ts/css`를 연결했다. 기존 영상 위·글자/버튼 아래의 독립 투명 WebGL 반사이며 유료 원본 코드/자산을 사용하지 않는다. 아래 퀴즈·관리자·다른 페이지에는 적용하지 않는다.
- 네 시간대에 어울리는 반사색, 중앙 글자 주변/가장자리의 강도 감소, 느린 마우스 변형을 적용했다. 최대960×720·DPR1·30fps다. 화면 밖/탭 숨김은 정지, 기존 멈춤/움직임 감소는 정지 그림, 선명하게/투명도 감소/강제 색상은 숨김이다. 이동 시 자원을 정리하고 GPU 미지원/컨텍스트 손실에는 기존 하늘을 유지한다.
- 기존 제목 오른쪽 달력/상태/보관 유리 박스, 균일한 말풍선 경계와 꼬리1px 보정, 노을 팔레트·투명 외곽/불투명 본문 기준은 그대로다.
- [정본](spec/design.md#메인-첫-화면의-mercury-반사--p9-23), [이번 구현·검사·성능 한계](work/P9-23.md#메인-첫-화면의-mercury-반사), [직전 말풍선 보정](work/P9-23.md#말풍선-꼬리-접합부-보정).

## 검증과 남은 범위

- 관련 E2E20건 통과·Firefox GPU 전용4건 명시적 제외. 해상도/노이즈 조정 후 Chromium PC/모바일 GPU8건 재통과. 기존 홈 이동·선택·스크롤·설정, 새 장식 분리·키보드·정지·GPU 손실/복구·미지원 대안을 확인한다. 첫8건의2실패는 면적 없이 닿은 구역의 그리기가 계속되던 오류였고 비율1% 기준으로 수정했다.
- lint/typecheck/build 통과. 기존 fontkit500kB와 일부 정적/동적 import 중복 경고는 남는다. 전체check/전체E2E·Safari·실기기/화면 읽기 프로그램은 이번 후속 범위에서 실행하지 않았다.
- 최종 실제5173 네 시간대×1440/390/320px12화면과 다른 경로12상태에서 가로 넘침·GPU/pageerror·자료 쓰기0. 영상 재생·효과/글자 순서·아래 구역에서 정지·다른 페이지 제외를 확인하고 실제 PNG를 직접 검토했다. 새 그림/실제 자료를 공개 자산에 넣지 않았다.
- Lighthouse 모바일 모의/SwiftShader 비교는 편차가 컸다. 조정 전 끔/켬 성능56/46·TBT242/549ms, 조정 후34/45·TBT1720/607ms. 최적화 성공이나 실제 모바일 GPU 성능으로 일반화하지 않는다. 실제 기기 확인은 남는다. 접근성 점수100과 별도로 기존 선명하게 버튼의 보이는 이름/접근성 이름 차이는 진단에 남는다.
- 증거는 ignored `.wrangler/releases/p9-23/mercury-*`. 최종 E2E는 `mercury-final-e2e.txt`·`mercury-optimized-e2e.txt`, build는 `mercury-final-build.txt`, 촬영은 `mercury-visual.json`·`mercury-home-*.png`, 성능은 `mercury-built-*.json`·`mercury-optimized-*.json`이다. 임시4187 빌드 검사 서버는 종료하고 실제5173은 유지한다.
- 홈HTTP200 확인. 앱 열기 반환은 queued로 사용자 표시 확인과 다르다. `.wrangler`의 HTTP는403이므로 그 안의 이미지를 사용자 링크로 주지 않는다. 실제 홈 주소나 이미지 첨부를 쓴다.

폐기한 접근: 불투명 검정 바탕으로 기존 하늘 덮기, 홈 밖으로 확대하기, 높은 버퍼 해상도와 픽셀별 삼각함수 노이즈. 유료 원본 구매·새 의존성·실제 AI·자료 쓰기·원격 변경·push/배포는 없다.

## 실행과 다음 첫 작업

- 실제 메인: http://localhost:5173/ (효과가 안 보이면 기존 ‘선명하게’가 켜져 있는지 확인)
- 실제 관리자: http://localhost:5173/admin
- 기존 시안/실제 비교: http://localhost:5173/docs/design/phase-9/admin-boards/review#workspace
- 노을 비교: http://localhost:5173/docs/design/phase-9/admin-boards/review#sunset
- 시간대별 색상표: http://localhost:5173/docs/design/phase-9/admin-sidebar/palette

5173을 유지했고 `.wrangler/ui-demo-state` 자료를 바꾸지 않았다. 꺼지면 루트에서 `pnpm dev:demo --port 5173 --strictPort`. Node24.18.0/pnpm11.14.0. PATH에 없으면 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 현재PATH에만 추가한다. E2E는 별도4173 격리 서버이며 동시에 실행하지 않는다.

실행은 검증된 `/bin/bash`, `login:false`, 명시workdir, `require_escalated` 승인 검토 경로를 쓴다. 이번 프로세스 시작 실패는 없었다. 직전 Windows Node REPL은 `sandboxCwd is not a local file URI: file:///home/onegem/work/bibleQuiz`로 시작 전에 실패했으므로 이번에는 기존 WSL Playwright를 썼다. ENOENT를 WSL단절로 판단하거나 승인 거부를 우회하지 않는다. 촬영과 소스/자산 편집은 순서대로 한다.

시작 Pro잔여66% × 사용자 지정10 =660%, 별도5시간 창 없음. 다음 구현 전 사용량을 확인한다. 읽기 순서: AGENTS → PROJECT_CONTEXT → DECISIONS → STATUS → HANDOFF → implementation 관련 명세 → P9-23 → Git상태/diff/log.

Preview는 P9-14 소스 `0fbde84` / version `cd6efb0e-2c05-4401-b0bf-692bdf18c5b1`, Production은 P9-04 소스 `37b7254` / version `7aea6843-5288-42da-9bef-bc673e1d9dfe` 그대로다.

**현재 P9-23 로컬 완료 · 부모 관리자 이해 돕기 로컬 완료 · 다음 사용자 화면 확인/피드백 · 세션 유지 · 다음 추천 GPT-6-astra/max** — 기존 화면과 움직임의 시각적 균형을 함께 대조하는 후속 보정에 적합하다.
