# 인계 — P9-06 새 하늘 대표 시안, 시각 검수 대기

## 현재와 다음 한 작업

2026-10-08 사용자는 기존 숲·종이·색상 기준이 필요 없다고 명시하고 **Astra·Max로 처음부터 다시** 만들도록 요청했다. P9-06에서 공개 낮/밤·네 시간대·같은 구름 공간의 하강/들판·모바일 풀이·관리자 검토 시안을 새로 만들었다. [P9-06 작업/검사 근거](work/P9-06.md) · [현재 디자인](spec/design.md) · [D-042 보완](DECISIONS.md#d-042--air의-연속-하늘시간대-전환을-새-ui-방향으로-채택). 기존 기준은 [보관본](archive/2026-10-08-pre-sky-design.md)에 남기고 현재 명세에서 종료했다. 기존 자산은 삭제하지 않았다.

**현재P9-06은 시각 검수 대기, 부모인 전체 UI 개편은 진행 중**이다. 다음 첫 작업은 같은 P9-06에서 사용자의 화면 확인/지적을 반영해 보정하는 것이다. 대표 시안 확인 후 기존 앱 연결과 실제 기능 검사를 이어간다. 이번에 새 후속 번호를 만들지 않았으며 전체 앱/운영 변경을 완료한 것으로 보고하지 않는다. P9-04와 이전 Phase9 승인 범위 완료는 유지한다. 범위 안의 작은 보정을 내부 단계마다 다시 승인받지 않는다. Production/새 비용·production dependency/service 경계는 유지한다.

## 사용자가 직접 볼 화면

**`http://localhost:4189/docs/design/phase-9/sky-v2/`**. [검토 안내/소스](design/phase-9/sky-v2/README.md). Codex 브라우저 패널 열기를 호출했고 응답은 `queued`였다. 기본 낮, 우측 시간대 버튼으로 새벽/낮/노을/밤을 비교한다. 아래로 스크롤해 구름/지면을 확인하고 하단 검토 메뉴로 공개·풀이·관리자를 오간다. 모바일 공개는 시간대 제어가 아래쪽, 모바일 풀이/관리자는 내용 위에 있다.

공개는 원경/구름/지면을 같은 진행도로 움직이는 독자 WebGL billboard 장면이다. 원본 Air3D/유리 로고/잔디 구현의 복제는 아니다. 풀이는 예시8×8 격자의 입력/단서/초기화, 관리자는 메뉴/6단계 배치·탭/편집 미리보기/확인 표시를 검토한다. 실제 원문/정답/AI 결과/저장/발행과 연결하지 않는다. 예시 편집은 메모리에만 남으며 새로고침하면 초기화된다.

기존4189 loopback 정적 서버를 재사용했다. 재개 시 먼저 응답을 확인하고 없으면 다음 명령으로 연다. 기존 개발 서버는 종료/변경하지 않았다.

```sh
python3 -m http.server 4189 --bind 127.0.0.1 --directory /home/onegem/work/bibleQuiz
```

기존 `air-sky-study/`는 P9-05의 과거 움직임 탐색 근거로 남긴다. 새 수정은 `sky-v2/`에서 진행한다. 변경 시 필수 검사·STATUS/HANDOFF 갱신·로컬 커밋까지 마친다. 문서 시작 순서는 AGENTS→PROJECT_CONTEXT→DECISIONS→STATUS→HANDOFF→implementation 관련spec/work→Git status/diff/log다.

## 결과·검사·남은 한계

- 새 이미지8개(대표 장면5개/투명 구름3종), 실제 한글 Noto Sans KR400, native HTML/CSS/JS/WebGL. `imagegen-frontend-web`/`imagegen`, 공개 화면에 `design-taste-frontend`를 사용했다. Refero는 기존 DESIGN.md/CSS Variables 수동 참조이며 MCP/Tailwind export/설치/결제 없음. 원본 Air 매체/코드/유료 폰트도 복사하지 않았다. 정확한 프롬프트·해시·용량은 [assets.json](design/phase-9/sky-v2/assets.json).
- Chromium 시간대/구름/하강/멈춤/OS감소/폰트/320~1440px/예시입력/관리자 편집/장식 실패·WebGL 복원·외부 API 요청 없음/runtime error0. 숨은 탭 중단은 **모의 visibility 이벤트**로 확인했다. Firefox390px 밤 풀이 smoke 통과. 실제 OS의 탭/배터리·Windows/macOS 폴백·휴대폰 IME/입력/성능은 미검수다.
- WebKit은 실행 시 libgtk-4/libgraphene/GStreamer 등 시스템 라이브러리 부족으로 시작하지 못했다. 현재 시안은 Chromium/Firefox에서 검토했고 WebKit 통과로 쓰지 않는다. 앱 연결 단계의 브라우저/실기기 검수는 남아 있다.
- 최종 `node --check`, `pnpm run lint`, `pnpm run typecheck`, `git diff --check`, 변경 문서 링크 확인. 기존 Phase/출시 검사·`pnpm check`/전체E2E/IME/PDF/백업/유료 호출은 반복하지 않았다. P9-06 시안을 앱 출시 완료로 올리지 않는다.
- Lighthouse13.5 로컬 1회씩: desktop 성능99/접근성100/LCP0.9초, mobile91/100/3.1초, TBT0/CLS0.002. 정적 서버/소프트웨어 WebGL/모바일 시뮬레이션이며 실제 운영/기기와 직접 비교하지 않는다. 캐시/대표 화면 통합CSS/글꼴 blocking 등 진단을 [P9-06](work/P9-06.md)에 남겼다.
- 첫 lint global 누락, 밤 배경의 stacking, 동일 구름 반복, 모바일 제어 겹침, 작은 본문/밤 격자 대비를 고쳤다. 입력 중 검토 메뉴 숨김, 사용자 멈춤의 OS설정 왕복 보존, WebGL 복원 참조 정리도 재검증했다. FontTools/Pillow 부재는 기존 bundled Pillow/프로젝트 fontkit으로 해결했다. 기존 fontkit 파일은 변경하지 않았다.
- 증거는 Git 제외 `.wrangler/design-references/p9-06-air/`의 `verification.json`, `final-refinements.json`, Lighthouse JSON, `review/*.png`. 원본 master도 이 안의 `masters/`와 생성 위치에 보존한다. 원본 사이트 전체 DOM/network/JS는 커밋하지 않는다.

## Git·배포·보존

이번 시작 HEAD **51c40e2**, main/worktree clean, origin/main보다4커밋 앞섬을 확인했다. 종료 전 실제 GitHub main을 `ls-remote`로 다시 확인했으며 **21b81dee578c6dad5decc3add9d71102a3595df6** 그대로다. 변경은 `docs/design/phase-9/sky-v2/`와 관련 design/spec/work/기본 안내·보관 문서뿐이다. 검증된 P9-06 변경을 이 문서와 함께 로컬 커밋한다. 해당 커밋의 부모는51c40e2이며 정확한 종료 HEAD/clean/미푸시 수는 최종 Git log/status를 따른다. push하지 않는다.

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

시작 Pro4% 사용/96% 잔여, 별도5시간 없음, 사용자 지정×10=960%. 요청 모델/추천은 **Astra·Max**이며 모델 설정을 도구로 바꿨다고 주장하지 않는다. 기존 실패 경로 대신 `codex-exec-recovery`의 검증된 `/bin/bash`·login:false·명시workdir·승인 검토 경로를 재사용했다. 기본 process ENOENT를 저장소 단절로 단정하지 않는다. node/pnpm은 현재 프로세스 PATH에만 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 추가한다. Computer Use WSL URI 실패 경로는 반복하지 않았다.

같은 P9-06의 사용자 시각 검수/보정이 남으므로 **세션 유지**. 다음 작업 추천 **Astra·Max** — 실제 Air 대비 구름의 질감·빛·공간감과 공개/풀이/관리자 한글 UI를 함께 판단해야 한다.
