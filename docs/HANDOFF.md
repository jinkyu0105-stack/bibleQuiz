# 다음 작업 인수인계

## 현재 작업과 다음 첫 행동

2026-10-09. **P9-06 진행 중 —12:30 새벽 영상/프롬프트 선택, 네 시간대 전달 자료 갱신 완료**. 사용자가 현재 새벽 영상에 만족하며 제공한 프롬프트를 정본으로 저장하고 낮·노을·밤에 맞춰 달라고 요청했다. 다음은 사용자가 생성한 나머지 영상 수령/색·반복 확인/같은 검토본 연결이다. 새벽을 다시 선택하라고 묻지 않는다. 부모 전체 UI 개편은 진행 중이며 실제 앱/운영 연결은 아직이다. 기존P9-04와 Phase9 승인 범위 완료는 유지한다.

[프롬프트 복사/다운로드](http://localhost:4189/docs/design/phase-9/video-kit/) · [선택 새벽 영상](http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass&time=dawn&video=billowing). `video=dynamic`은11:50, `video=calm`은최초, `video=off`는사진 비교로 보존한다.

## 정본과 이번 변경

`docs/design/phase-9/video-kit/prompts/dawn.txt`는 사용자 제공 원문 그대로다. 나머지 TXT3개는 동일한 움직임5/10·구름 내부 부풀음/소멸·느린 카메라/닫힌 반복 경로를 유지하고 시간대 색·빛·달/별만 조정한다. HTML textarea/복사/TXT와 manifest의 `promptRevision: billowing-v2`/SHA-256을 동기화했다. PNG4장은 보존했다. 기존 고정 카메라 안내를 제거하고 옛8초 API/단가 기록과 현재10초 결과를 구분했다. API/생성 비용을 새로 조회하거나 호출하지 않았다.

선택 원본은 `.wrangler/design-references/p9-06-video/masters/sky-dawn-billowing-4k-original.mp4`,3840×2160·24fps·영상10초·19,423,541bytes =18.52MiB다. 무음4K 재생본은 `sky-v2/assets/video/billowing/sky-dawn-4k.mp4`,19,235,669bytes =18.34MiB이며 영상 스트림은 원본과 같다. 모바일700px 이하는1080p다. 원본/재생본 해시와 ffprobe/stat을 재확인했으며 이번에 미디어를 변경하지 않았다. [상세 사용법](design/phase-9/video-kit/README.md) · [구현/검사](work/P9-06.md#선택-프롬프트-네-시간대-갱신--2026-10-09).

## 검사와 한계

Chromium37항목 통과: 네 PNG 해시/다운로드, 네 완성 프롬프트 복사/TXT/manifest 해시 일치,320/1440/2560px 넘침 없음, 로컬 링크, 기존 master2장/원래CSS 보존, runtime0. 공통 움직임 절 동일성도 확인했다. 근거/스크립트/캡처는 `.wrangler/design-references/p9-06-prompts-v2/`다. 문서/정적 내용만 바꿔 lint/typecheck/출시 검사/영상 재생 회귀는 반복하지 않았다. 새벽의 사용자 선택과 나머지 영상 미검증을 구분한다. Safari/실기기·앱 연결은 남는다.

초기 검사는4189 서버 종료로 연결 거부였고 아래 명령으로 재실행 후 통과했다. 서버가 없을 때만 실행한다.

```sh
python3 -m http.server 4189 --bind 127.0.0.1 --directory /home/onegem/work/bibleQuiz
```

## Git과 배포

시작 HEAD **6853adb**, main clean, origin/main **21b81de**보다15커밋 앞섬. 이번 전달 자료/문서를 로컬 커밋하면 미푸시16커밋이다. 정확한 종료 HEAD/clean은 최종 Git 기록을 따른다. 원본/재생 자산·실제 자료/키/유료 결과·0000~0038·폰트/fontkit·package/lockfile/Worker 설정을 보존했다. push/배포 없음.

| 대상 | 유지하는 version/소스 |
|---|---|
| Production app |7aea6843-5288-42da-9bef-bc673e1d9dfe / 소스37b7254, 직전27f75159-4019-4afc-b871-048e4e9d15f7|
| Production content |48a1269d-a9b2-4405-8bbc-745cdabec1b0 / 기존56bb1bf|
| Production backup |3fb0e7c7-368b-45a9-89f9-2818739e415d / 기존 배포|
| Preview app |3dc36ff6-f6d0-4627-bc43-6beeb3495391 / GitHub21b81de 자동 배포|
| Preview content |2df93f07-3703-42ec-b576-fd085e8c839f / 기존 배포|

Preview는 main push 자동 경로, Production은 별도 요청이다. [P9-04](work/P9-04.md)의 운영/rollback 근거를 유지한다.

## 실행·사용량·세션

시작 순서는 AGENTS→PROJECT_CONTEXT→DECISIONS→STATUS→HANDOFF→implementation 관련 spec/work→Git이다. 시작 Pro16% 사용/84% 잔여, 별도5시간 없음, 사용자 지정×10=840%. 세션 유지, 다음 추천 **Astra·Max** — 나머지 시간대 영상의 색과 움직임을 확인해 연결한다.

검증된 shell은 `/bin/bash`·login:false·명시 workdir·승인 검토 경로다. Node24.18.0/pnpm11.14.0의 PATH는 프로세스에 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 추가한다. FFmpeg/ffprobe6.1.1은 기존 `/usr/bin` 설치를 쓴다. 실행 시작 오류에는 codex-exec-recovery를 적용하며 같은 실패 경로를 반복하지 않는다. Windows computer-use의 과거 `sandboxCwd is not a local file URI` 한계와 WebKit host 라이브러리 부재를 저장소 단절로 해석하지 않는다.
