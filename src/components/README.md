# 실제 앱의 공통 UI

P9-06 검토본과 같은 유리 재질·움직임을 실제 React 페이지에서 사용한다. [native 모듈/계약](../../docs/design/phase-9/sky-v2/components/README.md)이 효과의 정본이고, 이 폴더는 타입·DOM·연결 수명을 담당한다. 새 패키지는 없다.

| 컴포넌트 | 역할/선택 값 | 사용처 |
|---|---|---|
| `GlassPanel` | `surface="reading"` 기본값, `standard`; `as`로 의미에 맞는 태그 | 첫 화면/요약/풀이/지난 퀴즈, 관리자 패널 |
| `GlassMenu` | `as="nav"` 또는 `div`; `clear`, `nested`, `structure` | 주요 메뉴/시간대/난도/운영 메뉴/검수 대상 |
| `GlassLink` | React Router `LinkProps`, 입체 링크 | 관리자 진입, 참여 가능한 다른 퀴즈 |
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
