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

사용자가 선택한3번 **Apple Liquid Glass**의 원리를 웹으로 구현했다. 공개·풀이·관리자의 둥근 표면, 빛나는 가장자리, 배경 흐림과 이동하는 선택 표시를 함께 볼 수 있다. 헤더/시간대/첫 버튼은 더 맑게, 퀴즈와 편집 영역은 읽기 쉬운 밀도로 구분한다. 한글 글자와 입력칸 자체를 굴절시키지 않는다.

- [새 유리 UI](http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass&time=day) · [이전 모습 비교](http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass&time=day&glass=off)
- **선명하게** 버튼은 투명도를 줄인다. 선택은 `clarity=high`로 URL/검토 화면 이동에 남으며 다시 누르면 복원한다. OS 투명도/움직임 감소와 기존 멈춤도 따른다.
- Chromium에서는 제어의 가장자리 굴절을 더하고 다른 브라우저는 CSS 흐림으로 표시한다. Apple 시스템 재질과 동일한 SDK가 아니다. Safari/WebKit 실검증은 현재 실행 라이브러리 부재로 남아 있다.
- 영상은 사용자가 준비 중이다. 이번 변경은 기존 구름/잔디/산 위에 적용한 UI이며 영상 연결은 아직 하지 않았다.

[AI가 참조할 재질/토큰/상태 명세](../../../spec/design.md#apple-참고-유리-검토본의-재현-기준) · [검사와 남은 범위](../../../work/P9-06.md#apple-참고-유리-ui--2026-10-08).

## OriginKit 잔디 비교

사용자가 좋아한 기존 사진을 기본으로 보존하고, [움직이는 잔디 비교](http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass#ground-controls)를 추가했다. 맨 아래 **기존 사진 / 움직이는 잔디**로 즉시 전환한다. 시간대와 선택은 URL에 유지한다. 설치된 OriginKit MCP에서 받은 base 코드의 지형·잔디·바람·마우스 반응을 기존 하늘에 연결했다. [사용한 MCP/원본과 조정점/되돌리기](ORIGINKIT.md).

움직이는 잔디는 사용자 확인을 받았고, 후속 요청으로 **먼 산의 실제 촬영 사진**을 추가했다. 같은 잔디 주소에서 바로 보인다. [산 없는 이전 모습](http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass&mountains=off#ground-controls)과 비교할 수 있다. 사진 출처·사용 조건·원본 해시는 [산 사진 기록](ORIGINKIT.md#먼-산-사진--2026-10-08)에 있다.

## 첫 화면의 빽빽한 구름 복원

원래 낮/밤 배경을100% 밀도로 복원했다. 원본 구름군12개 영역을 원래 좌표에 둔 채 서로 다른 속도로 좌우로만 약22px 이내에서 움직인다. 새 이미지를 만들거나 몇 개의 구름을 반복 복사한 것이 아니라 기존 이미지를 GPU 마스크로 나눠 표시한다. 첫 화면의 구성·밝기·달을 유지하며 하강 중에는 앞서 만든 구름5종으로 이어진다. 공통 멈춤·움직임 감소도 적용한다. [동작/검사 근거](../../../work/P9-06.md#첫-화면의-원래-구름-밀도-복원--2026-10-08).

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
- [liquid-glass.js](liquid-glass.js): 배경 전용 가장자리 굴절·선택 표시·마우스 빛·투명도/이전 모습 전환
- [originkit-grass.js](originkit-grass.js): OriginKit shader/잔디 geometry와 검토본 연결
- [sky-banks.js](sky-banks.js): 원래 낮/밤 배경의 구름군12영역·수평 이동·원본 fallback
- [world.js](world.js): 독자적인 깊이별 구름 투영과 지면 이동, 멈춤/감소/fallback
- [review.js](review.js): 예시 화면 조작과 검토 경계
- [fonts.css](fonts.css): 기존 Noto Sans KR400 `unicode-range`의 경로만 검토 서버에 맞춤

실제 검사·성능·남은 기기/시각 검수는 [P9-06](../../../work/P9-06.md)에 한 곳으로 기록한다. 초기 로딩·예시 UI의 자동 검사는 운영 앱 연결/한글 IME/출시 검수 완료를 뜻하지 않는다. 시각 보정·사용자 확인 뒤 실제 앱에 적용하고 관련 기능 검사를 수행한다. Preview는 main push 자동 배포, Production은 별도 요청이다.
