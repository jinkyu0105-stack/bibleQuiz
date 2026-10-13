# 다음 작업 인수인계

## 현재 상태와 재개 대상

**P9-22 진행 중.** 반복된 `stream disconnected before completion` 때문에 사용자가 새 세션 인계를 명시 요청했다. 완료 경계로 오인하지 않는다. 정확한 오류 원인은 확인하지 못했다.

현재 작업 경로는 `/home/onegem/work/bibleQuiz`, 브랜치는 main, 시작 커밋은 `01aa7a9`다. 인계용 부분 변경을 로컬 커밋으로 보존하며 종료 커밋과 잔여 변경은 `git log -1`·`git status --short`로 확인한다. push·배포·자료 변경은 하지 않았다.

[현재 작업 P9-22](work/P9-22.md)의 사용자 의도·남은 단계·코드 진입점을 읽고 **시안처럼 실제 사이드바와 매뉴얼의 콜아웃/본문/목차를 구현하는 작업부터 재개**한다. 색상 교체나 시안 생성만으로 완료한 것이 아니다.

## 저장된 것 / 아직 안 된 것

- 저장됨: 다섯 의미 색상 × 네 시간대, ‘관리 공간’ 굵은 고딕, 수평선 + 세 수직선의 잔디 아이콘, 새 사이드바 시안과 색상 비교 HTML. 정본/결정/작업 문서도 인계 시 갱신한다.
- 미완료: 새 시안의 실제 사이드바 그룹명·선택 표시·구분선, 매뉴얼의 느낌표 콜아웃·단계 번호/제목·목차/서비스 아이콘·읽기 위계. 이후 실제 네 시간대/모바일 캡처와 관련 검사·문서 마무리.
- 보존: 기존 메인·하늘·유리·메뉴 경로·접근성·모바일 접기·14개 문서/10개 서비스·자료/키·로컬 연습 DB.
- 제외: 새 의존성·실제 AI 호출·원격 DB 쓰기·push·Preview/Production 배포. 사용자 지적대로 잔디를 다시 곡선 풀잎으로 바꾸지 않는다.

## 첫 확인과 검사

AGENTS → PROJECT_CONTEXT → DECISIONS → STATUS → 이 HANDOFF → implementation 목차의 관련 디자인 정본과 P9-22 순서로 읽고 실제 Git diff/최근 log를 확인한다. 현재 사용량을 조회하고 사용자 지정 Pro 잔여 × 10 기준을 적용한다. 추천 Astra/max는 시안과 실제 화면의 시각적 위계 판단을 위한 것이다.

직전 부분 변경의 관련 PC/모바일 Chromium 및 Firefox E2E 12건 통과. 실제 5173에서 네 시간대·제목/잔디·매뉴얼/서비스·320px·시안 디코딩을 확인했으며 색상 24쌍 대비 5.20~8.40:1, 가로 넘침/pageerror 0건이다. 증거 `.wrangler/releases/p9-22/`는 Git 제외로 남아 있다. 미구현 콜아웃/사이드바 검사가 아니다. 인계 직전 lint/typecheck·git diff --check 통과, 수정 문서의 파일 링크 누락 0건, 사이드바 PNG 1536×1024와 색상 비교 HTML의 최종 HTTP 200을 확인했다. 색상 비교의 `.html` 주소는 확장자 없는 `/palette`로 정상 리다이렉트된다.

새 UI 변경 후 관련 테스트·lint/typecheck·필요 빌드를 수행한다. 전체 Phase/배포 완료 전에는 pnpm check를 따른다. 검사 성공만으로 시안과 같다고 판단하지 말고 실제 캡처를 직접 확인한다. STATUS/HANDOFF를 갱신하고 검토 파일만 로컬 커밋한다.

## 시안·서버·실행 경로

- 매뉴얼 시안: http://localhost:5173/docs/design/phase-9/manual-reader/reference.png
- 사이드바 시안: http://localhost:5173/docs/design/phase-9/admin-sidebar/reference.png
- 색상 비교: http://localhost:5173/docs/design/phase-9/admin-sidebar/palette.html
- 실제 앱: http://localhost:5173/admin/manual

이미 만든 시안을 재사용한다. Windows 앱 + WSL에서 이미지가 깨졌으므로 WSL 절대 경로 Markdown만으로 전달하지 않는다. 이미지 첨부 또는 실제 PNG 응답을 확인한 HTTP 주소를 사용한다. 사용자 앱 표시 확인과 HTTP 검증을 구별한다.

기존 `pnpm dev:demo --port 5173 --strictPort`를 유지했고 인계 전 `/admin/manual` HTTP 200을 확인했다. 새 세션은 포트부터 확인하며 자료를 다시 생성하지 않는다. Node 24.18.0 / pnpm 11.14.0. PATH가 필요하면 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 현재 셸에 추가한다. 검증된 도구 경로는 `/bin/bash`, login:false, 명시 workdir와 승인 검토 실행이다. 시작 실패는 codex-exec-recovery로 구분하고 승인 경계를 유지한다.

Preview: P9-14 소스 `0fbde84`, version `cd6efb0e-2c05-4401-b0bf-692bdf18c5b1`. Production: P9-04 소스 `37b7254`, version `7aea6843-5288-42da-9bef-bc673e1d9dfe`. 이후 UI 수정은 로컬이다.

**현재 작업 P9-22 진행 중 · 부모 작업 시안의 실제 UI 적용 미완료 · 다음 작업 같은 P9-22 구현/검수 · 세션 사용자 요청에 따라 새 세션 인계 · 다음 추천 Astra/max** (시안과 실제 화면의 위계를 함께 평가).
