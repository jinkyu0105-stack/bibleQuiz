# 화면용 글꼴

P9-02, 2026-10-06. 한국어 제목과 본문이 운영체제 기본 글꼴에 따라 바뀌지 않도록 무료 OFL 웹 글꼴을 자체 호스팅한다. 기존 출력용 `NotoSansKR.ttf`, `OFL-NotoSansKR.txt`, fontkit 패치는 수정하지 않았다.

- 본문: Noto Sans KR400, Google Fonts v40의 공식 WOFF2 부분 글꼴.
- 제목: Noto Serif KR600, Google Fonts v32의 공식 WOFF2 부분 글꼴. 라이선스는 `NotoSerifKR-OFL.txt`.
- [공식 Noto Sans KR](https://github.com/google/fonts/tree/main/ofl/notosanskr), [공식 Noto Serif KR](https://github.com/google/fonts/tree/main/ofl/notoserifkr).
- 내려받은 파일의 URL·크기·SHA256는 [web/manifest.json](web/manifest.json)에 기록했다. 각 파일은 공식 Google Fonts CSS의 `unicode-range` 구분을 그대로 쓴다. 사용자의 자료나 제목을 Google에 전송하지 않았다.
- 최초 변환한 큰 2묶음 WOFF2는 느린 모바일 가정에서 로딩 지연을 확인해 폐기했다. 현재는 Google Fonts가 배포하는 작은 부분 글꼴을 로컬 정적 파일로 제공한다. 브라우저는 현재 화면에 필요한 글자가 든 파일만 받는다. 실제 화면 이용 시 Google/CDN 요청은 없다.
- `src/styles/fonts.css`: `font-display: swap`, Noto Sans KR400의 굵은 글씨는 weight synthesis, 제목은 실제600. glyph가 없는 문자는 시스템 fallback을 쓴다.
- 새 제품 패키지/서비스 의존성은 없다. 전체 글꼴 묶음을 페이지마다 미리 불러오지 않는다.
