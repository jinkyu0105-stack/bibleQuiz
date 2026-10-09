# P9-06 새 하늘 디자인 검토본

2026-10-08. 이전 숲·종이·색상 기준을 종료하고 Air의 빛/구름 원근/하강을 참고해 새로 만든 독립 시안이다. 앱에 아직 연결하지 않았다. 실제 자료·AI 결과·저장/발행 API를 사용하지 않는다.

정적 서버가 실행 중이면 [검토본 열기](http://localhost:4189/docs/design/phase-9/sky-v2/)에서 확인한다. 없으면 저장소 루트에서 다음 명령을 실행한다.

```sh
python3 -m http.server 4189 --bind 127.0.0.1 --directory /home/onegem/work/bibleQuiz
```

| 화면 | 확인할 내용 |
|---|---|
| [공개](http://localhost:4189/docs/design/phase-9/sky-v2/?view=home) | 큰 한글 제목, 이번 주 선택, 지난 퀴즈, 구름을 지나 지면까지 이어지는 공간 |
| [밤](http://localhost:4189/docs/design/phase-9/sky-v2/?view=home&time=night) | 같은 구도에서 달빛·구름·읽기 표면·버튼이 바뀌는 모습 |
| [풀이](http://localhost:4189/docs/design/phase-9/sky-v2/?view=quiz) | 모바일 전체 격자, 단서 선택, 예시 한글 입력, 이전/다음, 초기화 |
| [관리자](http://localhost:4189/docs/design/phase-9/sky-v2/?view=admin) | 기존 메뉴/6단계의 배치, 요약·두 난도 탭, 편집 미리보기와 확인 표시 |

오른쪽 시간대 버튼(모바일 공개 화면은 아래쪽)으로 새벽·낮·노을·밤을 바꾼다. 풀이/관리자 모바일에서는 제어를 내용 위로 옮겨 입력 영역을 가리지 않는다. 멈춤 버튼은 구름과 선택한 잔디의 자동 움직임을 함께 멈춘다. OS 움직임 감소 설정에서는 자동 이동/전환을 끄고 시간대·스크롤 조작은 유지한다.

## Apple 참고 유리 UI

사용자가 선택한 3번 **Apple Liquid Glass**의 원리를 웹으로 구현했다. 공개·풀이·관리자의 둥근 표면, 빛나는 가장자리, 배경 흐림과 이동하는 선택 표시를 함께 볼 수 있다. 헤더/시간대/첫 버튼은 더 맑게, 퀴즈와 편집 영역은 읽기 쉬운 밀도로 구분한다. 한글 글자와 입력칸 자체를 굴절시키지 않는다.

- [맑은 프리즘 유리 + 선택 새벽 영상](http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass&time=dawn&video=billowing) · [직전의 부드러운 유리](http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass&time=dawn&video=billowing&glass=soft) · [유리 이전](http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass&time=dawn&video=billowing&glass=off)
- 현재 기본은 밝은 시간대 제어 채움22~24%/밤38%, 풀이/편집 읽기62~75%와14px 흐림이다. 공개의 두 본문 박스는 낮48%/새벽50%/노을52%/밤64%로 조금 더 투명하게 보정했다. 확장한 시간대 바는 낮53.2%/새벽·노을54.4%/밤74.8%, 밤 재생 제어는64% 받침으로 대비를 유지한다. 구름이 맑게 비치는 가운데와 얇은 색 분산 경계를 구분한다. 수치는 CSS alpha이며 실제 투과율은 아니다. 입력칸/글자/콘텐츠 폭은 유지한다.
- **선명하게** 버튼은 투명도를 줄인다. 선택은 `clarity=high`로 URL/검토 화면 이동에 남으며 다시 누르면 복원한다. OS 투명도/움직임 감소와 기존 멈춤도 따른다.
- Chromium에서는 배경 전용 RGB 가장자리 굴절을 더하고, 다른 브라우저는6px CSS 흐림과 유색 반사 경계로 표시한다. 실제 픽셀 비교로 중앙이 유지되고 경계에서 색이 분리됨을 확인했다. Apple 시스템 재질과 동일한 SDK가 아니다. Safari/WebKit 실검증은 현재 실행 라이브러리 부재로 남아 있다.
- 두 공개 본문 박스에는 무지갯빛 테두리와 포인터 주변의 부드러운 반사를, 어린이/장년의 원형 화살표에는 작은 렌즈 반사를 더했다. 밤 첫 버튼은 hover에도 투명한 밤 유리색을 유지한다.
- 사용자가 제공한 네 시간대4K 영상을 각각 연결했다. 아래 링크 또는 오른쪽 시간대 버튼으로 비교한다.

[AI가 참조할 재질/토큰/상태 명세](../../../spec/design.md#apple-참고-유리-검토본의-재현-기준) · [검사와 남은 범위](../../../work/P9-06.md#맑은-유리와-프리즘-보완--2026-10-09).

## 아래 검토 메뉴의 탄성 모션

[탄성 모션 보기](http://localhost:4189/docs/design/phase-9/sky-v2/?time=night&ground=grass&video=billowing&glint=both&dock-motion=elastic) · [직전 고정 선택 표시](http://localhost:4189/docs/design/phase-9/sky-v2/?time=night&ground=grass&video=billowing&glint=both&dock-motion=off)

사용자가 제공한 iPhone 영상의 하단 메뉴를 참고한 실험이다. 공개·풀이·관리자 위로 마우스를 옮기면 유리 표시가 잠깐 가로로 늘어났다가 통통하게 모인다. 메뉴 안에서는 포인터 방향으로 살짝 당겨지고, 빠르게 방향을 바꾸어도 현재 속도에서 이어 움직인다. 얇은 프리즘 경계도 함께 움직이며 글자와 클릭 영역은 고정한다.

유리 표시가 떠난 메뉴도 읽히도록 이 바의 받침에 기존 불투명 색을40% 섞었다. 최종 채움 alpha는 낮53.2%/새벽·노을54.4%/밤62.8%이며 가장자리 굴절과 반사는 유지한다. 현재 메뉴도 렌즈가 떠나면 일반 본문색을 쓰며, 밝은 시간대의 이 바 글자는 짙은 남색으로 보정했다.

마우스를 빼면 현재 화면으로 돌아온다. 다른 메뉴를 미리 보는 동안 작은 점이 현재 화면을 가리키고, 실제 화면은 클릭/Enter로만 바뀐다. 키보드 초점도 따라가며 터치에는 hover를 만들지 않는다. 공통 멈춤·OS 움직임 감소·투명도 감소·강제 색상에서는 이동을 끄고 현재 선택을 유지한다. 정착하면 반복 프레임을 멈춘다.

기본/`dock-motion=elastic`은 이번 실험, `dock-motion=off`는 직전 선택 표시다. 선택은 시간대·검토 화면 이동에 유지한다. `glass=soft/off`에서는 새 실험을 적용하지 않는다. 이 비교는 하단 검토 바를 대상으로 하며 헤더/시간대 확장은 아래의 별도 비교를 따른다. Apple 시스템 렌더러나 실제 iPhone 검증을 뜻하지 않는다. [구현/검사/한계](../../../work/P9-06.md#아래-검토-메뉴의-탄성-모션--2026-10-09).

## 아래 검토 메뉴의 볼록한 유리

[새 유리·새 밤 영상](http://localhost:4189/docs/design/phase-9/sky-v2/?time=night&ground=grass&video=billowing&glint=both&dock-motion=elastic&dock-material=convex) · [직전 평평한 재질](http://localhost:4189/docs/design/phase-9/sky-v2/?time=night&ground=grass&video=billowing&glint=both&dock-motion=elastic&dock-material=flat)

사용자가 마음에 들어 한 탄성 움직임을 유지하고, 움직이는 선택 유리에 맑은 중심·넓은 굴절 가장자리·위아래 반사를 더했다. 이동하는 동안 빛이 살짝 기울고 정착하면 중앙으로 돌아온다. 밤은 이전의 불투명한 파란 채움을 줄여 배경이 비치고, 차가운 흰 반사로 두께를 표현했다. 글자와 클릭 영역은 고정하며 이 바의 가독성 받침은 유지한다.

기본/`dock-material=convex`가 이번 보정, `flat`은 같은 탄성 모션에 직전 재질이다. Chromium은 실제 배경 굴절, Firefox 등은 흐림과 넓은 반사로 표시한다. 투명도 감소에는 불투명한 선택 표시를 쓴다. 모션을 끈 `dock-motion=off`와 `glass=soft/off`는 이전 모습을 유지한다. [재현 기준](../../../spec/design.md#apple-참고-유리-검토본의-재현-기준) · [변경/검사/한계](../../../work/P9-06.md#볼록한-유리와-새-밤-영상--2026-10-09).

## 헤더·시간대 메뉴와 관리자 버튼

[메뉴 확장 보기](http://localhost:4189/docs/design/phase-9/sky-v2/?time=dawn&ground=grass&video=billowing&glint=both&dock-motion=elastic&dock-material=convex&menu-glass=on) · [밤에서 보기](http://localhost:4189/docs/design/phase-9/sky-v2/?time=night&ground=grass&video=billowing&menu-glass=on) · [확장 전 메뉴](http://localhost:4189/docs/design/phase-9/sky-v2/?time=dawn&ground=grass&video=billowing&glint=both&dock-motion=elastic&dock-material=convex&menu-glass=off)

채택한 하단 유리와 같은 탄성·넓은 굴절·볼록한 반사를 헤더의 ‘이번 주 퀴즈/지난 퀴즈’와 시간대 메뉴에 적용했다. 헤더는 hover/키보드 초점이 있을 때 유리가 나타나 좌우로 따라간다. 시간대는 PC에서 위아래로,700px 이하 가로 배치에서는 좌우로 움직인다. hover만으로 시간대나 화면을 바꾸지 않으며, 다른 시간대 위에서는 모서리의 작은 점이 실제 선택을 표시하고 이탈하면 현재 선택으로 돌아온다. 움직이는 유리 밖에서도 작은 글자가 읽히도록 시간대 바의 받침을 보강했다.

헤더 ‘관리자’는 같은 재질의 볼록한 버튼이며 포인터에 맞춰 반사가 기울어진다. 글자와 클릭 영역을 늘리거나 헤더 전체를 움직이지 않는다. 기본/`menu-glass=on`은 확장, `off`는 직전 헤더/시간대/관리자 모습이며 하단의 채택한 유리는 유지한다. `dock-motion`/`dock-material`은 하단만의 비교로 남긴다. 모든 선택은 검토 화면 이동에 보존한다. 정지·감소·터치/키보드 대안도 공유한다. [현재 구현/검사](../../../work/P9-06.md#헤더시간대와-관리자-유리-확장--2026-10-09).

## 헤더·검토 바의 반사광 비교

현재 헤더는 **위·아래 테두리만 동시에 반응**한다. 마우스가 가운데에 있어도 같은 x좌표의 위아래 경계에 빛이 맺히고, 좌우로 움직이면 두 반사가 함께 따라간다. 헤더 바탕 중앙에는 추가 광원이 없으며, 메뉴/관리자 캡슐의 반사는 각 제어 안에 따로 둔다. 이전 원형 빛을 가장자리에 댔을 때의38px 반경/밝기를 각각의 경계에 재사용한다. 아래 디자인 검토 바는 포인터 주변의 작은 원형 빛 그대로다.

| 비교 | 헤더 | 아래 검토 바 |
|---|---|---|
| [현재 테두리 광원](http://localhost:4189/docs/design/phase-9/sky-v2/?time=night&ground=grass&video=billowing&glint=both) | 위·아래 테두리만 동시 반응 | 포인터 주변 원형 광원 |
| [직전 원형 광원](http://localhost:4189/docs/design/phase-9/sky-v2/?time=night&ground=grass&video=billowing&glint=both&header-glint=spot) | 포인터 주변 원형 광원 | 포인터 주변 원형 광원 |
| [이전 일자형](http://localhost:4189/docs/design/phase-9/sky-v2/?time=night&ground=grass&video=billowing&glint=both&header-glint=straight) | 중앙 표면도 빛나는 세로 광원 | 포인터 주변 원형 광원 |
| [보관한 모래시계형](http://localhost:4189/docs/design/phase-9/sky-v2/?time=night&ground=grass&video=billowing&glint=both&header-glint=flare) | 밝은 모래시계형 반사 | 포인터 주변 원형 광원 |
| [헤더만 새 효과](http://localhost:4189/docs/design/phase-9/sky-v2/?time=night&ground=grass&video=billowing&glint=header) | 위·아래 테두리만 동시 반응 | 모양 실험 전 반사 |
| [아래 바만 원형](http://localhost:4189/docs/design/phase-9/sky-v2/?time=night&ground=grass&video=billowing&glint=dock) | 모양 실험 전 반사 | 포인터 주변 원형 광원 |
| [두 반사광 모두 이전으로](http://localhost:4189/docs/design/phase-9/sky-v2/?time=night&ground=grass&video=billowing&glint=original) | 모양 실험 전 반사 | 모양 실험 전 반사 |

`header-glint` 생략/`edge`가 현재 테두리, `spot`은4afa662의 원형, `straight`는5c44efc의 일자형, `flare`는75e63a0의 모래시계형이다. `glint=original`은 a1900a4의 반사다. 선택은 시간대·공개/풀이/관리자 이동에 유지하며 유리 재질 전체를 바꾸는 `glass=soft`/`glass=off`와 구분한다.

포인터 이탈 시 추가 광원이 사라지며 공통 멈춤/OS 움직임 감소/투명도 감소에서는 반응하지 않는다. 기존 버튼 hover/키보드 초점 표시는 유지한다. [현재 구현/검사](../../../work/P9-06.md#헤더의-위아래-테두리만-반응--2026-10-09).

<a id="새벽-4k-영상"></a>
## 네 시간대 4K 영상

[새벽](http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass&time=dawn&video=billowing) · [낮](http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass&time=day&video=billowing) · [노을](http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass&time=dusk&video=billowing) · [밤](http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass&time=night&video=billowing) · [원래 사진/구름군](http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass&time=day&video=off)

현재 밤은 새로 제공한 `Generated video 2.mp4`를 연결한v2다. 무음4K는29,403,913bytes(약28.04MiB), 모바일1080p는6,698,738bytes(약6.39MiB)다. 원본29,575,502bytes와 [이전 밤v1](http://localhost:4189/docs/design/phase-9/sky-v2/?time=night&ground=grass&video=billowing&night-video=v1)을 보존했다. 기본/`night-video=v2`는 새 영상, `v1`은 이전 영상이며 화면 이동에도 선택을 유지한다.

2026-10-09 제공받은 네 시간대의 현재 영상은 모두 **3840×2160·24fps·10초**다.4K는 원본 영상 스트림을 그대로 복사하고 소리만 제거했다. 모바일700px 이하에서는 각각의1080p 파일을 사용한다. 시간대를 바꾸면 현재 영상 하나만 요청하고 이전 재생을 정리한다. 시간대 색과 햇빛/달빛은 영상에 담긴 그대로 표시한다. 끝0.9초의 첫 장면 합성은 반복 경계를 완화하며 MP4 자체를 완벽한 루프로 만든 것은 아니다.

새벽 기본은 사용자가 선택한12:30 버전(`video=billowing`)이다. [11:50 강한 움직임](http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass&time=dawn&video=dynamic) · [최초 잔잔한 영상](http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass&time=dawn&video=calm)도 보존했다. 이 선택은 새벽에만 적용한다. 새벽 현재4K19.24MB/1080p4.28MB이며 각 파일의 용량/해시는 [자산 기록](assets/video/README.md)을 따른다.

오른쪽 멈춤으로 영상·구름·잔디를 함께 멈춘다. 화면 아래쪽과 숨은 탭에서는 재생을 정지한다. 멈춘 상태에서 시간대를 바꾸거나 OS 움직임 감소가 켜져 있으면 해당 첫 장면만 보여 준다. 자동 재생이 제한되면 **하늘 영상 재생** 버튼으로 시작한다. 풀이/관리자와 `video=off`는 영상 파일을 요청하지 않는다.

[원본 보존 위치·파일·해시](assets/video/README.md) · [이번 검사/한계](../../../work/P9-06.md#네-시간대-영상과-공개-카드-유리-보정--2026-10-09). 독립 검토본의 연결이며 실제 앱/배포는 아직이다.

## OriginKit 잔디 비교

사용자가 좋아한 기존 사진을 기본으로 보존하고, [움직이는 잔디 비교](http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass#ground-controls)를 추가했다. 맨 아래 **기존 사진 / 움직이는 잔디**로 즉시 전환한다. 시간대와 선택은 URL에 유지한다. 설치된 OriginKit MCP에서 받은 base 코드의 지형·잔디·바람·마우스 반응을 기존 하늘에 연결했다. [사용한 MCP/원본과 조정점/되돌리기](ORIGINKIT.md).

움직이는 잔디는 사용자 확인을 받았고, 후속 요청으로 **먼 산의 실제 촬영 사진**을 추가했다. 같은 잔디 주소에서 바로 보인다. [산 없는 이전 모습](http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass&mountains=off#ground-controls)과 비교할 수 있다. 사진 출처·사용 조건·원본 해시는 [산 사진 기록](ORIGINKIT.md#먼-산-사진--2026-10-08)에 있다.

## 첫 화면의 빽빽한 구름 복원

`video=off` 비교와 영상/포스터 실패 대안에서는 원래 낮/밤 배경을100% 밀도로 복원한 방식을 유지한다. 원본 구름군12개 영역을 원래 좌표에 둔 채 서로 다른 속도로 좌우로만 약22px 이내에서 움직인다. 새 이미지를 만들거나 몇 개의 구름을 반복 복사한 것이 아니라 기존 이미지를 GPU 마스크로 나눠 표시한다. 첫 화면의 구성·밝기·달을 유지하며 하강 중에는 앞서 만든 구름5종으로 이어진다. 공통 멈춤·움직임 감소도 적용한다. [동작/검사 근거](../../../work/P9-06.md#첫-화면의-원래-구름-밀도-복원--2026-10-08).

## 넓은 화면 보정

콘텐츠 최대 폭1440px를 유지하고 배경만2560px 이상의 화면에 맞췄다. 잔디 양끝의 지형 노출을 없애고, 구름5종의 형태·위치·속도를 나누어 오른쪽 반복과 잘린 가장자리를 보완했다. 산은 같은 사진의3840×2160 파일을 넓은 화면에서 선택한다. 모바일은 작은 자산을 사용한다. 새 구름 원본은1672×941이며4K 업스케일 결과가 아니다. 기존 자산은 보존했다. [실제 해상도/공식4K 지원/검사 근거](../../../work/P9-06.md#넓은-화면과-구름-보정--2026-10-08).

## 새로 만든 부분

- 낮/밤 원경과 들판, 형태가 다른 풍성한 투명 구름5종. 구름은 깊이별 투영과 자동 흐름을 가진 독립 WebGL 층이다. 스크롤을 가로채지 않고 하나의 카메라가 내려간다. 지면도 같은 진행도에 따라 아래에서 접근한다.
- 공개 화면은 큰 한글 제목과 여백, 퀴즈 선택의 단순한 두 행, 지난 퀴즈 목록으로 구성한다. 풀이/관리자는 배경 빛이 은은하게 통과하는 안정된 유리 읽기 표면을 쓴다.
- Noto Sans KR400을 실제 자체 호스팅 파일로 연결한다. 파일 없는 굵기를 합성하지 않는다. Noto Serif/출력 폰트/fontkit은 그대로 보존했다.
- 풀이는 별도 예시 8×8 격자이며 실제 제품 퍼즐 엔진이나 채점 기능이 아니다. 관리자 입력은 현재 화면 메모리에만 반영하며 새로고침하면 초기 예시로 돌아간다. 일부 대표 화면 밖 메뉴는 범위를 알리는 설명창을 연다.

## 참고와 제작 방법

[Air](https://air.inc/)의 실제 시간대 선택과 스크롤 장면을 재관측했다. Refero의 [Air 설명](https://styles.refero.design/style/d3289fe7-a85e-42d8-96b7-eb7faa62a104)은 이전 P9-05의 DESIGN.md/CSS Variables 수동 참조를 이어받았다. Refero MCP/설치/결제/Tailwind export를 사용하지 않았다. 원본 코드·이미지·유리 로고·Control 폰트도 복사하지 않았다.

`imagegen-frontend-web`과 기본 `imagegen`으로 낮/밤/지면/풀이/관리자 5개 장면과 구름 자산을 따로 만들었다. 생성 이미지에는 글자를 넣지 않았다. 공개 시안의 구현에는 `design-taste-frontend`를 적용했고 풀이/관리자는 기존 기능과 접근성 기준을 따랐다. 구현은 native HTML/CSS/JavaScript/WebGL이며 production 의존성을 추가하지 않았다.

색상·서체·간격을 Refero와 똑같이 맞췄다고 주장하지 않는다. 한글 서체, 낮/밤 대비, 퍼즐 입력, 관리자 읽기 밀도에 맞춰 명시적으로 조정했다. 기준은 [현재 디자인 명세](../../../spec/design.md), 생성 원문/파일/해시는 [assets.json](assets.json)이다. `references/`의 이미지 2종은 실제 UI의 배경이나 입력칸으로 사용하지 않는다.

## 파일과 검증

- [index.html](index.html): 실제 한글/레이아웃/입력 요소
- [style.css](style.css): 네 시간대와 공개/풀이/관리자 반응형
- [liquid-glass.css](liquid-glass.css): 역할별 유리 재질·네 시간대·접근성 대체 표시
- [prismatic-glass.css](prismatic-glass.css): 현재 맑은 채움·시간대별 프리즘/반사·선명하게 대안, `glass=soft`로 비활성화
- [liquid-glass.js](liquid-glass.js): 배경 전용 가장자리 굴절·선택 표시·마우스 빛·투명도/이전 모습 전환
- [dock-motion.js](dock-motion.js): 하단/헤더/시간대 메뉴가 공유하는 탄성 이동·가로/세로 변형·복귀·정지 수명
- [originkit-grass.js](originkit-grass.js): OriginKit shader/잔디 geometry와 검토본 연결
- [sky-video.js](sky-video.js) / [sky-video.css](sky-video.css): 네 시간대 영상 지연 요청·전환·정지/대체 이미지·반복 경계 합성
- [sky-banks.js](sky-banks.js): 원래 낮/밤 배경의 구름군12영역·수평 이동·원본 fallback
- [world.js](world.js): 독자적인 깊이별 구름 투영과 지면 이동, 멈춤/감소/fallback
- [review.js](review.js): 예시 화면 조작과 검토 경계
- [fonts.css](fonts.css): 기존 Noto Sans KR400 `unicode-range`의 경로만 검토 서버에 맞춤

실제 검사·성능·남은 기기/시각 검수는 [P9-06](../../../work/P9-06.md)에 한 곳으로 기록한다. 초기 로딩·예시 UI의 자동 검사는 운영 앱 연결/한글 IME/출시 검수 완료를 뜻하지 않는다. 시각 보정·사용자 확인 뒤 실제 앱에 적용하고 관련 기능 검사를 수행한다. Preview는 main push 자동 배포, Production은 별도 요청이다.
