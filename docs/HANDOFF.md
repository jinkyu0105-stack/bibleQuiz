# 다음 작업 인수인계

## 현재 작업과 다음 첫 행동

2026-10-09. **P9-06 진행 중 — 12:30 새벽 영상 교체, 사용자 비교 대기**. 사용자의12:30 생성 파일을 새벽 기본으로 연결했다. [새 영상](http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass&time=dawn)과 [이전 잔잔한 영상](http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass&time=dawn&video=calm)을 비교한다. [11:50 강한 움직임](http://localhost:4189/docs/design/phase-9/sky-v2/?ground=grass&time=dawn&video=dynamic)도 보존한다. 최신 명시 선택은 `video=billowing`, `video=off`는 기존 사진이다. 다음은 사용자 시각 보정/나머지 영상 수령이며 같은P9-06을 유지한다. 부모 전체 UI 개편은 진행 중, 기존P9-04 운영/Phase9 승인 범위 완료는 유지한다.

## 이번 변경과 보존

`sky-video.js`의 기본 디렉토리를 `assets/video/billowing/`으로 선택하고 `review.js`가 `video=calm/dynamic/billowing`을 화면 이동에도 보존한다. 새 무음4K·1080p·첫 프레임WebP2종과 manifest를 추가했다.3840×2160·24fps·10초,4K19.24MB/1080p4.28MB다.4K 영상 스트림은 원본과 동일하다. 기존 재생 제어·끝0.9초 합성·구름/산/잔디/유리/1440px를 유지한다.

새 원본은 Git 제외 `.wrangler/design-references/p9-06-video/masters/sky-dawn-billowing-4k-original.mp4`로 해시를 확인해 복사했으며 Downloads 파일도 남아 있다. 이전 보관 원본과 재생 자산도 그대로다. [해시·제작 명령](design/phase-9/sky-v2/assets/video/billowing/manifest.json) · [사용법](design/phase-9/sky-v2/README.md#새벽-4k-영상) · [이번 검사](work/P9-06.md#구름-생성과-소멸-버전-비교--2026-10-09).

## 검사와 남은 범위

Chromium PC2560px4K·모바일390px1080p 재생, 이전 두 영상 비교/이동, OS 감소의 MP4 요청0/정지 이미지, 멈춤, 합성과 실제 반복 통과. 다섯 시나리오 runtime0·넘침 없음. lint/typecheck·git diff --check·기존/새 영상 파일 해시 대조 통과. 근거/스크립트/캡처는 `.wrangler/design-references/p9-06-video-billowing/`다. 기존99개 대비 표본/Firefox 결과는 이전 영상의 검사이며 이번 결과로 재사용하지 않는다. Safari/WebKit은 이전 host 라이브러리 부재 한계, 실제 기기/GPU/배터리·새 영상의 반복 자연스러움은 남는다. 출시 검사/유료 호출은 반복하지 않았다.

초기 검사의 클릭 직후 정지 assertion은 다음 프레임 반영을 기다리도록 수정한 뒤 통과했다. 현재 로컬 서버는 실행 중이다. 서버가 없을 때만 실행한다.

```sh
python3 -m http.server 4189 --bind 127.0.0.1 --directory /home/onegem/work/bibleQuiz
```

## Git과 배포

시작 HEAD **2fff259**, main clean, origin/main **21b81de**보다14커밋 앞섬. 이번 교체·자산·문서를 로컬 커밋하면 미푸시15커밋이다. 정확한 종료 HEAD/clean은 최종 Git 기록을 따른다. 기존 자산/실제 자료/키/유료 결과·0000~0038·폰트/fontkit·package/lockfile/Worker 설정을 보존했다. push/배포 없음.

| 대상 | 유지하는 version/소스 |
|---|---|
| Production app |7aea6843-5288-42da-9bef-bc673e1d9dfe / 소스37b7254, 직전27f75159-4019-4afc-b871-048e4e9d15f7|
| Production content |48a1269d-a9b2-4405-8bbc-745cdabec1b0 / 기존56bb1bf|
| Production backup |3fb0e7c7-368b-45a9-89f9-2818739e415d / 기존 배포|
| Preview app |3dc36ff6-f6d0-4627-bc43-6beeb3495391 / GitHub21b81de 자동 배포|
| Preview content |2df93f07-3703-42ec-b576-fd085e8c839f / 기존 배포|

Preview는 main push 자동 경로, Production은 별도 요청이다. [P9-04](work/P9-04.md)의 운영/rollback 근거를 유지한다.

## 실행·사용량·세션

시작 순서는 AGENTS→PROJECT_CONTEXT→DECISIONS→STATUS→HANDOFF→implementation 관련 spec/work→Git이다. 시작 Pro15% 사용/85% 잔여, 별도5시간 없음, 사용자 지정×10=850%. 세션 유지, 다음 추천 **Astra·Max** — 새벽 세 영상의 움직임과 색감을 비교/보정한다.

검증된 shell은 `/bin/bash`·login:false·명시 workdir·승인 검토 경로다. Node24.18.0/pnpm11.14.0의 PATH는 프로세스에 `/home/onegem/.nvm/versions/node/v24.18.0/bin`을 추가한다. FFmpeg/ffprobe6.1.1은 기존 `/usr/bin` 설치를 쓴다. 실행 시작 오류에는 codex-exec-recovery를 적용하며 같은 실패 경로를 반복하지 않는다. Windows computer-use의 과거 `sandboxCwd is not a local file URI` 한계와 WebKit host 라이브러리 부재를 저장소 단절로 해석하지 않는다.
