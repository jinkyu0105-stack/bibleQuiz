# 인계 — P9-06 OriginKit 잔디 비교, 사용자 검수 대기

## 현재와 다음 한 작업

2026-10-08 사용자는 새 하늘 시안에 긍정적으로 응답하고 OriginKit Grass Field base로 하단 잔디를 시험하되 마음에 들지 않으면 되돌릴 수 있게 하도록 요청했다. **현재P9-06은 잔디 비교 검수 대기, 부모인 전체 UI 개편은 진행 중**이다. 다음 첫 작업은 같은 P9-06에서 새 잔디/기존 사진 선택과 추가 보정을 반영하는 것이다. 대표 시안 확정 후 기존 앱 연결·실제 기능 검사를 이어간다. 새 번호를 만들지 않았고 P9-04와 이전 Phase9 승인 범위 완료는 유지한다.

[작업/검사 근거](work/P9-06.md) · [현재 디자인](spec/design.md) · [OriginKit 출처·조정·복귀](design/phase-9/sky-v2/ORIGINKIT.md). 기존 숲·종이·색상 기준은 종료하고 보관했으며 자산은 삭제하지 않았다. 이번 잔디 선택도 기존 이미지/폰트를 덮어쓰지 않는다.

## 사용자가 직접 볼 화면과 복귀

- 새 잔디: **`http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass#ground-controls`**
- 기존 사진: **`http://localhost:4189/docs/design/phase-9/sky-v2/?ground=photo#ground-controls`**
- 매개변수 없는 기존 주소는 사진이 기본이다. 하단 **기존 사진 / 움직이는 잔디** 버튼으로 스크롤 위치를 유지하며 즉시 비교한다. 우측 시간대 버튼은 새벽/낮/노을/밤, 멈춤은 구름과 잔디에 함께 적용한다. 모바일 공개 제어는 아래쪽이다.

시간대/잔디 선택은 검토본 URL에만 기록하며 앱 저장 설정을 변경하지 않는다. `#ground-controls`는 하단 비교 영역으로 이동한다. 이미지·구름·폰트는 기존 그대로고 즉시 복귀는 **기존 사진** 버튼이다. 코드 제거까지 결정하면 이번 잔디만 담은 커밋을 확인해 `git revert`로 되돌릴 수 있다. 변경 전 기준은 **8d5752b**, 파괴적 reset은 필요 없다.

loopback4189 정적 서버를 재시작해 검증했다. 재개할 때 응답을 먼저 확인하고 없으면 다음 명령으로 연다.

```sh
python3 -m http.server 4189 --bind 127.0.0.1 --directory /home/onegem/work/bibleQuiz
```

검토본의 풀이/관리자는 예시 입력·메모리 편집만 사용한다. 실제 자료/AI/저장/발행과 연결하지 않는다. 이전 `air-sky-study/`는 과거 근거이고 현재 수정 위치는 `docs/design/phase-9/sky-v2/`다. 시작 순서는 AGENTS→PROJECT_CONTEXT→DECISIONS→STATUS→HANDOFF→implementation 관련spec/work→Git status/diff/log다.

## 변경·검사·남은 한계

- OriginKit 실제 페이지의 Get this component→MCP 안내를 확인하고 설치된 MCP `get_component`로 grass-field/base/vite/css/typescript를 받았다. 새 패키지/설치/결제 없음. Refero MCP는 사용하지 않았다. 반환 원본의 네 shader와 실제 적용 코드가 동일함을 대조했다. 잔디 geometry·바람·마우스 반응을 재사용하고 React lifecycle/자체 검정 하늘을 현재 검토본의 시계·투명 canvas·시간대·정지·오류 복구로 연결했다. 무수정 React 설치라고 보고하지 않는다.
- 변경 파일: 새 `originkit-grass.js`/`ORIGINKIT.md`, 기존 index/style/world/review와 README, 관련 design spec/DECISIONS/work/STATUS/HANDOFF. 원래 사진 기본값, 잔디 비교 버튼, 지면 근처 동적 로딩,30Hz·초기 모바일9,000/PC24,000개 제한을 사용한다.
- Chromium: 기본/첫 화면 잔디 요청0, 지면 접근 시1회 초기화, 사진 복귀 시 스크롤 유지/그리기 정지, renderer 재사용, 네 시간대와 URL/reload, 마우스, 멈춤/감소/사용자 멈춤 보존, WebGL 손실·복원 및 모듈 실패의 사진 복귀.320/390/768/1440px 가로 넘침 없음. Firefox390px 밤 잔디 smoke도 통과. 런타임 오류0.
- PC 네 시간대와 모바일 캡처를 직접 확인했다. 숨은 탭 정지는 **모의 visibility 이벤트** 검증이다. 실제 OS/휴대폰 GPU/FPS/배터리/IME·Windows/macOS 폴백은 미검수. 이전 WebKit 시스템 라이브러리 부족은 해결/재검사하지 않았다. 기존 사진 시안의 Lighthouse99/91을 새 잔디의 성능 점수로 쓰지 않는다.
- 최종 JS 구문 검사·`pnpm run lint`·`pnpm run typecheck` 통과. 문서 로컬 링크·`git diff --check`도 통과했다. 검증된 변경만 로컬 커밋한다. 기존 출시 검사/전체 `pnpm check`/E2E/유료 호출은 반복하지 않았다. 새 이미지 생성도 없음.
- 첫 pointer 검사는 고정800ms 대기가 소프트웨어 WebGL의 완화 반응보다 짧아 실패했다. 실제 종료 조건을 기다리는 방식으로 보정 후 관련 전체 흐름 통과. 독립 renderer의 상태를 매 프레임 aria-live에 다시 쓰지 않게 했고 비교 선택자는 body가 아닌 버튼으로 한정했다. 전체 React 원본과 검정 하늘을 그대로 삽입하는 방식은 현재 HTML/하늘·모바일·공유 정지에 맞지 않아 채택하지 않았다.
- 증거는 Git 제외 `.wrangler/design-references/p9-06-originkit/verification.json`, `verified-*.png`, `grass-field-base.tsx`, `component-dialog.png`. 원본 소스 참고본은 줄바꿈 정규화본이다. 이전 Air/이미지 생성 증거는 `.wrangler/design-references/p9-06-air/`에 그대로 있다.

## Git·배포·보존

이번 시작 HEAD **8d5752b**, main/worktree clean, origin/main보다5커밋 앞섬. 종료 전 실제 GitHub main도 `ls-remote`로21b81dee578c6dad5decc3add9d71102a3595df6임을 확인했다. 검증한 잔디/문서만 독립 로컬 커밋으로 남긴다. 해당 커밋의 부모는8d5752b이며 정확한 종료 HEAD/clean/미푸시 수는 최종 Git log/status를 따른다. push하지 않는다.

| 대상 | 유지하는 version/소스 |
|---|---|
| Production app |7aea6843-5288-42da-9bef-bc673e1d9dfe / 소스37b7254, 직전27f75159-4019-4afc-b871-048e4e9d15f7|
| Production content |48a1269d-a9b2-4405-8bbc-745cdabec1b0 / 기존56bb1bf|
| Production backup |3fb0e7c7-368b-45a9-89f9-2818739e415d / 기존 배포|
| Preview app |3dc36ff6-f6d0-4627-bc43-6beeb3495391 / GitHub21b81de 자동 배포|
| Preview content |2df93f07-3703-42ec-b576-fd085e8c839f / 기존 배포|

배포 버전은 기존 기록을 재사용했다. Cloudflare 원격 재검수/배포/migration/Secret/실제AI를 실행하지 않았다. 일반 Preview는 main push 자동 배포만, Production은 별도 사용자 요청이다.0000~0038·실제 자료/키/유료 결과·celebration/garden-v1/garden-v2·출력 TTF/fontkit 패치를 보존한다. `src/public`·Worker/설정/SQL/package/lockfile 변경 없음. 이전 CI/운영 검사·LCP5.4초·기기/관측 한계와 rollback은 [P9-04](work/P9-04.md)에 유지한다.

`pnpm dev`는 영속 합성 `.wrangler/ui-demo-state/`, 기존 실제 로컬은 `pnpm dev:local`, E2E는 임시DB 격리다. 이번 정적 검토본과 혼동하지 않는다.

## 실행·사용량·세션

시작 Pro6% 사용/94% 잔여, 별도5시간 없음, 사용자 지정×10=940%. 추천은 **Astra·Max**이며 모델 설정을 도구로 바꿨다고 주장하지 않는다. `codex-exec-recovery`의 검증된 `/bin/bash`·login:false·명시workdir·승인 검토 경로를 재사용한다. node/pnpm은 현재 프로세스 PATH에만 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 추가한다. Node24.18.0/pnpm11.14.0. 큰 단일 쓰기/TTY 입력은 제한에 걸려 허용된 작은 청크로 분할해 완료했다. 기본 ENOENT를 저장소 단절로 단정하거나 기존 Computer Use WSL URI 실패를 반복하지 않는다.

같은 P9-06의 사용자 잔디 선택/보정이 남으므로 **세션 유지**. 다음 작업 추천 **Astra·Max** — 하늘·잔디의 빛/원근/움직임과 한글 화면의 연결을 함께 판단해야 한다.
