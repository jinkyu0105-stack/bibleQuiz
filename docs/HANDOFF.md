# 인계 — P9-06 먼 산 사진 보정, 사용자 검수 대기

## 현재와 다음 한 작업

2026-10-08 사용자는 새 하늘과 OriginKit 잔디/마우스 반응에 만족하며 **먼 곳에 일반 사진으로 산을 추가**하도록 요청했다. 잔디는 채택됐고 사진 산 원경을 추가했다. **현재P9-06은 산의 시각 보정 검수 대기, 부모 전체 UI 개편은 진행 중**이다. 다음 첫 작업은 같은 P9-06의 산 높이/빛 확인·필요 보정이다. 대표 시안 확정 뒤 기존 앱 연결과 실제 기능 검사를 이어간다. 새 번호/배포 단계로 넘어가지 않는다. P9-04와 이전 Phase9 승인 범위 완료는 유지한다.

[작업/검사 근거](work/P9-06.md) · [현재 디자인](spec/design.md) · [산 사진 출처/복귀](design/phase-9/sky-v2/ORIGINKIT.md#먼-산-사진--2026-10-08).

## 직접 볼 화면과 복귀

- 산+잔디: **`http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass&time=dawn#ground-controls`**
- 산 없는 이전 잔디: **`http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass&mountains=off&time=dawn#ground-controls`**
- 하단 **기존 사진 / 움직이는 잔디** 버튼도 유지한다. 매개변수 없는 기존 주소는 원래 사진이 기본이다. 시간대·구름/잔디 공통 멈춤은 그대로다. 검토본 URL만 사용하며 앱 저장 설정은 바꾸지 않는다.

산은 별도 사진 층이므로 `mountains=off`로 즉시 제외하며 해당 자산도 요청하지 않는다. 코드까지 복귀할 때는 이번 산만 담은 커밋을 확인해 revert한다. 산 추가 전 기준은 **aafcf08**, 잔디 추가 전 기준은8d5752b다. 파괴적 reset/이미지 삭제가 필요 없다.

loopback4189 정적 서버 응답200을 확인해 재사용했다. 없을 때만 다음 명령으로 실행한다.

```sh
python3 -m http.server 4189 --bind 127.0.0.1 --directory /home/onegem/work/bibleQuiz
```

현재 수정 위치는 `docs/design/phase-9/sky-v2/`다. 풀이/관리자는 예시 입력·메모리 편집이며 실제 자료/AI/저장/발행과 연결하지 않는다. 시작 순서는 AGENTS→PROJECT_CONTEXT→DECISIONS→STATUS→HANDOFF→implementation 관련spec/work→Git status/diff/log다.

## 변경·검사·한계

- 새 `assets/mountains.webp`는 Le Mucky의 실제 촬영 사진이다. Unsplash 개별 페이지와 공식 사용 조건을 확인하고 로컬107,914bytes/1600×900으로 저장했다. AI 생성/bitmap 보정 없음. 정확한 URL·해시는 assets.json의 photographs에 있다. 산 사진의 CSS crop/mask/밝기/시간대 tint만 추가했다.
- index의 장식 사진 층, world의 지면 접근 시1회 로딩/진행도 연결/오류 시 숨김, style의 네 시간대·모바일·감소 설정, review의 비교용 mountains=off를 변경했다. `originkit-grass.js`와 기존 이미지/폰트는 변경하지 않았다. 새 패키지/서비스 없음.
- Chromium: 첫 화면 요청0→지면1회 로딩, 네 시간대 PC/390px 새벽 캡처 직접 확인, 잔디 마우스/멈춤 유지, 사진/잔디 전환 재요청 없음, OS 감소 transition0초,320/390/768/1440px 넘침 없음, 산 끄기 요청0, 산 파일 실패에도 잔디/하늘 유지, runtime error0·외부 요청0. Firefox390px 밤 산/잔디 표시·넘침 없음.
- JS 구문·`pnpm run lint`·`pnpm run typecheck` 통과. diff/문서 로컬 링크·자산 해시·기존 코드 보존 확인도 통과했다. 검증된 변경만 로컬 커밋한다. 기존 출시 검사/전체pnpm check/E2E/Lighthouse·유료 호출은 반복하지 않았다. 기존 사진 시안 Lighthouse99/91을 산/잔디의 점수로 사용하지 않는다.
- 실제 휴대폰 GPU/FPS/배터리/IME·Windows/macOS 폴백·WebKit 시스템 라이브러리 한계는 남아 있다. 기존 hidden-tab 검증은 모의 visibility이며 이번 산 사진은 별도 애니메이션 루프가 없다.
- 미채택 절벽/일출 사진은 원경 구도에 맞지 않아 작업 폴더에만 남겼다. 밤의 첫 중성 회색/갈색 느낌은 청색 조명에 맞춰 보정했다. 증거는 Git 제외 `.wrangler/design-references/p9-06-mountains/verification.json`과 네 시간대/모바일PNG다. 앞선 OriginKit 검사는 work문서와 p9-06-originkit/verified-*에 보존한다.

## Git·배포·보존

시작 HEAD **aafcf08**, main/worktree clean, origin/main21b81de보다6커밋 앞섬. 이번 산/관련 문서를 독립 로컬 커밋한다. 해당 커밋의 부모는aafcf08이며 정확한 종료 HEAD/clean/미푸시 수는 최종 Git log/status를 따른다. push하지 않는다. 직전 실제 GitHub main 조회21b81de를 재사용하며 원격 배포 상태를 재검수하지 않았다.

| 대상 | 유지하는 version/소스 |
|---|---|
| Production app |7aea6843-5288-42da-9bef-bc673e1d9dfe / 소스37b7254, 직전27f75159-4019-4afc-b871-048e4e9d15f7|
| Production content |48a1269d-a9b2-4405-8bbc-745cdabec1b0 / 기존56bb1bf|
| Production backup |3fb0e7c7-368b-45a9-89f9-2818739e415d / 기존 배포|
| Preview app |3dc36ff6-f6d0-4627-bc43-6beeb3495391 / GitHub21b81de 자동 배포|
| Preview content |2df93f07-3703-42ec-b576-fd085e8c839f / 기존 배포|

배포 버전은 기존 기록을 재사용했다. Cloudflare 원격 재검수/배포/migration/Secret/실제AI를 실행하지 않았다. 일반 Preview는 main push 자동 배포만, Production은 별도 사용자 요청이다.0000~0038·실제 자료/키/유료 결과·celebration/garden-v1/garden-v2·출력 TTF/fontkit 패치를 보존한다. `src/public`·Worker/설정/SQL/package/lockfile 변경 없음. 이전 CI/운영 검사·LCP5.4초·기기/관측 한계와 rollback은 [P9-04](work/P9-04.md)에 유지한다.

`pnpm dev`는 영속 합성 `.wrangler/ui-demo-state/`, 실제 로컬은 `pnpm dev:local`, E2E는 임시DB 격리다. 이번 정적 검토본과 혼동하지 않는다.

## 실행·사용량·세션

시작 Pro7% 사용/93% 잔여, 별도5시간 없음, 사용자 지정×10=930%. 추천 **Astra·Max**, 모델 설정을 도구로 변경했다고 주장하지 않는다. 기존 `codex-exec-recovery`의 검증된 `/bin/bash`·login:false·명시workdir·승인 검토 경로를 재사용했다. node/pnpm은 현재 프로세스 PATH에만 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 추가한다. Node24.18.0/pnpm11.14.0. 웹 도구의 이미지 fetch cache miss는 구현용 원본 CDN 다운로드로 정상 수신했고 사진을 직접 확인했다.

같은 P9-06 시각 보정/앱 연결이 남으므로 **세션 유지**. 다음 추천 **Astra·Max** — 하늘·산·잔디의 원근과 빛을 함께 판단해야 한다.
