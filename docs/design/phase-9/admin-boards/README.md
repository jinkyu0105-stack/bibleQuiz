# 관리자 게시판 시안과 적용

2026-10-13 P9-23. 사용자의 ‘참여 기록과 문의는 게시판처럼, 어린이 | 공개는 한 줄로’ 요청을 `imagegen-frontend-web` 스킬로 각각 한 장씩 생성했다. 구체적 텍스트는 실제 HTML이 담당하며 시안은 글자 대신 자리 표시 막대를 사용한다. 그림을 앱 UI로 붙이지 않았다.

- [참여 기록 시안](submissions-reference.png): 생성 원본 1484×1060, 1,358,869bytes.
- [문의 게시판 시안](inquiries-reference.png): 생성 원본 1586×992, 1,245,363bytes.
- [참고처 조사와 선정 근거](research.md): `last30days` 실제 엔진 + 공식 문서. Refero Styles를 AI용 시각 참고처로, Carbon·Geist를 목록·버튼 규칙의 보완으로 선택했다.

HTTP 확인 주소: `http://localhost:5173/docs/design/phase-9/admin-boards/submissions-reference.png`, `http://localhost:5173/docs/design/phase-9/admin-boards/inquiries-reference.png`. 두 응답 모두 200 / image/png를 확인했다. 생성 이미지 자체도 대화에 표시했으며, HTTP 성공을 사용자 기기 표시 확인과 혼동하지 않는다.

실제 화면 `/admin/submissions`, `/admin/privacy-requests`, `/admin`에 연결했다. 참여 시안에 남은 개별 행 틈은 사용자의 게시판 요청에 따라 실제 코드에서 없앴다. 시안의 가상 답안별 성공/실패 색·장식 아바타는 제품에 없는 기능이라 적용하지 않았다. 모든 행은 같은 외곽 목록 안에서 얇은 선으로 이어지고, 제목/종류·상태/날짜/본문/도구 순서를 사용한다. 기존 하늘·투명 표면과 다섯 의미 색상은 유지한다.

적용 진입점은 `AdminListTools`, `AdminRecord`, `AdminGuide`이며 수치와 동작의 정본은 [디자인 명세](../../../spec/design.md#p9-23-후속--게시판과-관리자-공통-규칙)다. 실제 검수 대상·기능 검사·남은 한계는 [P9-23](../../../work/P9-23.md#게시판과-관리자-전체-검수)에 기록한다.

생성 원본은 Windows Codex generated_images의 현재 대화 폴더에 그대로 남겼다. 이 경로에는 배포된 AI 결과나 실제 참여자 자료가 들어 있지 않다.

이미지 전달 보완: [브라우저 확인 페이지](review.html)에서 실제 UI와 기존 시안을 한 장씩 열 수 있다. HTTP뿐 아니라 브라우저 디코딩을 확인했고 사용자가2026-10-13 실제 참여1장/시안2장이 모두 보인다고 답했다. 이후 최신 퀴즈 목록 예시도 같은 페이지에 추가했다. 새 이미지 생성/편집은 하지 않았다.
