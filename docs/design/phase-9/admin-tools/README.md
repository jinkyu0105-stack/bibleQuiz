# 도구·설정 실제 화면

2026-10-14 P9-23의 도움말 공통 읽기 바탕을 적용한 실제 React 화면이다. 새 생성 시안이 아니며 기존 도움말 시안을 재사용했다. `tests/e2e/fixtures/admin-guide.ts`의 합성 GET 응답만 표시하며 실제 DB·비용·백업 자료는 포함하지 않는다. API 쓰기는 차단한다.

- tools, moderation, operations의 `-actual.png`는 낮, `-night.png`는 밤이다. 여섯 장 모두1440×1300px이다.
- [비교 페이지](../admin-boards/review.html#tools)에서 낮·밤을 전환하고 이미지를 눌러 원본을 연다.
- 도움말 내부의 filters/operations 설명 이미지도 같은 실행에서 현재 UI로 갱신한다.

```sh
BIBLEQUIZ_CAPTURE_ADMIN_GUIDE=1 BIBLEQUIZ_CAPTURE_ADMIN_GUIDE_ONLY=tools BIBLEQUIZ_CAPTURE_EMOJI_FONT=/mnt/c/Windows/Fonts/seguiemj.ttf pnpm test:e2e tests/e2e/admin-guide-capture.spec.ts --project=chromium --workers=1 --reporter=line
```

글꼴 경로는 촬영 기기의 선택 설정이다. 이미 설치된 Windows 글꼴을 브라우저 메모리에만 사용하며 글꼴 파일을 배포하지 않는다. 기존5173 서버와 로컬 자료는 유지하고 별도4173에서 캡처한다. HTTP200/image/png/디코딩 검증과 사용자의 Windows 화면 표시 확인은 구분한다. [디자인 정본](../../../spec/design.md#p9-23-후속--도구-읽기-면과-메뉴-동기화) · [검증 기록](../../../work/P9-23.md#도구-읽기-면메뉴-호버도움말-스크롤-통일).
