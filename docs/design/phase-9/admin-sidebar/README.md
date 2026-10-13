# 관리자 사이드바 시안 — P9-22

2026-10-13 사용자 요청으로 `imagegen-frontend-web`를 사용해 관리자 좌측 사이드바 한 영역의 가로 시안 1장을 생성했다. `reference.png`는 1536×1024 이미지이며 새로운 제품 기능을 정의하지 않는다. 사용자는 이 시안을 실제 사이드바에 적용하라고 승인했다. P9-22에서 기존 메뉴의 실제 React 화면에 로컬 적용했다.

- 시안: http://localhost:5173/docs/design/phase-9/admin-sidebar/reference.png
- 네 시간대 색상 비교: http://localhost:5173/docs/design/phase-9/admin-sidebar/palette.html
- 기존 매뉴얼 시안: http://localhost:5173/docs/design/phase-9/manual-reader/reference.png

Windows 앱에서는 WSL 파일 경로 이미지가 깨질 수 있어 이미지 첨부 또는 확인한 HTTP 주소로 보여준다. PNG 응답 성공과 사용자 앱의 표시 확인은 구분한다. 색상 비교 HTML은 실제 CSS 토큰으로 만든 정적 비교 자료이며 실제 관리자 메뉴가 아니다. Vite는 `.html` 주소를 확장자 없는 주소로 리다이렉트할 수 있다.

시안의 작은 그룹명·굵은 고딕 제목·선 아이콘·활성 메뉴 색상/왼쪽 표시·구분선·하단 사이트 링크를 실제 기존 메뉴와 연결한다. 하늘 시간대에 따라 색상을 변경하고 기존 접기·키보드·호버 동작은 보존한다. 활성 항목의 배경과 왼쪽 표시는 다른 메뉴를 호버할 때도 남는다. 이미지 문구 자체를 기능 명세로 삼지 않는다. [실제 적용과 검증](../../../work/P9-22.md).
