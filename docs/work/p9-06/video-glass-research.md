# P9-06 영상 하늘·글래스모피즘 조사

2026-10-08 확인. **조사 완료, 구현·영상 생성은 미착수**. 사용자는 빽빽한 첫 구름 배경의 복원은 확인했지만 움직임은 만족스럽지 않다고 평가했다. 다음은 이미지 기반 영상 제작 경로를 선택하고 전체 UI의 유리 재질 기준을 정하는 일이다. P9-06을 유지하며 새 번호를 만들지 않는다.

이 문서의 **추천·비용 예시·다음 순서는 제안**이다. API 공급자/모델 채택, 크레딧 소비, 계정 연결, 상세 토큰, 실제 UI 변경과 배포 승인을 뜻하지 않는다. [현재 디자인 정본](../../spec/design.md) · [작업](../P9-06.md).

## 현재 네 시간대는 어떻게 만드는가

기준 코드: [index.html](../../design/phase-9/sky-v2/index.html), [style.css](../../design/phase-9/sky-v2/style.css), [sky-banks.js](../../design/phase-9/sky-v2/sky-banks.js), [자산 출처](../../design/phase-9/sky-v2/assets.json).

| 시간대 | 첫 화면 원본 | 색/빛 처리 |
|---|---|---|
| 낮 | day.webp | 기본 밝은 하늘·광원 |
| 새벽 | 같은 day.webp | 채도/색조 필터와 청보라·따뜻한 빛 |
| 노을 | 같은 day.webp | 세피아/색조 필터와 분홍·살구빛 |
| 밤 | 별도 night.webp | 원본에 달·별·밤 구름 조명, 별도 밤 광원 |

첫 화면 원본은 **2장**이다. 각 모바일 작은 파일은 크기 변형이며 새 시간대 이미지가 아니다. 밤 원본은 낮 원본을 참조해 같은 구도로 생성한 별도 이미지다. 현재 canvas도 이 두 원본을 혼합한다. 하강 중의 구름5종은 공통 자산에 시간대별 색을 적용하고 산 사진도 같은 사진에 색/밝기를 적용한다.

- **영상1개:** 낮 영상에 필터/빛 덮개를 적용하면 네 시간대를 표현할 수 있다. 같은 구름 움직임을 유지하고 다운로드도 줄일 수 있다. 다만 단순 필터만으로 달·별이나 구름의 광원 방향이 생기지는 않는다. 이를 따로 합성하는 선택도 가능하다.
- **영상2개 — 추천:** 낮/밤 원본으로 각각 만들고 새벽/노을은 낮 영상을 보정한다. 현재 승인받은 구도와 밤의 달·별을 유지하기 쉽다. 별도 생성물의 구름 움직임이 정확히 같다는 보장은 없어 전환 연결은 검수가 필요하다.
- **영상4개:** 시간대마다 실제 구름 조명과 태양 위치까지 다르게 만들고 싶을 때 선택한다. 현재 색 보정 방식에는 필수가 아니며 생성·보관·검수 비용이 늘어난다.

## Flow와 Gemini API 비교

Flow는 제작 화면, AI Studio는 모델 시험/프로젝트·키 관리 화면이며 프로그램으로 맡길 때는 **Gemini API**를 사용한다. 같은 모델을 선택했다면 서비스 이름만으로 품질 우열을 단정할 수 없다. 이번에는 직접 자동 처리, 넓은 화면, 원본 구도 유지가 선택 기준이다.

| 항목 | Google Flow + Google AI Pro | AI Studio의 유료 프로젝트 + Gemini API |
|---|---|---|
| 비용 방식 | 구독에 포함된 Flow 크레딧 우선 활용 | API 사용량에 따른 별도 과금 |
| 현재 공개 기준 | 일50크레딧 + Pro 월1,000크레딧 | 모델·초·해상도별 요금 |
| Veo3.1 Fast / Quality | Pro 기준 생성물당20 / 100크레딧 | 아래 초당 요금 |
| 큰 화면 | Pro는1080p 업스케일0크레딧,4K 업스케일은Ultra만50크레딧 | Veo3.1/Fast의4K 출력 지정 가능 |
| 자동화 | 브라우저 로그인/화면 조작 필요. 이번 조사에서 Flow 크레딧을 쓰는 공식 공개 API 경로를 확인하지 못함 | 공식 API로 입력→생성→완료 확인→다운로드 자동화 가능 |
| 표시 워터마크 | 한국 거주자는 자동 표시 적용이라는 공식 안내 | Veo 문서는 SynthID를 명시. 실제 출력의 표시 여부/계정 조건은 생성 시 확인하며 무표시를 보증하지 않음 |
| 이번 판단 | 구독 활용/직접 시안 비교에 유리 | **제가 제작·가공을 맡는 경로로 추천** |

Flow 수치와 제한은 [공식 크레딧 안내](https://support.google.com/flow/answer/16526234?hl=en), 한국 표시 워터마크는 [공식 시작 안내](https://support.google.com/flow/answer/16353333?hl=en), 기능은 [모델별 지원표](https://support.google.com/flow/answer/16352836?hl=en)를 확인했다. 실제 계정 잔액을 조회한 결과가 아니다. 한 요청이 여러 생성물을 만들 수 있으므로 생성물 수와 크레딧을 함께 고정해야 한다.

### 영상 모델과 비용

첫 시험 후보는 **Veo3.1 Fast 이미지→영상**이다. 첫/마지막 프레임을 지정할 수 있고1080p/4K는8초 조건이다. 영상과 소리가 함께 생성되며 웹 배경용 소리는 후처리로 제거한다. 결과는 서버에서2일 뒤 삭제되므로 즉시 로컬에 보관한다. [Veo 공식 가이드](https://ai.google.dev/gemini-api/docs/veo).

2026-10-08 [공식 가격표](https://ai.google.dev/gemini-api/docs/pricing) 기준. USD, 세금·환율·재생성 비용 제외. 아래 두 편은 낮/밤 각 한 번 성공한 경우이며 수락 가능한 품질을 보장하는 견적이 아니다.

| 모델/해상도 | 초당 | 8초1편 | 8초2편 |
|---|---:|---:|---:|
| Veo3.1 Lite1080p | $0.08 | $0.64 | $1.28 |
| Veo3.1 Fast1080p | $0.12 | $0.96 | $1.92 |
| Veo3.1 Fast4K | $0.30 | $2.40 | $4.80 |
| Veo3.1 Standard4K | $0.60 | $4.80 | $9.60 |

저비용안은 Lite1080p, 구독 안에서 추가 결제를 피하는 안은 Flow 크레딧이다. 추천 시험은 Fast1080p 낮1편($0.96)부터이며, 원본 보존/흐름/반복 연결을 확인한 후 밤과4K 범위를 정한다.1080p→4K 재생성을 같은 영상의 무손실 확대라고 보장하지 않는다. Fast/Standard의 실제 우리 구름 품질 비교는 아직 하지 않았다.

최신 대안 **Gemini Omni Flash1.1**도 공식 문서에서 확인했다. 이미지→영상, 첫/끝 프레임, 대화형 영상 편집을 지원한다. 낮 영상의 움직임을 유지하면서 밤 조명을 요청하는 후보가 될 수 있지만 결과 보존은 실물 검수가 필요하다.1080p/4K는 문서상 업스케일 출력이다.4K 재료부터 시험하는 Veo와 구분하고,720p 예시 단가를 그대로4K 단가로 보고하지 않는다. [모델](https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash) · [편집/해상도 가이드](https://ai.google.dev/gemini-api/docs/omni).

**Flow 크레딧과 API 크레딧을 같은 잔액으로 취급하지 않는다.** 사용자가 보유한 크레딧이 Gemini API 선불 잔액인지, 별도 프로모션인지 아직 확인하지 못했다. 일반 Google Cloud 신규가입$300 Welcome/free-trial 크레딧은 현재 Gemini API/AI Studio 결제 대상이 아니다. 크레딧이 있다는 이유만으로 이번 비용을 거기서 차감한다고 확정하지 않는다. [공식 결제 안내](https://ai.google.dev/gemini-api/docs/billing).

## 제가 단독으로 맡을 수 있는 범위와 현재 연결 상태

**계정 연결과 생성 예산이 마련되면**, 원본 준비·프롬프트 작성·API 요청·다운로드·반복 연결 편집·웹용 압축·시간대 적용·검수는 제가 이어서 수행할 수 있다. 사용자가 영상 편집 프로그램을 다룰 필요는 없다. 지금 연결까지 끝나서 즉시 무인 생성할 수 있다는 의미는 아니다.

| 확인 대상 | 실제 결과 |
|---|---|
| 설치된 도구/플러그인 검색 | Flow/Veo 전용 연결을 찾지 못함. 다른 영상 서비스는 이번 Google 계정 활용 경로로 설치하지 않음 |
| Windows computer-use | node_repl이 실행 전 WSL경로 해석 오류로 시작 실패. 로그인/잔액/계정 권한을 확인하지 못함 |
| 대체 WSL Chromium | Flow 공개 소개 페이지HTTP200 접근 성공. 독립 브라우저이므로 사용자의 기존 로그인 세션과 다름 |
| 현재 프로세스와 프로젝트 루트의 표준 환경파일 | GEMINI_API_KEY/GOOGLE_API_KEY/GOOGLE_APPLICATION_CREDENTIALS 연결 미확인(검사 범위에서는 설정없음). 비밀값 출력0, 계정 전체에 키가 없다고 판단하지 않음 |
| 기존 로컬 가공 도구 | ffmpeg 실행 파일이 있음. 이번에 변환/생성 작업을 실행하지 않음 |
| 공식 SDK 확인 | Context7에서 Google Gen AI JS 식별→generateVideos/operation/설정 문서 조회. 프로젝트에는 SDK 미설치 |

Context7 SDK 설명은 일부 예시에Veo2·720/1080p만 나와 최신 Veo 전용 가이드의4K 지원과 구분했다. 프로젝트 React19.2.8/TypeScript6.0.3을 확인했으며 이번에 SDK 버전이나 새 의존성을 도입하지 않았다. 이후 제작 스크립트는 공식 REST 경로로도 만들 수 있어 앱의 production 의존성 추가가 필수는 아니다.

현재 필요한 초기 조건은 **사용 가능한 유료 API 프로젝트/기존 키의 안전한 연결과 한정된 생성 예산**이다. 이 조사는 키 생성·결제 변경·계정 로그인/권한 설정을 실행하는 요청이 아니다. 채팅/문서/Git에 키를 붙여 넣도록 요구하지 않는다. 기존 키가 다른 영속 위치에 있다면 다음 실행 때 해당 위치를 재사용한다.

Windows 도구의 정확한 오류는 `codex/sandbox-state-meta: sandboxCwd is not a local file URI: file:///home/onegem/work/bibleQuiz`였다. `codex-exec-recovery`에 따라 같은 실패 경로를 반복하지 않았고, 정상 WSL shell/기존 Chromium/공식 API 문서로 조사를 완료했다. 저장소 연결 장애나 사용자 계정 로그인 실패로 단정하지 않는다.

## 영상의 제작 방향 — 미실행 제안

기존 낮/밤 원본 master를 사용한다. 화면 캡처의 제목·버튼을 영상에 넣지 않는다. **원래 양옆의 빽빽한 구름, 가운데 읽기 공간, 밝기와 구도를 유지**하는 것이 기준이다. 첫/끝 프레임에 같은 원본을 주는 방식을 시험할 수 있지만 매끄러운 반복을 보장하는 기능이라고 주장하지 않는다.

프롬프트 초안:

> Preserve the supplied sky composition, the dense cloud banks on both sides, and the clear central reading area. Keep a locked camera. Animate very slow, small horizontal cloud drift with subtle internal billowing. Keep the cloud mass and lighting stable. Create a calm continuous shot suitable for a looping website background, with the ending composition matching the starting image. No text, logos, new objects, cuts, rapid time-lapse, or dramatic camera movement.

밤에는 원본의 달·별 위치를 유지하는 조건을 덧붙인다. 우선 고정 카메라로 구름 자체의 흐름을 확인한다. 사용자가 제안한 아주 미세한 줌은 후처리/표시 단계에서 조정할 수도 있으므로 첫 생성에 강한 카메라 이동을 함께 넣지 않는다.

원본 보존·중간 프레임 변형·끝→처음 연결을 확인하고 필요하면 국소 교차 전환으로 반복을 다듬는다. 단순 역재생 왕복은 구름이 되감기는 모습이 날 수 있어 기본안으로 채택하지 않는다.4K master와 모바일/일반 웹용 파일을 나누고 실제 표시 품질/용량을 비교한다.

영상은 첫 하늘 층의 교체 후보다. 하강 구름·산·OriginKit 잔디와 콘텐츠1440px를 유지하고 원래 정적 이미지를 포스터/복귀안으로 보존한다. 재생은 기존 멈춤/OS 움직임 감소/숨은 탭 중단과 연결한다. 적용 후에도 매 방문/매주 생성 API를 호출할 이유는 없다. [움직임 정지 기준](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html).

## 글래스모피즘을 위한 AI 참조 자료

공개 문서와 **기존 OriginKit MCP의 search/fetch**를 사용했다. Refero MCP·유료 export·새 디자인 패키지를 설치하거나 결제하지 않았다.

| 자료 | AI가 읽는 형태 | 우리 프로젝트에서 참고할 부분 |
|---|---|---|
| [Microsoft ai-cheatcode DESIGN.md](https://github.com/microsoft/ai-cheatcode/blob/main/DESIGN.md) · [원문 Markdown](https://raw.githubusercontent.com/microsoft/ai-cheatcode/main/DESIGN.md) | 실제 DESIGN.md; 색/타이포/여백/컴포넌트/CSS값 | 글래스 토큰을 구체적으로 기록한 사례. Microsoft 전체 디자인 표준이 아니라 개별 프로젝트이며 어두운 보라 팔레트/영문 폰트는 그대로 도입하지 않음 |
| [Google Labs DESIGN.md 형식](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md) | 공개 Markdown + 선택적 YAML 토큰 구조 | 색상·타이포·Spacing & Shape·컴포넌트 규칙을 AI가 반복해서 읽는 문서 형식. 글래스 전용 스타일 묶음은 아님 |
| [Apple Materials / Liquid Glass](https://developer.apple.com/design/human-interface-guidelines/materials) | 공식 가이드 페이지 | 맑은 유리/읽기용 재질의 역할, 배경 변화와 글자 가독성. 웹용 CSS 패키지가 아니며 Apple 자체 효과를 그대로 재현했다고 주장하지 않음 |
| [Fluent2 Material](https://fluent2.microsoft.design/material) | 공식 가이드 페이지 | 밝음/어두움에 대응하는 반투명 Acrylic과 모달 뒤 Smoke. Mica는 불투명 재질이므로 유리와 혼동하지 않음 |
| [OriginKit Light Glass Button](https://www.originkit.dev/components/light-glass-button) | MCP로 설명·속성·React 소스 수신 확인 | 뒤 배경 흐림, 유리 테두리, 마우스를 따르는 빛. 추가 의존성 없음 안내. 현재 한글 폰트/상태/키보드 처리는 우리 기준으로 맞출 대상 |

OriginKit의 [Frosted Veil](https://www.originkit.dev/components/frosted-veil)도 소스를 확인했다. 이는 유리 패널 뒤의 별도 WebGL 배경이라 하늘 영상 위의 공통 UI 재질과 역할이 다르다. 첫 UI 기준의 우선 후보는 Light Glass Button의 재질이며, 기존 하늘 전체를 Frosted Veil로 교체하는 제안은 하지 않는다. MCP 소스를 그대로 설치/적용하거나 완전한 컴포넌트 검사를 한 것은 아니다.

### 우리 디자인 문서에 옮길 구조 — 값은 다음 검토에서 확정

새 별도 DESIGN.md를 정본과 경쟁시키지 않고 **기존 docs/spec/design.md를 AI가 읽는 정본으로 계속 사용**한다. Google 형식과 참고 문서의 구성 방식을 활용해 다음 항목을 정리할 수 있다.

- 공통 유리 재질: 밝은/어두운 색, 투명도, 흐림, 채도, 테두리 하이라이트, 안쪽 빛, 그림자.
- 역할별 밀도: 헤더/시간대/버튼은 맑은 유리, 퀴즈 카드/목록은 서리 유리, 격자/단서/관리자 입력은 읽기 쉬운 짙은 반투명.
- 네 시간대의 텍스트·선택·hover·focus·disabled·성공/오류·모달 상태와 실제 한글 Noto Sans KR400/폴백.
- Spacing & Shape: 기존1440px 콘텐츠 폭과 기능 배치를 유지하면서 모서리·패딩·버튼 높이를 공통화.
- 읽기/성능: 배경 영상의 밝은 프레임/어두운 프레임 모두에서 대비 확인, 격자 각 칸에 무거운 흐림을 중첩하지 않고 바깥 표면을 공유하는 방식 검토.

이는 **전체 UI에 공통 글래스모피즘을 적용하려는 사용자 방향**을 구체화한 제안이다. 모든 표면을 같은 투명도로 고정한다는 뜻은 아니다. Apple의 Liquid Glass 적용 범위와 일반적인 서리 유리를 구분해 필요한 역할에 맞춘다.

웹 구현의 기본 수단은 반투명 색과 CSS `backdrop-filter`다. 별도 유료 서비스/production 라이브러리가 필수는 아니다. [MDN backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter)는 최신 브라우저 지원과 반투명 배경 조건을 설명한다. [투명도 감소 media query](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-transparency)는 아직 지원이 제한적이므로 이것만 믿지 않는다. 본문4.5:1·큰 글자3:1의 [기존 AA 대비 목표](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)를 실제 합성 배경에서 확인한다.

## 다음 진행 순서와 이번 종료

1. 이 조사 결과를 바탕으로 영상 경로/초기 연결/생성 범위를 정한다. 추천은 Gemini API·Fast 낮1080p1편 시험 후 낮/밤2편 방향이다.
2. 승인된 범위에서 원본 구도·느린 움직임·반복 연결을 만족하는 영상을 확보한다. 모델/편수/가격은 실제 실행 직전 해당 계정과 공식 문서로 확인한다.
3. 전체 UI의 유리 재질/색/폰트/Spacing & Shape/상태 규칙을 디자인 정본에 구체화하고 공개·풀이·관리자 검토본을 보정한다.
4. 사용자 확인을 거쳐 실제 앱에 연결하고 관련 필수 검사를 수행한다. Preview는main push 자동 배포, Production은 별도 요청이다.

이번에는 **문서만 변경**했다. 새 영상/이미지 생성·유료 호출·업로드·계정설정 변경·UI 구현·패키지 변경·push/배포0. 기존 출시 검사나 UI 기능 검사는 반복하지 않고 `git diff --check`와 로컬 링크/앵커185개, 코드/출처 사실을 확인했다. 과거 P7B의 끊긴 디자인 링크1개는 당시 명세 보관본으로 연결했다. 시작HEAD70669c8, main clean/ahead9(origin/main21b81de), Pro90%×사용자 지정10=900%. 부모 전체UI개편은 진행 중이고 세션을 유지한다.
