# 관리자 게시판 시안과 적용

2026-10-13 P9-23. 사용자의 ‘참여 기록과 문의는 게시판처럼, 어린이 | 공개는 한 줄로’ 요청을 `imagegen-frontend-web` 스킬로 각각 한 장씩 생성했다. 구체적 텍스트는 실제 HTML이 담당하며 시안은 글자 대신 자리 표시 막대를 사용한다. 그림을 앱 UI로 붙이지 않았다.

- [참여 기록 시안](submissions-reference.png): 생성 원본 1484×1060, 1,358,869bytes.
- [문의 게시판 시안](inquiries-reference.png): 생성 원본 1586×992, 1,245,363bytes.
- [참고처 조사와 선정 근거](research.md): `last30days` 실제 엔진 + 공식 문서. Refero Styles를 AI용 시각 참고처로, Carbon·Geist를 목록·버튼 규칙의 보완으로 선택했다.

HTTP 확인 주소: `http://localhost:5173/docs/design/phase-9/admin-boards/submissions-reference.png`, `http://localhost:5173/docs/design/phase-9/admin-boards/inquiries-reference.png`. 두 응답 모두 200 / image/png를 확인했다. 생성 이미지 자체도 대화에 표시했으며, HTTP 성공을 사용자 기기 표시 확인과 혼동하지 않는다.

2026-10-14 사용자 재현 요청에 따라 실제 `/admin`, `/admin/submissions`, `/admin/privacy-requests`를 다시 적용했다. 기존에는 본문과 도구 버튼이 항상 보였으나 이제 시안처럼 짧은 행 전체를 펼친다. 참여는 답안/관리, 문의는 상태/답변을 좌우로 배치하고 모바일에서는 위아래로 놓는다. 문의의 관련 퀴즈 링크는 행 클릭과 겹치지 않도록 펼친 본문에 둔다.

시안의 개별 행 틈은 사용자의 연속 게시판 요청에 따라 없앴다. 가상 정오답 색·인물 사진은 만들지 않았고 실제 답안 좌표/입력값과 기존 선 아이콘을 쓴다. 하늘·투명 표면·다섯 의미 색상은 유지한다. 바깥 창은 맑은 유리, 핵심 현황·목록·펼친 내용은 선명한 바탕으로 구분했다. 퀴즈 관리의 현황3개와 Live는 한 행으로 합쳤고66px 목록 행을 유지한다. 작은 화면에서는 같은 현황 영역 안에서 두 줄로 이어진다.

적용 진입점은 `AdminBoardHeader`/`AdminListTools`·`AdminRecord`다. 수치·동작은 [디자인 정본](../../../spec/design.md#p9-23-후속--시안에-맞춘-세-게시판), 실제 검사는 [작업 기록](../../../work/P9-23.md#투명한-창과-현황live-한-행)을 따른다.

| 실제 UI 촬영본 | 해상도 | bytes |
|---|---|---|
| quiz-actual.png | 1056×803 | 228,090 |
| submissions-actual.png | 1056×1106 | 269,338 |
| inquiries-actual.png | 1056×932 | 217,114 |

실제 React UI에 합성 GET 자료만 넣어 촬영했으며 공개 가능한 연습 자산이다. 재현 명령은 [화면 예시 자산](../admin-guide/README.md)을 따른다. 기존 실제5173 자료를 촬영한 내부 검수 증거는 ignored `.wrangler/releases/p9-23/clear-boards-*`에 별도 보관하며 정적 자산으로 복사하지 않았다.

생성 원본은 Windows Codex generated_images의 현재 대화 폴더에 그대로 남겼다. 이 경로에는 배포된 AI 결과나 실제 참여자 자료가 들어 있지 않다.

이미지 전달: [브라우저 비교 페이지](review.html)는 현재 실제 화면3장과 기존 시안2장을 나란히 보여준다. 2026-10-14 HTTP200/image/png·브라우저 디코딩·320px 넘침 없음과 파일 크기를 확인했다. 사용자가 표시를 확인한 것은2026-10-13의 이전 실제 참여1장/시안2장이며, 이번에 갱신한 실제 화면3장의 사용자 기기 표시 확인과 구별한다. 새 이미지 생성/편집은 하지 않았다.
