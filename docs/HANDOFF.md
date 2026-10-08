# 인계 — P9-06 첫 화면 구름 밀도 복원, 사용자 검수 대기

## 현재와 다음 한 작업

2026-10-08 사용자는 직전 보정의 나머지는 좋지만 첫 화면이 듬성듬성하다고 지적했다. **원래 빽빽한 양옆 구름을 복원하고 같은 위치의 분리 요소로 삼아 좌우로만 조금씩 움직이기**가 최신 지시다. 해당 보정/관련 검사를 마쳤고 **현재P9-06은 사용자 시각 검수 대기, 부모 전체UI개편은 진행 중**이다. 다음은 첫 화면의 구름 밀도/흐름 확인·필요 보정이며 대표 시안 확정 뒤 기존 앱 연결이다. P9-04와 이전Phase9 완료는 유지한다.

[작업·검사 근거](work/P9-06.md#첫-화면의-원래-구름-밀도-복원--2026-10-08) · [현재 디자인](spec/design.md).

## 직접 볼 화면과 복귀

- **첫 화면:** `http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass&time=day` — 새로고침 후 맨 위에서 원래 구름 구도와 느린 수평 이동을 본다. 밤도 같은 원본 구름 밀도를 유지한다.
- 스크롤하면 앞서 만든 구름5종/산/잔디로 이어진다. 콘텐츠 최대1440px·잔디 양끝 보정·산4K는 유지한다. 기존 사진 버튼과`mountains=off` 비교도 그대로다.
- 이번 보정 전 기준**95cc314**, 넓은 화면 보정 전aa6d1d0. 이번 첫 화면/문서만 독립 커밋하므로 필요하면 해당 커밋을 확인해revert한다. 기존이미지 삭제/reset이 필요 없다.

loopback4189 정적 서버를 재사용했다. 없을 때만 실행한다.

```sh
python3 -m http.server 4189 --bind 127.0.0.1 --directory /home/onegem/work/bibleQuiz
```

수정 위치는`docs/design/phase-9/sky-v2/`다. 실제 앱/저장/API와 연결하지 않았다. 시작순서는 AGENTS→PROJECT_CONTEXT→DECISIONS→STATUS→HANDOFF→implementation 관련spec/work→Git status/diff/log다.

## 변경·검사·한계

- `sky-banks.js`/index canvas: 기존day/night 이미지를 같은 좌표의12개 구름군 마스크 영역으로 나눠 수평으로만 약22px 이내 이동한다. 원본좌표의 연속 보간이며 구름별PNG 추출/새 생성/완전3D 분리는 아니다. 중앙하늘/달·구도·색상을 유지한다. 별도RAF 없이world 공통시계를 쓰고 표시 중30Hz·최대2560×1440으로 제한한다.
- `world.js`/style: 공개 첫 화면의 원본opacity14%→100%, 새 전경구름은 하강에 따라 등장, 자동 상하흔들림 제거. 첫 스크롤 검수에서 보인 아래쪽 직선 경계는 진행도 마스크로 이어줬다. 맨위는 완전불투명이다. 원본picture는 로딩/그래픽실패 복귀용으로 유지하고context복원/resize에도 재연결한다.
- Chromium1440×900/2560×1080/2560×1440/390×844 구도/넘침0·네 시간대. 원본 대비 평균채널오차 낮0.54/밤0.63미만(255기준).45초 샘플의 세 구름영역은수평+3/+12/−8px·수직0px, 위빈중앙픽셀차0. 실제 공통시계/정지draw중단·OS감소·정지중GL복원·작은창→큰창 원본교체·하강/상단복귀·기존 산/잔디를 확인했다. Firefox2560px밤도 통과, runtime error0·외부요청0.
- JS 구문·lint/typecheck 통과. 최종diff/문서 로컬 링크/기존23개 자산해시와 보존 경로 확인도 통과했다. 검증한 변경을 로컬 커밋한다. 기존 전체pnpm check/출시E2E/Lighthouse/유료호출은 반복하지 않았다. 실제GPU/배터리/IME/WebKit/OS폴백 한계는 유지한다. 기존99/91은 최초사진시안 점수다.
- 근거는 Git 제외`.wrangler/design-references/p9-06-dense/`의visual-review/pixel-review/verification/edge-review JSON과PNG. 원본을 흐리게 낮추고 새 구름 몇 개로 채우는 첫 구도는 폐기했다. 기존이미지/잔디코드/산/폰트와 실제앱 경로는 변경하지 않았다.

## Git·배포·보존

시작HEAD**95cc314**, main/worktree clean, origin/main21b81de보다8커밋 앞섬. 이번 첫 화면/관련 문서를 하나의 로컬 커밋으로 남긴다. 해당 커밋의 부모는95cc314이며 정확한 종료HEAD/clean/미푸시수는 최종Git log/status를 따른다. push없음. 원격배포는 재검수하지 않았다.

| 대상 | 유지하는 version/소스 |
|---|---|
| Production app |7aea6843-5288-42da-9bef-bc673e1d9dfe / 소스37b7254, 직전27f75159-4019-4afc-b871-048e4e9d15f7|
| Production content |48a1269d-a9b2-4405-8bbc-745cdabec1b0 / 기존56bb1bf|
| Production backup |3fb0e7c7-368b-45a9-89f9-2818739e415d / 기존 배포|
| Preview app |3dc36ff6-f6d0-4627-bc43-6beeb3495391 / GitHub21b81de 자동 배포|
| Preview content |2df93f07-3703-42ec-b576-fd085e8c839f / 기존 배포|

배포 기록을 재사용했으며 원격재검수/배포/migration/Secret/실제AI를 실행하지 않았다. Preview는main push 자동배포만, Production은 별도요청이다. `src/public`·Worker/설정/SQL/package/lockfile·0000~0038·실제자료/키/유료결과·기존이미지/폰트/fontkit을 보존한다. 이전검사·LCP5.4초·rollback 근거는[P9-04](work/P9-04.md)를 따른다.

## 실행·사용량·세션

시작Pro9%사용/91%잔여, 별도5시간없음, 사용자 지정×10=910%. 추천**Astra·Max**이며 모델설정을 변경했다고 주장하지 않는다. codex-exec-recovery 검증 경로인`/bin/bash`·login:false·명시workdir·승인검토를 재사용했다. Node24.18.0/pnpm11.14.0은 현재프로세스PATH에만`/home/onegem/.nvm/versions/node/v24.18.0/bin`을 추가한다.

Windows bundled Python/Pillow는 캡처의 픽셀 대조에만 사용했다. 이미지파일 편집/새생성·새설치/의존성은 없다. 같은P9-06 시각검수/앱연결이 남아**세션유지**. 다음 추천**Astra·Max** — 원래 구도와 움직이는 구름의 연결감을 함께 판단한다.
