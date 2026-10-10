# 네 시간대 영상 자산

2026-10-09 · P9-06. 사용자가 제공한 네4K 영상을 독립 검토본에 연결했다. 모두3840×2160·24fps·영상10초다. 최초 무음4K는 영상 스트림을 복사했고2026-10-10 현재 밤v2만 사용자 승인으로4K 재압축본을 추가했다. 영상 생성/유료 호출은 수행하지 않았다.

| 시간대 | 제공 파일 | 무음4K | 모바일1080p | 원본/파생 해시·정확한 bytes·명령 |
|---|---|---|---|---|
| 새벽 | 12:30 제공 영상 | [18.34MiB](billowing/sky-dawn-4k.mp4) | [4.08MiB](billowing/sky-dawn-1080p.mp4) | [billowing/manifest.json](billowing/manifest.json) |
| 낮 | daytime.mp4 | [19.74MiB](day/sky-day-4k.mp4) | [4.39MiB](day/sky-day-1080p.mp4) | [day/manifest.json](day/manifest.json) |
| 노을 | sunset.mp4 | [16.05MiB](dusk/sky-dusk-4k.mp4) | [3.44MiB](dusk/sky-dusk-1080p.mp4) | [dusk/manifest.json](dusk/manifest.json) |
| 밤·현재v2 | Generated video 2.mp4 | [23.69MiB 압축본](night-v2/sky-night-4k-optimized.mp4) / [28.04MiB 보존본](night-v2/sky-night-4k.mp4) | [6.39MiB](night-v2/sky-night-1080p.mp4) | [night-v2/manifest.json](night-v2/manifest.json) |
| 밤·이전v1 | night.mp4 | [23.17MiB](night/sky-night-4k.mp4) | [5.42MiB](night/sky-night-1080p.mp4) | [night/manifest.json](night/manifest.json) |

- 새 밤v2 원본은 Git 제외 `.wrangler/design-references/p9-06-video/masters/sky-night-v2-4k-original.mp4`다. Downloads 파일과 전체 SHA-256이 같으며 둘 다 보존한다. 원본29,575,502bytes(28.21MiB), 무음4K29,403,913bytes(28.04MiB),1080p6,698,738bytes(6.39MiB)다. 기본/`night-video=v2`의 PC 재생은24,836,709bytes(23.69MiB) 압축본이며 `night-video=v2-original`로 재압축 전4K, `night-video=v1`로 이전 밤을 비교한다. 이전 밤 자산과 원본은 수정하지 않았다.
- 앞서 받은 세 원본은 Git 제외 `.wrangler/design-references/p9-06-video/masters/sky-day-4k-original.mp4`, `sky-dusk-4k-original.mp4`, `sky-night-4k-original.mp4`에 이름을 바꿔 복사했다. SHA-256이 Downloads 원본과 같고 Downloads 파일도 남겨 두었다. 원본 전체의 영상/소리를 보존한다.
- 선택 새벽 원본은 같은 masters의 `sky-dawn-billowing-4k-original.mp4`다. 원본19,423,541bytes=18.52MiB와 무음4K19,235,669bytes=18.34MiB를 구분한다. 최초 새벽 원본만 앞선 사용자 요청 당시 해시 대조 후 이동했으며 기록은 [최초 manifest](manifest.json)에 남아 있다.
- 최초 네 시간대와 이전 밤의4K 무음 보존본은 각각 원본과 영상 스트림 SHA-256이 같다. 현재 밤의 별도 `sky-night-4k-optimized.mp4`만 H.264 slow 2pass/20Mbps 목표로 재인코딩했다. 크기는15.53% 줄었고 전체240프레임SSIM0.995345,1/5/9초 캡처와5초 구름 디테일 비교를 확인했다. 손실 압축이며 SSIM을 체감 화질 보존율로 해석하지 않는다. 해상도·프레임·길이·색 메타데이터를 유지하고 색 재보정/업스케일은 하지 않았다. MP4 재생 정보를 앞에 두었다.1080p는 기존 libx264/CRF20 방식의 파생본이다.
- 각 폴더의 `sky-시간대-poster-4k.webp`와 `-poster-small.webp`는 해당 영상 첫 프레임이다. 로딩/재생 실패/움직임 감소에서 사용하며 마지막0.9초에는 각자의 첫 프레임을 겹쳐 반복 경계를 완화한다. 원본을 완벽한 루프 파일로 편집한 것은 아니다.
- 최초700px 이하는1080p, 넓은 화면은4K를 요청한다. 같은 영상에서 넓어지면4K로 올리고 다시 좁아졌다고 바꾸지 않는다. 선택 시간대의 공개 상단에서만 재생하며 다른 세 영상을 미리 요청하지 않는다.
- 새벽의 [이전 강한 움직임](dynamic/manifest.json)은 `video=dynamic`, [최초 잔잔한 영상](manifest.json)은 `video=calm`으로 보존한다. 기본은 `video=billowing`이며 낮/노을/밤 영상은 이 새벽 선택에 영향을 받지 않는다. `video=off`는 모든 시간대의 원래 사진/구름군 비교다.

[화면 사용법·비교](../../README.md#네-시간대-4k-영상) · [현재 연결 코드](../../sky-video.js). 보관 원본/로컬 검사 증거는 Git에서 제외하고 승인된 화면용 자산만 커밋한다.

배포 연결 때는25MiB 이하인 압축본을 선택한다.28.04MiB 비교 보존본은 이번 로컬 검토/복귀 자산이며 전체 docs 폴더를 배포 자산으로 복사하는 승인을 뜻하지 않는다. [Cloudflare static asset 한도](https://developers.cloudflare.com/workers/platform/limits/#static-assets) · [FFmpeg libx264](https://ffmpeg.org/ffmpeg-codecs.html#libx264_002c-libx264rgb).
