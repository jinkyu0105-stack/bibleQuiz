> 현재 분야별 명세. 기존 implementation 18장 기준을 옮겼으며 구현 일지는 보관본으로 분리했다.
> [명세 목차](../../implementation.md) · [현재 상태](../STATUS.md) · [변경 전 원문](../archive/2026-09-21-p5-48/implementation.md#18-이후-디자인이미지-스킬-사용-규칙)

## 18. 이후 디자인·이미지 스킬 사용 규칙

사용자가 지정한 세 스킬은 이번 문서 작성 단계에서 실행하지 않았다. 다음 단계에서 아래 순서와 범위로 사용한다.

### 18.1 `imagegen-frontend-web`

경로: `/home/onegem/.agents/skills/imagegen-frontend-web/SKILL.md`

목적은 코드를 만들기 전 웹 화면의 시각적 방향을 정하는 것이다. 이 스킬 규칙대로 **섹션마다 별도의 가로 이미지 한 장**을 만든다. 여러 섹션을 한 장의 작은 보드에 압축하지 않는다.

권장 reference 섹션:

1. 설교 hero·메타데이터
2. 퀴즈 workspace(격자 + 단서)
3. 제출 결과·참여 현황·Top N
4. 아카이브
5. 관리자 주간 발행·검수

어린이/장년의 visual track 차이가 큰 hero와 workspace는 각각 별도 reference를 만든다. 이 이미지는 개발 참고용이고 실제 사이트 배경으로 그대로 쓰지 않는다.

### 18.2 기본 `imagegen`(사용자가 말한 “image gem”)

실제 주간 bitmap 자산을 만드는 도구다.

- 어린이 desktop landscape
- 어린이 mobile portrait
- 장년 desktop landscape
- 장년 mobile portrait

본문 10장의 art direction을 사용한다. P9-02에서 사용자가 기존 4종을 교체하도록 명시했으므로 Phase7A 01/02 원본 이미지를 직접 입력으로 사용해 같은 숲·종이 정원 배경을 재구성한다. 기존 화면 reference 8종과 celebration은 다시 생성하지 않는다. 글자·로고·성경 구절을 이미지 안에 생성하지 않는다. 생성 후 원본을 눈으로 검수하고, 적절한 자산만 최적화한다.

### 18.3 `imagegen-frontend-mobile`

경로: `/home/onegem/.agents/skills/imagegen-frontend-mobile/SKILL.md`

이 스킬은 설명상 반응형 웹 배경이 아니라 **모바일 앱 화면 콘셉트**에 최적화되어 있다. 따라서 모바일 UI의 별도 화면 reference나 향후 PWA/앱 콘셉트가 필요할 때 사용한다. 단순 세로 배경 이미지는 기본 `imagegen`으로 만든다. 이 구분은 스킬의 기본 phone mockup이 실제 모바일 웹 구현 사양으로 오인되는 것을 막는다.

### 18.4 `design-taste-frontend`

경로: `/home/onegem/.agents/skills/design-taste-frontend/SKILL.md`

웹 reference와 이 문서가 승인된 뒤 실제 코드를 구현할 때 사용한다.

- 최초 구현은 greenfield editorial interactive web app으로 pre-flight를 수행했다. P9-02 같은 기존 앱 개편은 현재 화면·승인 시안·기능을 먼저 대조하고 기존 토큰과 컴포넌트를 재사용한다. 현재 사용자의 명시적 구현 요청과 기능 보존 조건이 skill의 기본 새 시안 생성 절차보다 우선한다.
- 제품 성격: 교회 가족용, 접근성 우선, 장년은 사색적, 어린이는 따뜻하되 유아적이지 않음
- 추천 dials: visual intensity `5/10`, motion `3/10`, density `5/10`
- 디자인 토큰과 컴포넌트 구조를 먼저 세운다.
- 시각적 판단이 이 문서의 IME, 보안, 정답 비공개, 접근성 하드 게이트를 덮어쓰면 안 된다.

### 18.5 실행 순서

```text
implementation.md 승인
→ imagegen-frontend-web 섹션별 reference
→ 필요할 때 imagegen-frontend-mobile 화면 reference
→ design-taste-frontend로 Phase 3~6 화면 코드 구현
→ 기본 imagegen으로 실제 배경 4종과 Phase 7B 최종 polish
→ 실제 브라우저·기기·출력 QA
```
