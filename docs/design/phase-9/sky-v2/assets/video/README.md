# 새벽 영상 자산

현재 기본은 [dynamic/manifest.json](dynamic/manifest.json)의 움직임이 많은 새벽 영상이다. 기존 이 폴더의 영상은 `video=calm`으로 비교한다. 새 원본은 `.wrangler/design-references/p9-06-video/masters/sky-dawn-dynamic-4k-original.mp4`에 해시를 대조해 복사했고 Downloads 파일도 유지했다. 아래 수치/이동 기록은 최초 잔잔한 영상이다.

2026-10-09 · P9-06. 사용자가 제공한4K 원본에서 만든 독립 검토본의 재생 자산이다. [해시·미디어 정보·변환 명령](manifest.json)에 원본과 파생 파일을 구분했다.

- 원본은 저장소의 Git 제외 `.wrangler/design-references/p9-06-video/masters/sky-dawn-4k-original.mp4`에 이름을 바꿔 이동했다. 복사/쓰기 완료 후 SHA-256을 대조하고 요청받은 Downloads 파일만 제거했다. 원본의 영상·소리를 모두 보존했다.
- [4K 재생본](sky-dawn-4k.mp4)은3840×2160·24fps·10초·12.52MB다. 영상 스트림은 원본과 동일하며 소리만 제외하고 MP4의 재생 정보를 앞에 두었다. 색과 화질을 다시 인코딩하지 않았다.
- [작은 화면용](sky-dawn-1080p.mp4)은1920×1080·3.06MB다. 가로700px 이하에서 이 파일을 선택한다. 한 번 넓어지면4K로 올리고 다시 좁아졌다고 재다운로드하지 않는다.
- 첫 장면의 [4K 정지 이미지](sky-dawn-poster-4k.webp)와 [작은 정지 이미지](sky-dawn-poster-small.webp)는 로딩·재생 불가·움직임 감소에 사용한다.
- 원본은 마지막과 첫 구름 모양이 다르다. 끝0.9초 동안 첫 장면을 부드럽게 겹친 뒤 반복한다. 화면 합성일 뿐 MP4 자체가 완벽한 루프 파일로 편집된 것은 아니다.

[화면 사용법·비교](../../README.md#새벽-4k-영상) · [현재 연결 코드](../../sky-video.js). 원본을 재생성하거나 유료 서비스를 다시 호출하지 않는다. 다운로드/보관용 원본은 Git에 넣지 않고 승인된 화면용 자산만 커밋한다.
