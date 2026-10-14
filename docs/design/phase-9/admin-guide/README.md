# 관리자 화면 예시 자산

P9-23 사용자 요청의 확대 가능한 설명용 이미지다. 새 디자인 시안이 아닌 **현재 React 컴포넌트의 실제 렌더링**이며, `tests/e2e/fixtures/admin-guide.ts`의 가상 연습 자료만 표시한다. 실제 운영의 결과·자료·백업 상태·비용을 캡처하지 않았다. API는 브라우저 안에서 합성 GET으로 응답하고 쓰기는 차단한다. PNG는 `public/images/admin-guide/`에 보존한다.

2026-10-14 P9-23 인덱스·불투명 목록 바탕 보정으로 dashboard/privacy/submissions3종을 다시 촬영했다. 후속 도구 읽기 바탕 통일에서 filters/operations2종, 초안/설정 통일에서 input/review/settings3종을 다시 촬영했다. 마지막3종은 `tests/e2e/fixtures/admin-workspace.ts`의 합성 GET 자료를 쓴다. 비교 페이지용 퀴즈 촬영본에는 투명 사이드바도 포함한다. 게시판 예시는 같은 캡처 경로의 `boards` 모드에서 여러 건의 합성 자료로 만들며, 실제 DB를 바꾸지 않는다. 도움말 비교용3장은 `manual` 모드로 별도 생성하고 설명용8종에 섞지 않는다.

퀴즈 목록·설교 정보·요약/난도 검수·발행 후 설정·참여 조치·문의 답변·필터 시험·비용/백업의 8개 설명에 사용한다. 표시 위치/제목/대체 텍스트/설명은 `src/config/admin-screenshots.ts`, 확대 기능은 `src/components/AdminScreenshots.tsx`를 따른다.

| 파일 | 해상도 | 크기(bytes) |
|---|---|---|
| dashboard.png | 990 × 364 | 61,228 |
| filters.png | 990 × 375 | 25,574 |
| input.png | 932 × 543 | 39,675 |
| operations.png | 990 × 354 | 22,558 |
| privacy.png | 988 × 410 | 32,733 |
| review.png | 932 × 635 | 71,622 |
| settings.png | 990 × 423 | 43,761 |
| submissions.png | 988 × 484 | 46,057 |

재생성은 프로젝트 루트에서 명시적으로 실행한다. 기존 로컬 연습 DB를 바꾸지 않는 격리 E2E 서버를 사용한다.

```sh
BIBLEQUIZ_CAPTURE_ADMIN_GUIDE=1 pnpm test:e2e tests/e2e/admin-guide-capture.spec.ts --project=chromium --workers=1 --reporter=line
```

세 게시판만 갱신하려면 위 명령에 `BIBLEQUIZ_CAPTURE_ADMIN_GUIDE_ONLY=boards`를 추가한다. 같은 실행에서 [시안 비교 페이지](../admin-boards/review.html)의 실제 낮3장·밤3장도 촬영한다. 퀴즈만 재촬영할 때는 `dashboard`를 사용한다. 세 도구의 낮·밤 실제 화면6장과 filters/operations 설명2장만 갱신할 때는 `tools`를 사용한다. 도움말 실제3장은 `manual` 모드다. 초안6단계·설정의 낮/밤14장과 input/review/settings 설명3장은 [`workspace` 모드](../admin-workspace/README.md)로 갱신한다.

Linux에 이모지 글꼴이 없으면, 이미 설치된 글꼴 경로를 `BIBLEQUIZ_CAPTURE_EMOJI_FONT`로 전달할 수 있다. 이번 WSL 캡처는 Windows의 설치된 Segoe UI Emoji를 브라우저 메모리에만 읽어 사용했다. 글꼴 파일을 앱·Git에 포함하거나 새 의존성을 설치하지 않았다. 앱 자체는 사용자 기기의 시스템 이모지 글꼴을 쓴다.

확인 주소 예: http://localhost:5173/images/admin-guide/review.png. 실제 화면: http://localhost:5173/admin/manual. 정적 예시들은 낮 테마를 기준으로 설명하고, 이를 감싸는 도움말/확대 UI는 네 시간대 색상을 따른다. 캡처 후 각 파일을 직접 확인하고 자산·문구가 실제 화면과 맞는지 다시 검토한다. Windows 앱에서의 사용자 표시 확인과 HTTP/디코딩 검사는 구별한다.

[디자인 기준](../../../spec/design.md#p9-23-관리자-이모지용어-도움말화면-예시) · [검사 기록](../../../work/P9-23.md).
