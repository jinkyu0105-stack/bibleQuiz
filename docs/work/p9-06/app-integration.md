# P9-06 실제 React 페이지 적용 — 2026-10-10

사용자의 “이제 실제 페이지에 적용시키세요” 지시로 7ab710b의 재사용 유리 UI와 승인된 하늘/영상/잔디를 실제 앱에 연결했다. 독립 검토본은 유지한다. 첫 화면부터 기존 풀이/관리자 기능으로 이동하며 예시 시안의 가짜 저장·발행 동작은 옮기지 않았다. 원격 연결·push/배포·유료 호출·패키지 추가는 없다.

## 코드 진입점

| 위치 | 역할 |
|---|---|
| `src/components/glass/` | Panel/Menu/Link/Arrow와 root 단위 연결/해제 hook |
| `docs/design/phase-9/sky-v2/components/` | 실제 앱과 독립 검토본이 공유하는 재질·반사·탄성 효과 |
| `src/components/sky/` | 네 시간대/기기 설정, 저장 설정, 단일 world 수명, 기존 미디어의 Vite URL |
| `docs/design/phase-9/sky-v2/world.js`, `sky-video.js` | 기존 배경 엔진에 자산 resolver/선택 영상 목록/명시적 dispose 추가 |
| `src/features/quiz/home-page.tsx` | 실제 공개 loader를 사용하는 새 첫 화면, 기존 `/?level=…` 호환 |
| `src/app/screens.tsx`, `src/app/router.tsx` | 실제 경로, 공통 헤더/운영 메뉴/배경, 화면 이동의 스크롤 복원 |
| `src/features/quiz/`, `archive/`, `admin-weekly/`, `admin-sermon-input/` | 기존 기능에 공통 UI 적용 |
| `src/styles/sky-scene.css`, `sky.css` | 승인된 배경/첫 화면 배치와 기존 기능 페이지의 색·배치 연결 |
| `tests/e2e/sky-app.spec.ts` | 첫 화면→실제 풀이/초안 복원, 반복 이동 정리, 설정·영상 정책 |

[컴포넌트 계약과 예제](../../../src/components/README.md) · [제품 기준](../../spec/design.md#실제-react-페이지-적용).

`/`는 실제 이번 주 제목·날짜·장절·AI 요약 일부/고지·난도 링크와 지난 퀴즈를 제공한다. `/quiz/:slug?level=…`와 기존 `/?level=…`는 원래 API/답안 키를 쓴다. 지난 퀴즈의 검색/더 보기/뒤로 가기, 관리자 6단계/검수/초안 저장/확인 단계, IME/제출/결과 복원/출력과 공개 자료 경계를 유지한다. 원문/성경 본문을 새로 만들지 않았다.

React DOM과 선택 상태는 기존 feature가 소유한다. native glass의 `descendants:false`로 중첩 컴포넌트를 중복 연결하지 않고, `aria-selected`를 기존 `aria-pressed`/`aria-current`와 함께 관찰한다. world도 한 root에서 공유하며 이벤트/프레임/WebGL/영상 정리와 비동기 로드의 해제 이후 guard를 추가했다. 기존 native 기본값과 비교 옵션은 유지했다.

## 검사와 확인된 실패의 처리

모든 E2E는 로컬 임시 D1/합성 자료 또는 기존 API mock을 사용한다. 운영 관리자 로그인/DB/실제 AI 실행 검증을 뜻하지 않는다. 증거는 Git 제외 `.wrangler/design-references/p9-06-app/`에 있다.

| 검사 | 결과/증거 |
|---|---|
| 독립 컴포넌트 Chromium/Firefox·터치 회귀 | `node scripts/check-sky-components.mjs` 통과, 오류/외부 요청0 (`components.log`) |
| 공개/입력/지난 퀴즈/실제 발행 데이터 연결, Chromium·모바일 | 첫 실행65통과/1제외/2실패. 이미지 대기와 캡처 검사를 아래처럼 수정 후 해당 파일 재검사 통과 (`e2e-public.log`) |
| 새 하늘/관리자 주간/초안/발행/출력/지난 퀴즈, Chromium·모바일 | 첫 실행70통과/2실패. 모바일 메뉴 위치와 긴 캡처 검사 수정 후 해당 파일 재검사 통과 (`e2e-integration.log`) |
| 수정 후 관리자 주간/입력/반응형/새 하늘, Chromium·모바일 | **59통과/1제외**, 실패0 (`e2e-final.log`). 제외는 PC에서 실행하지 않는 터치 전용 검사 |
| 실제 앱 Firefox: 새 하늘/공개 구성/반응형 | **9통과/1제외**, 실패0 (`e2e-firefox.log`). 제외는 Chromium으로 한정한 MP4 디코딩 검사 |
| 실제 DB 보관 시점 테스트 보정 | 대상5시나리오 통과 (`worker-retention.log`) |
| 전체 `pnpm check` | **통과(exit0)**. lint/typecheck·설정/DB 검사·unit308·Worker2197·Workflow4·recoveryCLI2·Node14·Python7·Vite build (`check-final.log`) |

공개 검사 명령은 `sermon-design`, `responsive-accessibility`, `quiz-input`, `public-quiz`, `published-content-integration`, `archive`의 spec을 포함했다. 두 번째 묶음은 `sky-app`, `responsive-accessibility`, `archive`, `admin-weekly`, `admin-sermon-drafts`, `admin-publication`, `export`였다. 각 묶음은 `pnpm test:e2e … --project=chromium --project=mobile-chromium --workers=2 --reporter=line`으로 실제 브라우저를 실행했다. 목록 조회로 대체하지 않았다. 재실행은 변경·실패가 있는 파일과 영향받는 입력 검사에 한정했다.

- 모바일 관리자 메뉴는 `.glass`의 `position:relative`가 기존 sticky 위치와 충돌해 summary 클릭을 본문 제목이 가렸다. 실제 computed style과 실패한 클릭을 대조해 PC sticky/모바일 relative의 우선순위·top을 명시했다. 초안 충돌/이동 보호 검사가 통과했다.
- 이미지 실패 검사는 lazy celebration 이미지를 보기 전에 `naturalWidth`를 읽어 실패했다. 보이는 위치로 이동한 뒤 디코딩 결과를 기다리게 했다. 전체 작은 화면 캡처는 두 난도×네 크기를 한 테스트에서 실행해30초를 초과했고, 난도별 테스트로 나눠 같은 검사를 유지했다.
- 최초 `pnpm check`는 unit308 통과 뒤 Worker2194통과/3실패였다. 재발행 뒤 정리 테스트의 고정 `2026-10-16`이 SQL `draft_activity`의 실제 현재 시각+7일보다 빨라졌다. Date mock만 고정하는 첫 시도는 SQL 시계를 바꾸지 못해 같은3개가 실패했고 폐기했다. 마지막 영속 활동에서7일 직전은 `not_due`, 정확히7일은 `purged`인지 검사하도록 기존 테스트를 고쳤다. 운영 서비스/SQL/migration과 보관 정책은 변경하지 않았다.
- 실제 캡처는 첫 화면/풀이/관리자×1440/390px에서 오류0·가로 넘침0 (`capture-final.json`). 관리자 실제 로컬 API는 Access 부재의 오류 상태이며, 정상 관리자 자료/저장 흐름은 E2E mock으로 검증했다.
- 밤 풀이의 밝은 입력 격자, 첫 화면을 내려간 뒤 산/잔디 연결은 실제 viewport 캡처로 확인했다. PC19,200/모바일7,200 풀잎과 `near-field-v2`, 오류0·가로 넘침0 (`visual-final.json`). 긴 페이지의 full-page 캡처는 고정 배경을 페이지 전체에 반복하지 않으므로 스크롤 위치별 캡처를 함께 사용했다.
- Chromium PC/모바일은 네 시간대 선택/저장·기기 설정·멈춤/선명하게·강제 색상·hover와 선택 구분, 실제 선택 MP4 디코딩/반응형 원본/화면 밖 정지/실패 사진 대안, 반복 경로 이동 시 필터 ID 중복·효과 누적 없음과 초안 복원을 확인했다.

## 자산·빌드와 확인 한계

`media.ts`는 기존 파일을 명시적 `new URL(..., import.meta.url)`로 가져와 해시 파일명을 받는다. 네 시간대×4K/1080p만 재생 목록에 포함하며 밤4K는 기존23.69MiB 압축본이다. 원본29MiB/이전 비교 영상/master는 실제 앱 재생 목록에 넣지 않는다. 빌드의 정적 파일386개와 선택 영상8개를 확인했다. 영상은 모두 해시 URL로 연결되며 가장 큰 자산은 밤4K 압축본24,836,709bytes(23.69MiB), 모든 파일은25MiB 이하다 (`assets-build.json`). 새 인코딩/미디어 복사·폰트 교체·패키지 추가는 없다.

WebKit은 이번 환경에서 libgtk-4/libgraphene/GStreamer 등 host 라이브러리 부재로 시작하지 못했다. 시스템 설치나 우회 설정은 하지 않았다. 실제 Safari/iPhone/Windows IME, GPU·배터리/FPS·운영 네트워크 성능은 이번에 새로 검증하지 않았다. 이전 검토본 Lighthouse 점수나 운영 LCP를 이번 실제 앱의 새 측정값으로 쓰지 않는다.

Context7에서 `/reactjs/react.dev`, `/vitejs/vite`, `/remix-run/react-router`를 조회하고 설치된 React19.2.8/Vite8.2.2/Router7.18.2와 대조했다. 근거는 [React effect 정리](https://react.dev/reference/react/useEffect), [Vite 정적 자산](https://vite.dev/guide/assets.html#new-url-url-import-meta-url), [Router ScrollRestoration](https://reactrouter.com/api/components/ScrollRestoration), [Cloudflare static asset 제한](https://developers.cloudflare.com/workers/platform/limits/#static-assets)이다. Cloudflare 자산 크기는25MiB/파일 기준으로 확인하며 원격 반영을 실행한 것은 아니다.

## Git·운영 경계

시작 경로 `/home/onegem/work/bibleQuiz`, main HEAD **7ab710b**, clean, 추적 origin/main **21b81de**보다39개 앞섰다. 기존 컴포넌트/시안과 미디어/원본/폰트/fontkit·video-kit·실제 자료/키/유료 결과·0000~0038을 보존했다. 변경은 UI/공통 엔진 연결/관련 E2E/시간 경계 테스트1건과 문서다. 확인한 자기 파일만 로컬 커밋하고 종료 HEAD/clean은 최종 Git 기록으로 확인한다. `.wrangler/deploy/config.json`은 검사 전 파일과 byte 동일하다. `dist/`는 이번 로컬 검사용 빌드이며 배포하지 않았다. 최종 변경 문서11개의 로컬 링크366개·shared JS 구문 검사·`git diff --check`도 통과했다. 빌드의 fontkit 청크711kB 크기 안내는 남았으며 기존 출력 경로/자산을 유지했다.

운영/Preview/content/backup의 버전은 [HANDOFF](../../HANDOFF.md#git과-배포)를 유지한다. main push는 Preview 자동 배포를 일으키므로 이번 요청에서 실행하지 않는다. 사용자 지시 없는 Production 연결/배포·원격 migration·실제 AI를 추가하지 않는다.

## 완료와 다음 경계

P9-06의 승인된 실제 페이지 적용·필수 검사·문서화를 완료했다. 부모 P9-06도 이번 로컬 범위에서 완료이며 운영/Preview 미반영을 완료로 가장하지 않는다. 다음 자동 작업은 없고 사용자 화면 피드백 또는 별도 배포 지시를 기다린다. 세션 유지, 작은 후속 보정은 GPT-6.1-Sol/high 추천(공통 재질과 실제 입력 동작을 함께 확인). 시작 Pro63%/종료61% 잔여, 별도5시간 값 없음, 사용자 지정×10=630%/610%다.
