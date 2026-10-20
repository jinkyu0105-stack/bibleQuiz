# 실제 앱의 공통 UI

[직접 눌러보는 디자인 부품 모음](http://localhost:5173/dev/design)은 개발 서버 전용이다. 실제 React 컴포넌트를 렌더하며 이름·사용처·호버·키보드 동작을 확인할 수 있다. 새 공통 부품을 추가하거나 외형을 변경하면 이 목록과 `src/features/design-catalog/page.tsx`의 예시를 함께 갱신한다. 단순 복제 마크업을 예시로 만들지 않는다.

P9-06 검토본과 같은 유리 재질·움직임을 실제 React 페이지에서 사용한다. [native 모듈/계약](../../docs/design/phase-9/sky-v2/components/README.md)이 효과의 정본이고, 이 폴더는 타입·DOM·연결 수명을 담당한다. 새 패키지는 없다.

| 컴포넌트 | 역할/선택 값 | 사용처 |
|---|---|---|
| `GlassPanel` | `surface="reading"` 기본값, `standard`; `as`로 의미에 맞는 태그 | 첫 화면/요약/풀이/지난 퀴즈, 관리자 패널 |
| `GlassMenu` | `as="nav"` 또는 `div`; `clear`, `nested`, `structure` | 주요 메뉴/시간대/난도/운영 메뉴/검수 대상 |
| `Button` / `ButtonLink` | 기본 `secondary`는 정답보기형, `primary`는 입력 확인·빈 격자 받기형; native props/ref 전달 | 관리자 실행/저장/재조회/확인·풀이 버튼 |
| `GlassLink` | React Router `LinkProps`, 입체 링크 | 관리자 진입, 참여 가능한 다른 퀴즈 |
| `PageDock` | `GlassMenu`로 구성한 실제 페이지 바로가기 | 메인 및 모바일 모든 일반 페이지 하단 |
| `GlassArrowButton` | **유리 화살표 버튼**. 그림32px/단독 터치44px,9px 모서리·1px 전체 테두리·윗빛·작은 그림자·160ms 호버. `label` 필수, native button props 지원. `glyph="more"`는 같은 유리 외형의 점3개 더보기 변형. `decorative`는 전체 행 버튼 안의 장식이며 부모 `data-glass-arrow-group`과 함께 반응 | 지난 퀴즈 행, 모바일 관리 더보기, 부품 모음 |
| `QuizChoiceDialog` | **난이도 선택창**. 네이티브 모달 대화상자, 어린이·장년 사각 선택 버튼, Esc/바깥 클릭 닫기·초점 복원 | 헤더 이번 주 퀴즈·지난 퀴즈 목록·부품 모음 |
| `CompactSelect` | **연결형 선택기**. 네이티브 select·숨긴 접근성 이름·안쪽14px 화살표. `pointerFocus="surface"` 기본(추가 클릭 테두리 없음), 필요 시 `ring`, 키보드 초점은 두 방식 모두 표시 | 지난 퀴즈 연도·월, 부품 모음 |
| `AdminMenu` | **이동형 메뉴**. 선택 면과 아이콘 받침이 함께 이동 | 관리자 사이드바·도움말·초안 단계 |
| `AdminIndexedBoard` | **파일 인덱스 탭**. 선택 탭과 본문이 한 면으로 이어짐 | 관리자 게시판 |
| `AdminRefreshButton` | **원형 새로고침**.36px, 터치44px | 관리자 목록 |
| `Tooltip` | **작은 말풍선**. 위 우선, 공간 부족 시 아래 | 아이콘·짧은 설명 |
| `GlassArrow` | 링크 안의 장식 화살표 | 첫 화면 난도 링크 |
| `useGlass` | 기존 DOM 태그를 보존한 채 효과 연결 | 헤더/본문 앵커/접는 관리자 메뉴/설정 버튼 |
| `SkyEnvironment` | `view="home|quiz|archive|admin"` | 루트 레이아웃의 단일 배경/설정 |

```tsx
<GlassPanel as="section" aria-labelledby="content-title">
  <h2 id="content-title">내용</h2>
  <GlassMenu role="group" aria-label="검수할 내용" nested structure={items.map(item => item.id).join(":")}>
    {items.map(item => <button key={item.id} type="button"
      aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>
      {item.label}
    </button>)}
  </GlassMenu>
</GlassPanel>
```

메뉴의 직접 자식은 `button`/`Link`/`NavLink`다. 탭이면 호스트에서 tablist/tab 역할·`aria-selected`·키보드 동작을 구현한다. 너비·여백·배치는 화면 CSS가 정하며 공통 모듈에 페이지 선택자를 넣지 않는다. 항목 추가/제거 등 구조 변경 시 `structure`를 바꾼다. 선택·글자 변경만으로 매번 효과를 재연결하지 않는다.

`useGlass`는 root에만 효과를 붙이고 React가 만든 자식과 입력값을 변경하지 않는다. 중첩 컴포넌트가 각자의 장식을 소유하며 언마운트 때 필터/이벤트/관찰자/예약 프레임을 정리한다. `SkyScene`도 shared world를 한 번 연결하고 해제 때 WebGL/영상/이벤트를 정리한다. 실제 폼/API/내비게이션/답안 저장은 기존 feature가 소유한다.

`sky/media.ts`는 승인된 기존 이미지/영상의 명시적 Vite URL을 모은다. 개발과 해시가 붙는 빌드에서 같은 파일을 사용하고 비교용 master는 가져오지 않는다. 사진/미디어 선택은 [디자인 계약](../../docs/spec/design.md#실제-react-페이지-적용)을 따른다.

```sh
pnpm test:e2e tests/e2e/sky-app.spec.ts --project=chromium --project=mobile-chromium
node scripts/check-sky-components.mjs
```

전체 실제 흐름의 검사 결과와 브라우저 한계는 [앱 적용 기록](../../docs/work/p9-06/app-integration.md)에 남긴다.

P9-07의 `sky/solar-time.ts`는 서울 날짜/좌표로 네 시간대를 계산한다. 수동 시간은 `bibleQuiz:sky-session`(sessionStorage), 잔디 숨김은 `bibleQuiz:grass-hidden`(localStorage)이다. 기존 theme/sky 저장값은 초기 시간에 사용하지 않는다. `SkyScene`은 shared world의 `cloudSpeed: 2`, `setGround("grass" | "photo")`를 사용하며 기본 native 검토본의 속도/사진 대안은 유지한다. 서울 시간 정책은 [P9-07](../../docs/work/P9-07.md), 잔디 사진 복귀·메인 이동은 [P9-08](../../docs/work/P9-08.md), 현재 공통 버튼은 [P9-09](../../docs/work/P9-09.md)를 따른다.

`Button`은 정답보기의 기존 단순한 버튼을 기본값(`secondary`)으로 쓴다.8px 모서리·48px 최소 높이·750 굵기의 글자와 기존 상태별 색을 공유한다. `variant="primary"`는 입력 확인과 빈 격자 받기의 기존 `primary-button` 스타일(26px 모서리·700 굵기)을 재사용한다. 입력 확인이 비활성일 때 흐리게 보이는 것도 같은 primary의 기존 상태다. `ButtonLink`는 같은 두 스타일을 Router 링크에 제공한다.

`type`, `disabled`, form 속성, 이벤트, children과 ref는 native 요소에 그대로 전달한다. type을 생략한 폼 버튼의 기본 submit 동작도 유지한다. 정답보기의 `aria-disabled`와 loading 중 native `disabled`는 원래 feature에서 정한다. API/정답 권한/저장/파일 생성은 컴포넌트에 넣지 않는다. 관리자에서는 긴 이름의 줄바꿈만 허용하고 선택 메뉴/주간6단계·헤더 관리 링크의 기존 유리는 유지한다. P9-08의 `GlassButton`과 반복 버튼용 볼록 장식은 제거했다. 새 효과·관찰자·상시 프레임은 없다.

```tsx
import { Button, ButtonLink } from "./components/Button";

<Button type="button" disabled={busy} onClick={refresh}>다시 확인</Button>
<Button type="submit" variant="primary">저장</Button>
<ButtonLink to="/admin">관리 화면 열기</ButtonLink>
```


`useHomeSectionScroll`은 메인에서만 연결한다. 휠 섹션 이동은 약1.2초, 같은 페이지 Router 앵커는 이동 거리별0.9~1.6초로 감속한다. 긴 섹션 내부/중첩 스크롤·확대 휠은 기본 동작을 유지하며 추가 입력/경로 이탈에서 예약 프레임을 해제한다. 링크 클릭 전 위치를 기록하고 Router 복원 뒤 paint 전에 출발점을 되돌려 Firefox의 해시 복원과 충돌하지 않는다. 초기 deep link/뒤로 가기는 기존 Router 복원이며 모바일 터치는 native snap, 감소 모드는 즉시 이동한다.


`AdminIntro`는 관리자 페이지의 목적 설명, `AdminSteps`는 짧은 사용 순서, `AdminTool`은 제목/조건/설명으로 선택하는 접기 도구다. `AdminTool`의 native details/summary는 키보드로 열고 닫을 수 있으며 자식 폼을 계속 마운트하므로 단순 접기에서 편집값을 잃지 않는다. 실제 저장/API/단계 잠금은 기존 feature가 소유한다. 공통 색상과 CSS만 사용하며 새 효과 엔진은 연결하지 않는다. [화면 계약](../../docs/spec/design.md#관리자-콘텐츠-안내--p9-13).

## 유리 화살표 버튼 사용

```tsx
<GlassArrowButton label="다음 항목" onClick={next} />

<button type="button" data-glass-arrow-group onClick={openQuiz}>
  <span>퀴즈 제목</span>
  <GlassArrowButton decorative />
</button>
```

장식 모드에 별도 클릭/키보드 이벤트를 붙이지 않는다. 행 버튼이 접근성 이름과 동작을 소유한다. 행 자체의 밝기 전환은160ms로 맞춘다. 테두리 색을 해당 읽기 면에 맞추려면 `--glass-arrow-edge`를 지정한다. 다른 공통 유리 원형 화살표 `GlassArrow`와 구별한다.

### 입체 작업 버튼

`Button`/`ButtonLink`에 `className="action-button-raised"`를 지정한다. 퀴즈 준비와 Live 공개 화면이 같은 윗빛·안쪽 음영·160ms 호버·1px 눌림을 공유하며, 주요/보조 색은 유지한다. 감소 모션·고대비를 지원한다. 실제 예시는 개발 서버 `/dev/design#raised`의 **입체 작업 버튼**이다.

관리자 `.admin-main` 안의 모든 공통 `Button`/`ButtonLink`는 입체 작업 스타일을 자동 적용한다. 주요/보조 색상과 크기·동작은 유지한다. 메뉴·탭·전용 아이콘 컨트롤은 대상에서 제외한다. 공개 화면은 명시한 `action-button-raised`만 적용한다.

## 제작 화면의 입체 조작 부품

| 부품 이름 | 구현 | 사용 기준 |
| --- | --- | --- |
| 카세트 단계 버튼 | `QuizWorkflowSteps.tsx` | 하나의 불투명 프레임, 번호1–6, 이전 단계 눌림·현재 실행색·잠금 대기. `available`과 `reasons`를 기존 업무 조건에서 전달 |
| 단계 본문 제목 | `QuizStageHeading` | 같은 단계 데이터에서 제목·설명 표시. 페이지 상단에 중복 출력하지 않음 |
| 입체 새로고침 버튼 | `AdminRefreshButton` | 기존 원형 크기와 동작 유지, 얕은 윗빛·음영·클릭 눌림 |
| 입체 도움말 버튼 | `HelpButton.tsx` |28px 원형 물음표·44px 터치 영역. `label`로 목적 지정. 실제 도움말 모달 연결은 별도 |

[컴포넌트 갤러리](http://localhost:5173/dev/design#workflow)에서 실제 부품을 조작할 수 있다. 작은 도움말 버튼은 `#help-button`에서 확인한다.
