# P9-06 유리 UI 컴포넌트 정리

2026-10-10. 압축 오류가 난 이전 세션의 미처리 요청을 이어받았다. 시작 경로 `/home/onegem/work/bibleQuiz`, HEAD `585f6de`, main 작업 트리 clean, 추적 origin/main `21b81de`보다 38개 앞섰다. 미처리 요청은 “토글 박스·메인 텍스트 박스와 필요한 나머지 UI를 재사용할 수 있게 컴포넌트화”다.

## 판단과 변경

기존 `dock-motion.js`의 탄성 계산과 `.glass` CSS는 공유하고 있었으나 `liquid-glass.js`가 카드/관리자/메뉴의 화면 선택자를 직접 열거했다. 이를 다른 페이지에 쓰려면 초기화·스타일 코드를 함께 복사해야 했다.

- `sky-v2/components/glass.js`: 재사용 root 단위 초기화, 본문/안정된 패널 장식, 선택 표시, 렌즈/반사, 재측정·해제 수명을 제공한다. 화면 이름과 URL은 알지 않는다.
- `components/dock-motion.js`: 기존 탄성 계산을 이동했다. 빈 메뉴의 초기화만 안전하게 건너뛰며 기존 계수·포인터/키보드/터치 반응은 같다.
- `components/glass-base.css`, `glass-prism.css`: 공통 토큰·재질·박스·메뉴·입체 버튼·감소/강제 색상 대안이다. 원래 CSS 파일은 이 파일을 가져오고 화면별 배치와 밝기 보정을 유지한다.
- `index.html`에 박스 역할과 중첩/hover 메뉴 역할을 선언했다. `liquid-glass.js`는 검토 URL 옵션과 화면의 메뉴 설정만 담당한다. 변경된 CSS/JS 주소의 버전은 `20261010-components-1`이다. world·잔디·영상 버전은 그대로다.
- [사용법과 독립 예제](../../design/phase-9/sky-v2/components/README.md)를 추가했다. 예제는 페이지 전용 CSS/JS 없이 공통 파일만 사용한다. 입력 내용·선택 상태는 사용하는 화면이 소유한다. 실제 앱의 React 컴포넌트·API 연결은 하지 않았다.

새 의존성·서비스·제품 동작·작업 번호를 만들지 않았다. 기존 시안의 모양을 다시 설계하거나 HTML을 런타임 템플릿으로 전부 교체하는 접근은 사용하지 않았다. 네이티브 태그와 접근성·기존 클릭/입력 경로를 보존하면서 공통 효과를 분리했다. `design-taste-frontend`의 보존 규칙을 적용했고 기존 구성/모션/밀도를 유지했다.

## 검증

Git 제외 증거는 `.wrangler/design-references/p9-06-components/`에 둔다.

- 변경 전후 Chromium 공개/풀이/관리자 × 새벽/낮/노을/밤 × 390/1440px = 24조건의 주요 표면 크기·색·스타일이 모두 일치했다. 첫 화면 24장과 공개 카드 16장, 총 40 PNG가 바이트 단위로 같았다. `video=off`, 기존 사진, 움직임 감소 상태로 비교했다. 움직이는 모든 프레임이나 실제 장치의 성능 동일성을 의미하지 않는다.
- [재실행 가능한 브라우저 검사](../../../scripts/check-sky-components.mjs): 독립 예제의 박스·메뉴·입체 버튼, 동일 root 재연결/중복 방지, 서로 다른 root의 필터 ID, 해제 시 정리와 내용/스타일 보존, 비어 있는 메뉴, 반사 중첩/정지, 키보드·터치 선택, 선명하게/움직임 감소/강제 색상, 관리자 hover와 실제 선택 구분·초안/확인 gate, 390px 운영 메뉴와 안내창, 한글 입력·난도 이동, 네 시간대, soft/off/menu-glass 비교를 확인한다.
- Chromium/Firefox에서 런타임 오류·외부 요청 0. 실제 Worker·DB·AI/API를 사용하지 않았다. 기존 WebKit 시스템 라이브러리 부재/실기기 한계는 그대로며 이번에 그 검사를 통과했다고 주장하지 않는다.
- `pnpm run lint`, `pnpm run typecheck`, JS 구문·diff·문서 링크 검사 결과는 최종 HANDOFF를 따른다. Phase/배포 완료가 아니므로 전체 `pnpm check`·출시 E2E·실제 유료 호출을 반복하지 않았다.

## 보존과 다음 작업

원래 이미지·영상·master·video-kit·폰트/fontkit·실제 자료·키·유료 결과·migration·패키지·Cloudflare 설정과 운영 코드는 변경하지 않았다. push·배포 없음. 로컬 컴포넌트 정리 요청은 완료이며 부모 P9-06은 진행 중이다. 기존 잔디/영상 시각 피드백과 실제 앱 연결은 별도 남은 범위다.

실행은 기본 셸 시작 전 ENOENT와 Node REPL의 sandboxCwd 오류를 확인한 뒤 `codex-exec-recovery`의 `/bin/bash`, login:false, 명시 workdir, 승인 검토 경로로 계속했다. 보안/앱 설정은 바꾸지 않았다. 시작 Pro 65% 잔여, 별도 5시간 값 없음, 사용자 지정 ×10=650%. 세션 유지, 다음 추천 GPT-6.1-Sol/high(기존 시안과 공통 동작을 함께 검토).
