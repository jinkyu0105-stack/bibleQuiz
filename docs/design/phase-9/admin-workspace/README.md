# 초안 6단계·퀴즈 설정 실제 화면

2026-10-14 P9-23에서 도움말·도구와 같은 읽기 바탕을 적용한 실제 React 화면이다. 새 생성 시안이 아니며 기존 도움말 시안을 재사용했다. `tests/e2e/fixtures/admin-workspace.ts`의 합성 GET 자료만 표시하며 API 쓰기는 차단한다. 실제 운영 자료·AI 결과·비용·참여자 정보는 포함하지 않는다. 격자의 가나다 조합은 배치 검사용 가상 단어이며 성경 본문이 아니다.

- `step-1`~`step-6`은 설교 영상·설교 의도·요약과 문제·격자 배치·최종 확인·발행, `settings`는 발행 정보를 펼친 퀴즈 설정이다.
- `-actual.png`는 낮, `-night.png`는 밤이다.14장 모두1440×1500px의 뷰포트 촬영본이며 긴 본문 전체를 압축한 이미지가 아니다.
- [비교 페이지](../admin-boards/review.html#workspace)에서 낮·밤을 전환하고 이미지를 눌러 원본을 연다. 기존 생성 시안·도움말·도구 촬영본도 그대로 보존했다.
- 같은 실행에서 도움말의 input/review/settings 설명 이미지3종도 현재 UI로 갱신한다. [설명용 자산 목록](../admin-guide/README.md).

```sh
BIBLEQUIZ_CAPTURE_ADMIN_GUIDE=1 BIBLEQUIZ_CAPTURE_ADMIN_GUIDE_ONLY=workspace BIBLEQUIZ_CAPTURE_EMOJI_FONT=/mnt/c/Windows/Fonts/seguiemj.ttf pnpm test:e2e tests/e2e/admin-guide-capture.spec.ts --project=chromium --workers=1 --reporter=line
```

글꼴 경로는 촬영 기기의 선택 설정이다. 이미 설치된 Windows 글꼴을 브라우저 메모리에만 사용하며 글꼴 파일을 배포하지 않는다. 기존5173 서버·로컬 자료는 유지하고 별도4173에서 캡처한다. HTTP200/image/png/브라우저 디코딩·확대 링크는 확인했으며 사용자 기기의 표시 확인과 구분한다. 네 시간대·모바일 검수는 정적 이미지 수와 별도로 [작업 기록](../../../work/P9-23.md#초안-6단계와-퀴즈-설정-통일)에 남긴다. [디자인 정본](../../../spec/design.md#p9-23-후속--초안-6단계와-퀴즈-설정).
