# 재사용 유리 UI

P9-06의 승인된 재질과 움직임을 분리한 native HTML/CSS/JavaScript 컴포넌트다. 실제 React 앱도 같은 모듈을 [타입이 있는 컴포넌트](../../../../../src/components/README.md)로 감싸 사용한다. 새 패키지나 서비스 없이 다른 검토 화면에서도 사용할 수 있다. 운영 배포 여부는 STATUS를 따른다.

[독립 예제](http://localhost:4189/docs/design/phase-9/sky-v2/components/example.html) · [예제 HTML](example.html) · [예제 연결 코드](example.js)

## 제공하는 컴포넌트

| 역할 | 선언 | 현재 사용처 |
|---|---|---|
| 본문 유리 박스 | `class="glass" data-glass-panel="reading"` | 메인 두 텍스트 박스, 풀이 바깥 박스 |
| 안정된 읽기 패널 | `class="glass" data-glass-panel="standard"` | 관리자 좌측·중앙 패널 |
| 선택 메뉴/토글 | `class="glass-segmented" data-glass-motion="elastic" data-glass-convex` | 헤더·시간대·난도·검수 탭·운영 메뉴·하단 검토 메뉴 |
| 입체 버튼/링크 | `class="glass-action"` | 관리자 진입 링크 |
| 기본 유리/맑은 제어 | `glass` / `glass glass-clear` | 헤더·버튼·화살표 등 기존 공통 표면 |

본문 박스는 맑은 굴절 테두리와 안쪽 읽기 층을 만든다. 안정된 패널은 원래 읽기 채움과 부드러운 테두리 반사를 사용한다. 표면 장식은 읽기 순서와 클릭을 방해하지 않는다. 태그·내용·폭·여백·배치는 사용하는 화면이 정한다.

## 사용하는 순서

1. [glass-base.css](glass-base.css), [glass-prism.css](glass-prism.css)를 순서대로 불러온다. 이전 부드러운 재질만 쓸 때는 base만 불러온다.
2. `body`에 `data-time="dawn|day|dusk|night"`를 지정한다. 글꼴·기본 box-sizing·폼 리셋은 호스트 화면이 정한다. 예제는 기존 Noto Sans KR 파일을 쓴다.
3. 위 역할을 HTML에 표시하고 [glass.js](glass.js)의 함수를 한 번 호출한다.

```js
import { mountGlassComponents } from './components/glass.js';

const root = document.querySelector('#my-content');
const glass = mountGlassComponents(root);

// 외부 레이아웃 변경 후 필요할 때. 크기 변경은 자동 감지한다.
glass.refresh();

// 화면을 제거하거나 교체할 때.
glass.destroy();
```

`root`는 Document 또는 Element이며 root 자체가 박스여도 된다. 생략하면 document 전체에 적용한다. `{ prismatic: false }`는 base 재질용 선택 표시/반사만 초기화한다. 기본값은 true다. `{ descendants: false }`는 root와 그 root가 만든 장식에만 연결한다. React처럼 중첩 박스/메뉴가 각각 연결 수명을 소유할 때 사용하며, 기본값 true는 기존 하위 요소 전체 탐색을 유지한다. CSS를 켜고 끄는 일과 URL 비교 옵션은 호스트가 맡는다.

같은 root를 다시 연결하면 이전 장식·이벤트·관찰자·예약 프레임을 정리한다. 별도 root 여러 개는 서로 겹치지 않게 사용한다. 각 굴절 필터 ID는 인스턴스마다 다르다. 메뉴 항목이나 박스 구조를 추가/교체했을 때는 같은 root를 다시 연결한다. `refresh()`는 기존 요소의 크기/위치를 다시 측정하며 새 요소를 수집하지 않는다. 장식 관련 속성만 정리하고, 호스트가 변경한 내용·선택·입력·다른 inline style은 유지한다.

## 선택과 동작 계약

- 메뉴의 **직접 자식** `button`/`a`를 사용한다. 버튼에는 `type="button"`, 그룹에는 이름과 적절한 `role="group"` 또는 `nav`를 제공한다.
- 버튼의 현재 선택은 `aria-pressed="true"`, 페이지 링크는 `aria-current="page"`, 탭은 `aria-selected="true"`로 표시한다. 클릭/키보드 동작과 이 속성 변경은 호스트가 맡고, 컴포넌트는 이를 관찰해 선택 유리만 움직인다. hover로 데이터나 실제 선택을 바꾸지 않는다. 여러 그룹의 상태는 독립적이다.
- `data-glass-motion`을 생략하면 기존 단순 선택 표시다. `data-glass-convex`를 생략하면 탄성 이동과 평평한 재질을 조합할 수 있다.
- 현재 선택이 없는 헤더형 메뉴는 `data-glass-hover-only`를 추가한다. 읽기 패널 안의 메뉴에는 `data-glass-nested`를 추가해 밝은 시간대의 기존 CSS 굴절 대안을 사용한다.
- 일반 유리 표면의 포인터 반사는 `data-glint`로 연결한다. `data-glint-shape="spot"`은 작은 원형, `edge`는 위아래 테두리다. `data-glass-lens`는 맑은 표면의 광학 효과를 연결한다. 박스와 입체 버튼은 필요한 속성/장식을 자동으로 갖춘다.
- `body[data-motion="off"]`는 공통 정지, `body[data-transparency="reduced"]`는 선명한 표면이다. OS 움직임/투명도 감소·터치·숨은 문서도 기존 대안을 유지한다. Firefox는 CSS 재질을 사용한다. 전체 WebKit/실기기 검증을 뜻하지 않는다.

호스트의 색·여백 조정은 CSS 변수와 별도 클래스에 둔다. 공통 모듈에는 `weekly-sheet`, `puzzle-workspace`, 관리자 화면 ID 같은 페이지 선택자가 없다. [liquid-glass.js](../liquid-glass.js)는 검토 화면의 URL 옵션·선명하게 버튼·메뉴 선택만 연결하며, 기존 두 CSS 파일은 페이지 배치와 각 메뉴의 읽기 받침을 유지한다.

React의 `useGlass`는 `useLayoutEffect`에서 root만 연결하고 해제 시 `destroy()`를 호출한다. 선택 상태 변경은 속성 관찰로 반영하고 항목 구조가 달라지면 `structure` 값으로 다시 연결한다. 예제의 클릭 동작은 실제 퀴즈 저장/제출/발행을 실행하지 않는다.

## 검사

저장소 루트에서 설치된 Playwright Chromium/Firefox로 실행한다. 임시 로컬 정적 서버를 자동으로 열고 검사 후 종료한다. Worker·DB를 실행하지 않는다.

```sh
node scripts/check-sky-components.mjs
pnpm run lint
pnpm run typecheck
```

[검사 코드](../../../../../scripts/check-sky-components.mjs)는 독립 재사용·중복 연결/해제·선택/입력 보존·포인터/키보드/터치·감소 모드와 기존 풀이/관리자 동작을 확인한다. 이번 전후 화면 비교 근거와 한계는 [P9-06 기록](../../../../work/p9-06/components.md)을 따른다.

생명주기에는 기존 브라우저의 [AbortSignal 이벤트 정리](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#signal)와 [MutationObserver.disconnect](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/disconnect)를 사용한다. 브라우저 검사는 Context7 `/microsoft/playwright` 조회와 설치된 1.62.1의 [공식 screenshot API](https://github.com/microsoft/playwright/blob/main/docs/src/api/class-locator.md)를 대조했다.
