# 유리 UI의 투명도·프리즘 보완 조사

2026-10-09 · P9-06 · **조사 완료, 아래 수치는 제안이며 UI에 적용하지 않음**.

사용자는 영상 제작과 병행해 현재 Apple 참고 유리 UI를 더 투명하게 만들고 무지개빛 프리즘 효과를 보완할 방법을 요청했다. 권장 방향은 **맑은 제어 표면 + 가장자리 색 분산 + 방향성 있는 반사광**이다. 기존 HTML/CSS/SVG 구조의 확장으로 먼저 비교할 수 있어 새 서비스나 production 패키지를 도입할 이유는 아직 없다.

## 현재 구현에서 확인한 점

정본 코드는 [liquid-glass.css](../../design/phase-9/sky-v2/liquid-glass.css)와 [liquid-glass.js](../../design/phase-9/sky-v2/liquid-glass.js)다. 아래 비율은 CSS 배경색의 alpha이며 실제 광학 투과율이 아니다. 하이라이트 등 다른 층도 겹친다.

| 역할 | 낮 | 새벽·노을 | 밤 |
|---|---:|---:|---:|
| 헤더·시간대·CTA 등의 채움 | 60% | 63% | 76% |
| 읽기 패널의 채움 | 76% | 78% | 86% |

- 읽기 표면은 22px 흐림이다. 맑은 제어 표면의 기본 대안은 8px 흐림이며, 광학 경로가 켜지면 SVG 내부 0.7px 흐림에 CSS 3px 흐림을 더한다.
- 현재 굴절은 `feDisplacementMap` 하나로 모든 색을 같이 이동한다. RGB 분리·서로 다른 변위·재합성은 없다. 가장자리와 포인터 반사도 주로 흰색이다. 따라서 굴절이 작동해도 무지개빛은 만들어지지 않는다.
- 첫 화면 캡처에서 상단 캡슐과 시간대 선택기가 밝은 하늘을 넓게 덮는다. 채움·흐림을 줄이고 빛의 경계로 형태를 드러내는 것이 사용자의 요구에 맞는 보정으로 판단된다.
- **현재 관측과 과거 기록의 차이:** Playwright Chromium 151.0.7922.34에서 `CSS.supports`는 true지만 `Boolean(window.chrome)`는 false였다. 현재 코드의 조건 때문에 광학 필터가 0개, 헤더는 8px 흐림 경로였다. 페이지 오류는 0이다. 과거 Chromium 굴절 검증 기록을 이번 환경에도 그대로 적용할 수 없다. Codex 내장 브라우저의 실제 실행 값은 확인하지 않아 사용자 화면의 원인으로 단정하지 않는다. 다음 구현에서는 구문 지원·브라우저 식별·실제 렌더를 구분해 확인한다.

## 직접 볼 수 있는 참고 화면

| 참고 | 확인할 부분 | 이번 확인 범위 |
|---|---|---|
| [React Bits · Glass Surface](https://reactbits.dev/components/glass-surface) | Preview 안을 스크롤한 뒤 Customize의 Background Opacity와 Red/Green/Blue Offset을 비교한다. `Opacity`는 변위 지도 값이므로 바탕 투명도와 구분한다. | HTTP 200·렌더·슬라이더 이름/값·안내창 닫기 확인. 안내창이 나오면 오른쪽 위 ×로 닫는다. |
| [Liquid Glass for the Web](https://kucukkanat.github.io/liquid-glass/) | Live Playground에서 유리를 드래그한다. Tint는 흰 채움, Frost는 흐림, Aberration은 가장자리 색 분산이다. | HTTP 200·렌더 확인. 패턴 위에서 굴절과 색 테두리가 보이는 캡처를 확인했다. |
| [Liquid Glass 웹 데모](https://meapri.github.io/liquid-glass-web/) | 한국어 플레이그라운드의 클리어·색수차·스페큘러를 비교한다. 헤더/알림/버튼의 차이도 볼 수 있다. | HTTP 200·렌더·해당 제어의 존재 확인. 데모의 성능 홍보 문구를 본 프로젝트의 측정값으로 사용하지 않는다. |
| [Apple · Meet Liquid Glass, 10:31](https://developer.apple.com/videos/play/wwdc2025/219/?time=631) | 반사광, 그림자, 배경과 글자의 관계를 살펴본다. | 공식 설명/자막 확인. Apple 시스템 렌더러를 웹에서 그대로 쓸 수 있다는 의미는 아니다. |

앞의 웹 데모 3개는 자동 브라우저의 페이지 오류 0으로 열렸고 화면을 캡처했다. 모든 옵션·기기·프레임 성능까지 검증한 것은 아니다. 원본 사이트의 패키지는 설치하지 않았다.

## 권장하는 시각 보정

**먼저 헤더·시간대 선택·첫 CTA·하단 검토 탐색에서 차이를 만든다.** 아래 값은 첫 비교의 출발점이며 승인된 토큰이나 접근성 통과값이 아니다.

| 항목 | 첫 비교 제안 | 기대 효과 |
|---|---|---|
| 밝은 시간대 제어의 바탕 alpha | 현재 60~63% → 18~28% | 구름의 윤곽과 움직임이 유리 안에서도 읽힘 |
| 밤 제어의 바탕 alpha | 현재 76% → 25~40% | 짙은 판처럼 보이는 현상을 줄임. 밝은 구름 위 글자는 별도 확인 |
| 읽기 패널의 바탕 alpha | 밝은 시간대 55~68%, 밤 65~78%부터 비교 | 전체 재질을 가볍게 하면서 긴 글의 받침 유지 |
| 읽기 패널 흐림 | 22px → 12~16px부터 비교 | 균일한 우윳빛을 줄임. 텍스트 뒤의 배경 복잡도에 따라 조정 |
| 프리즘 | 가장자리의 좁은 띠에 작은 RGB 어긋남 | 유리 두께와 빛의 분산이 보임 |
| 반사 | 흰 반사점과 약한 청록·보라·살구빛이 일부 모서리에 모임 | 밝고 단조로운 하늘에서도 경계가 살아남 |

새벽의 샴페인/복숭아, 낮의 중립·하늘색, 노을의 따뜻한 빛, 밤의 달빛을 반사 강도와 색의 출발점으로 쓴다. 영상 원본 색을 바꾸는 필터와는 별개의 유리 레이어다. 프리즘은 상시 은은하게 보이고 포인터가 가까워지거나 눌렀을 때 조금 강해지도록 제안한다. 전체 테두리가 동일한 채도로 계속 회전하는 효과는 우선안에서 제외한다.

배경 픽셀의 RGB 분산만으로는 흰 구름과 흰 구름 사이에서 색이 크게 보이지 않을 수 있다. **실제 배경 굴절에 의한 색 테두리와, 조절 가능한 은은한 색 반사층을 함께 쓰는 방식**을 추천한다. 후자는 시각적 근사다. 퀴즈 글자·입력·선택 상태에는 색 분산을 걸지 않는다.

Apple은 빛·그림자·굴절을 함께 다루며 제어/탐색층과 콘텐츠층을 구분하고 유리의 중첩을 피하도록 안내한다. 네이티브 Clear는 미디어 위의 사용 조건과 대비 보조가 있다. 우리 웹에서 표면 역할에 따라 채움을 다르게 제안하는 것은 독자적 해석이며 Apple Regular/Clear API를 혼합 적용한다는 뜻이 아니다. [Apple 공식 설명](https://developer.apple.com/videos/play/wwdc2025/219/)

## 구현 방법의 비교

| 방식 | 장점 | 한계·판단 |
|---|---|---|
| CSS 투명도·흐림·색 반사 테두리 | 현재 코드로 가능. 브라우저 대안 경로에도 유지하기 쉬움 | 배경의 실제 RGB 굴절은 아님. 이것만으로 끝내면 프리즘이 장식처럼 보일 수 있음 |
| **기존 SVG 굴절에 RGB 분산 + CSS 반사 추가** | 현재 지도/요소 측정/포인터 처리를 재사용. 실제 배경 변화가 유리 가장자리에 드러남 | **추천.** Chromium 중심 강화와 다른 엔진의 CSS 대안을 함께 검수해야 함 |
| 영상/이미지를 WebGL 텍스처로 굴절 | 직접 관리하는 미디어의 색 분산을 더 세밀하게 제어할 여지 | 영상 좌표·스크롤·4K 재생·잔디와 동시 성능을 새로 검증해야 함. 임의 DOM 전체를 자동으로 정확히 복제하는 것으로 가정하지 않음. 첫 보정에는 과함 |

추천안의 추가 API/서비스 비용은 없고 production 의존성 추가도 필요하지 않다. 브라우저가 매 프레임 수행하는 필터 비용은 생기므로 무료라는 것이 성능 부담 0을 뜻하지 않는다. 기존의 크기 변경 때 지도 생성과 포인터 이벤트 갱신을 재사용하는 범위로 시작한다.

기술적 경로는 `feDisplacementMap`의 서로 다른 변위 세기, `feColorMatrix`의 R/G/B 추출, 재합성을 배경 전용 층에 적용하는 것이다. 텍스트와 입력 DOM은 바깥에 둔다. 가운데는 변화가 작고 가장자리에서 강해지는 지도를 사용한다. [MDN 변위](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feDisplacementMap) · [MDN 색 행렬](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feColorMatrix) · [React Bits 작성자 코드](https://github.com/DavidHDev/react-bits/blob/main/src/content/Components/GlassSurface/GlassSurface.jsx)

CSS의 `backdrop-filter` 자체 지원과 SVG URL을 배경에 실제 렌더하는 지원은 다르다. Kube의 브라우저 데모와 rdev 문서는 Chromium 강화/Safari·Firefox의 굴절 한계를 명시한다. MDN은 URL 구문을 설명하므로 구문을 받는 것만으로 효과가 보인다고 판단하지 않는다. [Kube의 원리와 데모](https://kube.io/blog/liquid-glass-css-svg/) · [rdev 구현 및 한계](https://github.com/rdev/liquid-glass-react) · [MDN backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter)

## 최근 커뮤니티에서 얻은 근거와 한계

`last30days` 3.26.0을 실제 실행했다. 2026-09-09~10-09 범위의 반환 결과는 Reddit 9개·HN 7개·GitHub 2개다. 마지막 7일 안에 날짜가 있는 항목은 6/18개이며, 전체 18개를 모두 유효한 UI 근거로 취급하지 않는다. HN에 섞인 Liquid Network/AI 냉각/모델 이야기는 제외했다. GitHub 저장소의 조회 날짜를 출시일로 해석하지 않는다.

- 9월 26일 투명도 토론에서 u/Jazper6313은 “I keep mine at full clear”(조회 시 +32), u/Forever_Nocturnal은 “Full clear and I wish I could go even more clear!”(+26)라고 썼다. [첫 댓글](https://reddit.com/r/LiquidGlassDesign/comments/1wqzbrc/comment/pc89ogp/) · [두 번째 댓글](https://reddit.com/r/LiquidGlassDesign/comments/1wqzbrc/comment/pc9xk03/)
- 9월 15일 토론에는 회색/흰 막으로 유리가 플라스틱처럼 느껴진다는 반응이 있었다. 사용자 요청과 닿는 취향 근거이며 기술적 오류나 전체 사용자의 합의를 입증하지 않는다. [원문 토론](https://www.reddit.com/r/LiquidGlassDesign/comments/1wgqshv/from_liquid_glass_to_liquid_plastic/)
- 10월 5일 작성자는 유리를 좋아하지만 자신의 사용자들은 읽기 때문에 일반 다크 모드를 선호한다고 설명했다. [가독성 개선 요청](https://www.reddit.com/r/LiquidGlassDesign/comments/1wy3n56/looking_for_advice_on_how_to_improve_liquid_glass/)

위 최신 반응과 별도로 Apple·MDN·작성자의 기술 문서를 대조했다. 웹 검색으로 일부 Reddit 원문 열기가 실패했으나 인용 댓글은 last30days가 반환한 본문/작성자/주소에서 읽었다. X·YouTube·TikTok·Instagram 조사는 하지 않았다. 일부 Reddit 보완 검색은 HTTP 422를 기록했다. 검색 결과 수를 완전한 최근 여론 조사로 보고하지 않는다.

진단에서는 기존 GitHub 인증이 구성되어 있었고 무료 공개 경로로 진행했다. 쿠키 읽기, 키 출력/저장, 설치 마법사, 계정 변경, 유료 API 호출을 하지 않았다. Context7의 library→docs로 `/mdn/content`를 조회한 뒤 MDN 원문을 대조했다. 현재 검토본은 native HTML/CSS/JS이며 React 컴포넌트를 그대로 도입한 것이 아니다.

## 다음에 구현할 때의 범위

같은 P9-06에서 현재 승인된 새벽 영상과 레이아웃을 보존한 비교본을 만든다. 현재 유리 버전을 남기고 독립 보정층으로 투명도·프리즘 강도를 비교한 후 선택 결과를 기록하는 것이 제안이다. 이번 조사만으로 새 스타일을 확정하거나 전체 앱에 반영하지 않는다.

관련 검수는 네 시간대의 글자/입력/선택 대비, 1440/2560 및 모바일 배치, 최신 새벽 영상 재생 중 가장자리 효과, 움직임 정지·투명도 감소, Chromium과 CSS 대안 경로, 실제 모바일의 스크롤/재생 부담이다. 과거 정적 이미지 420표본이나 이전 영상 대비 결과는 새 제안의 통과 근거가 아니다. Safari/WebKit·실기기 검수는 남아 있다.

이번에는 보고서·STATUS·HANDOFF·작업 기록만 갱신한다. `DESIGN.md`/설계 명세/결정 정본과 HTML/CSS/JS, 영상·프롬프트·이미지·폰트는 바꾸지 않는다. push/배포 없음.

재현 자료는 Git 제외 `.wrangler/design-references/p9-06-prismatic-glass/`에 있다. query-plan, last30days raw, 현재 새벽 캡처, 공개 데모 3개의 화면/DOM 관측을 보존한다. 원문 수집 결과를 프로젝트 정본에 복사해 쌓지 않고 필요한 인용과 링크만 기록한다.

문서 확인: 변경 문서의 로컬 링크/앵커48개 오류0, `git diff --check` 통과. 실행 코드 변경이 없어 lint/typecheck/기존 출시 검사는 반복하지 않았다.
