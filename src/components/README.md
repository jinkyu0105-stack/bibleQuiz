# 실제 앱의 공통 UI

P9-06 검토본과 같은 유리 재질·움직임을 실제 React 페이지에서 사용한다. [native 모듈/계약](../../docs/design/phase-9/sky-v2/components/README.md)이 효과의 정본이고, 이 폴더는 타입·DOM·연결 수명을 담당한다. 새 패키지는 없다.

| 컴포넌트 | 역할/선택 값 | 사용처 |
|---|---|---|
| `GlassPanel` | `surface="reading"` 기본값, `standard`; `as`로 의미에 맞는 태그 | 첫 화면/요약/풀이/지난 퀴즈, 관리자 패널 |
| `GlassMenu` | `as="nav"` 또는 `div`; `clear`, `nested`, `structure` | 주요 메뉴/시간대/난도/운영 메뉴/검수 대상 |
| `GlassButton` / `GlassButtonLink` | native button props/ref 또는 Router LinkProps, 각진 CSS 유리; 별도 효과 연결 불필요 | 관리자 실행/저장/재조회/확인 버튼 |
| `GlassLink` | React Router `LinkProps`, 입체 링크 | 관리자 진입, 참여 가능한 다른 퀴즈 |
| `PageDock` | `GlassMenu`로 구성한 실제 페이지 바로가기 | 메인 하단 |
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

P9-07의 `sky/solar-time.ts`는 서울 날짜/좌표로 네 시간대를 계산한다. 수동 시간은 `bibleQuiz:sky-session`(sessionStorage), 잔디 숨김은 `bibleQuiz:grass-hidden`(localStorage)이다. 기존 theme/sky 저장값은 초기 시간에 사용하지 않는다. `SkyScene`은 shared world의 `cloudSpeed: 2`, `setGround("grass" | "photo")`를 사용하며 기본 native 검토본의 속도/사진 대안은 유지한다. 서울 시간 정책은 [P9-07](../../docs/work/P9-07.md), 잔디 사진 복귀·메인 이동·관리자 버튼은 [P9-08](../../docs/work/P9-08.md)을 따른다.

`GlassButton`은 `type`, `disabled`, form 속성, 이벤트와 ref를 native `<button>`에 그대로 전달한다. 폼의 기본 submit 동작도 유지한다. 공통 `convex-lens`의 반사/테두리와0.6px CSS blur를 사용하며, 버튼별 SVG 굴절 지도·관찰자·상시 animation loop는 만들지 않는다. 모서리는10px이며 움직임/투명도 감소와 강제 색상을 따른다. 이미 `GlassMenu`가 소유하는 선택 버튼과 주간6단계는 각자의 선택 표시를 유지한다. 버튼이 많아도 렌더 비용이0이 되는 것은 아니며 실제 성능은 면적·효과·배경·기기에 따라 달라진다.

```tsx
<GlassButton type="button" disabled={busy} onClick={refresh}>다시 확인</GlassButton>
<GlassButton type="submit" className="primary-button">저장</GlassButton>
```

`useHomeSectionScroll`은 메인에서만 연결한다. 휠 섹션 이동은 약1.2초, 같은 페이지 Router 앵커는 이동 거리별0.9~1.6초로 감속한다. 긴 섹션 내부/중첩 스크롤·확대 휠은 기본 동작을 유지하며 추가 입력/경로 이탈에서 예약 프레임을 해제한다. 링크 클릭 전 위치를 기록하고 Router 복원 뒤 paint 전에 출발점을 되돌려 Firefox의 해시 복원과 충돌하지 않는다. 초기 deep link/뒤로 가기는 기존 Router 복원이며 모바일 터치는 native snap, 감소 모드는 즉시 이동한다.
