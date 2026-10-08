# BibleQuiz 하늘 영상 입력 자료

2026-10-08 · P9-06 · 사용자가 Google AI Studio / Gemini API에서 직접 생성하기 위한 자료다. 영상 생성과 사이트 연결은 아직 하지 않았다.

## 이미지와 프롬프트

| 시간대 | 업로드할 PNG | 완성 프롬프트 | 색 기준 |
|---|---|---|---|
| 새벽 | [sky-dawn.png](references/sky-dawn.png) | [dawn.txt](prompts/dawn.txt) | 차분한 파랑·옅은 샴페인/복숭아빛 |
| 낮 | [sky-day.png](references/sky-day.png) | [day.txt](prompts/day.txt) | 맑은 파랑·아이보리 흰 구름 |
| 노을 | [sky-dusk.png](references/sky-dusk.png) | [dusk.txt](prompts/dusk.txt) | 살구/샴페인빛 구름·채도를 낮춘 청록빛 하늘 |
| 밤 | [sky-night.png](references/sky-night.png) | [night.txt](prompts/night.txt) | 남색/코발트·은빛 구름·고정된 달/별 |

[미리보기·PNG 다운로드·프롬프트 복사 페이지](index.html). 각 txt는 공통 지시까지 포함한 완성본이다. 다른 프롬프트와 합칠 필요가 없다.

## 직접 생성하는 순서

1. 사용할 시간대의 PNG 한 장을 저장하고 해당 프롬프트 전체를 복사한다. 네 이미지를 한 요청에 함께 넣지 않는다.
2. **Image-to-video의 시작 이미지/First Frame**에 PNG를 넣는다. API에서는 `image` 입력이다. 장면 소재를 묶는 `referenceImages` 입력과 구분한다. 마지막 프레임/`lastFrame`을 지정할 수 있으면 **같은 PNG**를 넣는다.
3. 모델은 `veo-3.1-fast-generate-preview`를 비용 기준 추천으로 제시한다. 다른 후보는 `veo-3.1-generate-preview`이며 이번에 두 모델의 실제 품질을 비교한 것은 아니다. 출력은 **4K(3840×2160)·16:9·8초**다. SDK의 `config`에 `resolution: "4k"`, `aspectRatio: "16:9"`, `durationSeconds: 8`을 설정한다. 프롬프트에 4K라고 적는 것만으로는 출력 해상도가 바뀌지 않는다.
4. 생성 후 원본 MP4를 곧바로 저장한다. 이름은 `sky-dawn-4k.mp4`, `sky-day-4k.mp4`, `sky-dusk-4k.mp4`, `sky-night-4k.mp4`를 권한다. API의 결과 보관은2일이므로 다운로드한 파일을 기준으로 작업한다.

[Google 공식 생성/프레임/해상도 안내](https://ai.google.dev/gemini-api/docs/veo). 같은 첫/끝 이미지와 루프 프롬프트도 **완벽한 반복을 보장하지 않는다**. 결과를 받은 뒤 경계의 밝기/모양/속도를 확인하고 필요하면 반복 구간을 편집한다. 카메라 확대/축소보다 구름 자체의 움직임을 우선했다. 생성 소리는 웹 연결 단계에서 제거/음소거한다.

2026-10-08 공식 단가로 Fast4K는8초당 **$2.40**, 네 시간대를 한 번씩 만들면 **$9.60**이다. Standard4K는8초당$4.80, 네 편$19.20이다. 세금/재시도는 별도이며 실제 잔액과 모델 이용 권한은 사용자 계정에서 확인한다. [Google 공식 가격표](https://ai.google.dev/gemini-api/docs/pricing). 네 입력을 준비한 것이 네 편의 실제 생성이나 API 비용 지출을 대신 승인/실행한 것은 아니다.

## 참조 이미지의 실제 해상도와 색

모든 PNG는 **1672×941**이다. 기존 낮/밤 PNG 원본을 같은 크기의 Chromium 화면에서 표시하고 현재 시안의 CSS 필터·빛 레이어를 적용해 내보냈다. 새벽/낮/노을은 같은 낮 원본, 밤은 별도의 밤 원본에서 왔다. 글자·UI·움직임·산·잔디를 제외했고 원본 전체 구도가 보이도록 첫 화면의 가장자리 확대만 제거했다. 새 그림 생성이나4K 업스케일을 하지 않았으며 원본 파일은 그대로 보존했다. 영상 모델이 만드는4K 출력과 이 입력 해상도를 구분한다.1672×941은16:9에 매우 가깝고 출력 시 가장자리가 소폭 조정될 수 있다.

특히 현재 노을 CSS의 상단 하늘은 청록 기운이 있다. 이를 임의로 보라색/주황색으로 바꾸지 않고 참조에 담았다. 프롬프트도 이 색과 살구빛 구름을 유지하도록 맞췄다. 새벽/노을의 색은 영상 도중 변화시키지 않는다. 추후 이 네 영상을 연결하면 이미 포함된 시간대 색에 기존 필터를 이중으로 적용하지 않도록 조정해야 한다.

원본/출력 크기·SHA-256·사용한 필터는 [manifest.json](manifest.json)에 기록했다. 원본의 비공개 키/실제 자료는 사용하지 않았다.

## 눈으로 고르는 글래스모피즘

| 예제 | 볼 부분 | 이 프로젝트에 참고할 곳 |
|---|---|---|
| [OriginKit Light Glass Button](https://www.originkit.dev/components/light-glass-button) | 버튼 위로 마우스를 움직이며 반사광·테두리 확인 | 헤더, 시간대 전환, 주요 버튼 |
| [Fluent 2 Material — Acrylic](https://fluent2.microsoft.design/material#acrylic) | Acrylic의 밝은/어두운 서리 유리 예시 | 퀴즈 단서, 입력 영역, 관리자 패널 |
| [Apple Meet Liquid Glass 영상](https://developer.apple.com/videos/play/wwdc2025/219/) | 투명 재질이 배경·움직임에 반응하는 실제 UI | 공통 유리 질감과 조작부의 시각적 위계 |
| [OriginKit Liquid Glass Carousel](https://www.originkit.dev/components/liquid-glass-carousel) | 유리 렌즈와 강한 굴절이 움직이는 데모 | 일부 강조 요소의 재질 참고 |

추천은 **OriginKit의 맑은 조작부 + Fluent Acrylic의 읽기 쉬운 패널** 조합이다. 마지막 렌즈형은 강한 굴절을 비교하기 위한 예제이며 모든 퀴즈/입력 영역에 그대로 쓰자는 의미가 아니다. 아직 어느 예제도 최종 채택하거나 우리 UI에 적용하지 않았다. 새로운 UI 시안은 선택한 방향을 듣고 이어서 만든다.

AI가 읽는 기존 정본은 [docs/spec/design.md](../../../spec/design.md)다. [이전 조사](../../../work/p9-06/video-glass-research.md)에서 찾은 DESIGN.md/공식 자료와 구분해, 이 목록은 직접 눈으로 볼 수 있는 예제를 우선했다.
