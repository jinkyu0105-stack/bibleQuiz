# 네 시간대 영상 자산

2026-10-09 · P9-06. 사용자가 제공한 네4K 영상을 독립 검토본에 연결했다. 모두3840×2160·24fps·영상10초이며 원본에 포함된 소리만 재생본에서 제외한다. 영상 생성/유료 호출은 수행하지 않았다.

| 시간대 | 제공 파일 | 무음4K | 모바일1080p | 원본/파생 해시·정확한 bytes·명령 |
|---|---|---|---|---|
| 새벽 | 12:30 제공 영상 | [18.34MiB](billowing/sky-dawn-4k.mp4) | [4.08MiB](billowing/sky-dawn-1080p.mp4) | [billowing/manifest.json](billowing/manifest.json) |
| 낮 | daytime.mp4 | [19.74MiB](day/sky-day-4k.mp4) | [4.39MiB](day/sky-day-1080p.mp4) | [day/manifest.json](day/manifest.json) |
| 노을 | sunset.mp4 | [16.05MiB](dusk/sky-dusk-4k.mp4) | [3.44MiB](dusk/sky-dusk-1080p.mp4) | [dusk/manifest.json](dusk/manifest.json) |
| 밤 | night.mp4 | [23.17MiB](night/sky-night-4k.mp4) | [5.42MiB](night/sky-night-1080p.mp4) | [night/manifest.json](night/manifest.json) |

- 새 세 원본은 Git 제외 `.wrangler/design-references/p9-06-video/masters/sky-day-4k-original.mp4`, `sky-dusk-4k-original.mp4`, `sky-night-4k-original.mp4`에 이름을 바꿔 복사했다. SHA-256이 Downloads 원본과 같고 Downloads 파일도 남겨 두었다. 원본 전체의 영상/소리를 보존한다.
- 선택 새벽 원본은 같은 masters의 `sky-dawn-billowing-4k-original.mp4`다. 원본19,423,541bytes=18.52MiB와 무음4K19,235,669bytes=18.34MiB를 구분한다. 최초 새벽 원본만 앞선 사용자 요청 당시 해시 대조 후 이동했으며 기록은 [최초 manifest](manifest.json)에 남아 있다.
- 네4K 재생본은 영상 스트림 SHA-256이 각각의 원본과 같으며 재인코딩/색 재보정/업스케일을 하지 않았다. MP4 재생 정보를 앞에 두었다.1080p는 기존 libx264/CRF20 방식의 파생본이다.
- 각 폴더의 `sky-시간대-poster-4k.webp`와 `-poster-small.webp`는 해당 영상 첫 프레임이다. 로딩/재생 실패/움직임 감소에서 사용하며 마지막0.9초에는 각자의 첫 프레임을 겹쳐 반복 경계를 완화한다. 원본을 완벽한 루프 파일로 편집한 것은 아니다.
- 최초700px 이하는1080p, 넓은 화면은4K를 요청한다. 같은 영상에서 넓어지면4K로 올리고 다시 좁아졌다고 바꾸지 않는다. 선택 시간대의 공개 상단에서만 재생하며 다른 세 영상을 미리 요청하지 않는다.
- 새벽의 [이전 강한 움직임](dynamic/manifest.json)은 `video=dynamic`, [최초 잔잔한 영상](manifest.json)은 `video=calm`으로 보존한다. 기본은 `video=billowing`이며 낮/노을/밤 영상은 이 새벽 선택에 영향을 받지 않는다. `video=off`는 모든 시간대의 원래 사진/구름군 비교다.

[화면 사용법·비교](../../README.md#네-시간대-4k-영상) · [현재 연결 코드](../../sky-video.js). 보관 원본/로컬 검사 증거는 Git에서 제외하고 승인된 화면용 자산만 커밋한다.
