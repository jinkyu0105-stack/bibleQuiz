# P8-02 제목·장절 자동 입력 보완

2026-10-03. 같은 P8-02의 관리자 직접 생성 검수에서 확인된 등록 자동 입력 누락이다. 구현·합성 브라우저/필수 전체 검사·운영 앱 **c6e396c0-44f8-4147-bc38-24e35cb8fdc0**100% 배포 완료, 사용자 자동 입력 확인 대기다. 별도 작업 번호·의존성·서비스·migration·AI 호출을 추가하지 않는다.

## 목표와 기존 구현 차이

사용자가 영상 제목·날짜·공개 한국어 자동 자막768구간/12,993자 조회 성공을 보고했다. 이어 장절 입력칸의 예시와 선택창 초기값을 실제 잘못 취득한 장절로 이해했다. 기존 코드는 원래 영상 제목 복사/설교일 추천과 직접 입력한 장절/선택창 동기화를 제공했으나 제목 정리·영상 제목 장절 추출이 없었다. 앞선 수동 수정 안내를 사용자가 자동화 목표와 맞지 않다고 지적해 범위를 바로잡았다. Preview의 조회/날짜 추천/수동 장절 동기화 구현 완료와 이 누락을 구분한다. 운영으로 옮기며 이 기능을 제거했다고 보고하지 않는다.

## 최종 동작

- 원래 영상 제목은 안내에 유지한다. 등록 제목은 실재 날짜 접두어, 구분자로 분리된 주일/수요/금요 예배 구분, 제목 끝의 단일 유효 장절을 분리해 입력한다. 지워져 빈 제목이 되면 원래 제목을 유지한다.
- 날짜 후보는 기존 함수를 원래 제목에 적용한다. 장절은 기존 파서의66권·실재 장/절·같은 장 연속 범위 검증으로 정규화하고 책/장/시작/끝절을 함께 채운다. AI로 장절이나 성경 본문을 만들지 않는다.
- 장절이 없거나 범위 오류·교차 장·복수 본문이면 추론하지 않고 직접 입력하는 경로를 유지한다. 다른 영상 조회 성공 뒤 이전 장절은 지운다. 미입력 책 선택은 ‘성경 책 선택’으로 표시하며 실제 값처럼 보이던 입력 예시는 안내로 바꾼다.
- 사람 확인 체크와 서버 저장 검증·중복 영상 무호출/덮어쓰기 금지는 유지한다. 원본 자막 저장과 AI 실행은 별도 사용자 버튼이다.

## 변경과 검사

기존 shared/sermon-registration의 helper와 검사, 등록 폼, 공개 영상 E2E 파일4개만 수정한다. 파서 단위12개, 데스크톱/모바일 실제브라우저 합성 등록 검사2개가 통과했다. 새 검사에서 dashboard mock 누락과 select label 선택자 문제를 수정했고 실제 자동 입력 렌더는 정상임을 확인했다. 첫 전체 검사는 정규식의 불필요 escape lint에 실패했고 교정했다. 최종 전체검사·배포 결과는 아래에 확정 기록한다. 기존 실제 입력/PDF·키/유료 결과를 재취득/재호출하지 않는다.

[명세](../../spec/generation.md#p5-66-공개-영상-정보자막-취득의-관리자-연결) · [현재 상태](../../STATUS.md) · [다음 동작](../../HANDOFF.md)

## 최종 검사·배포·보존

최종pnpm check exit0(unit308/Worker2154/Workflow4/복구CLI2/Node14/Python6·lint/typecheck/Drizzle/build), 마지막브라우저선택자교정후lint/typecheck각exit0. Production build·strict dry-run·후보모든binding확인·앱100% 배포가 통과했다. 소스657개중4개변경/653개동일·산출물73개 고정, 기본dist/deploypointer복구. 공개root/두난도API200·관리자Access302와 기대AUD를 확인했다. Secret명/vars/다른Worker/Preview/모든Cron, 기존 발행/참가1·제출2·call7·usage7·860448microUSD·migration39/FK0 보존이다. 새AI/agent실제영상/새migration/mainpush0. 기존 실자료·키·유료결과·의존성/lock·폰트/fontkit 패치를 보존했다.

비공개근거 `.wrangler/releases/p8-02-title-metadata-20261003`0700/0600, `/tmp/p802-metadata-*.log`와 검증JSON/manifest의automaticRegistrationRelease를 따른다. 다음은 영상 링크를 보관한 뒤 페이지새로고침하고 같은 영상 확인 버튼을눌러 자동 입력을확인하는 것이다. 아직 실제사용자 자동입력·등록·새자막영속저장·새유료생성은 통과로 쓰지 않는다. 같은P8-02/Phase8진행중·세션유지다.

## 자막 차단과 제목 조회 분리 — 2026-10-03

실제 운영 watch JSON이 challenge를 반환하면서 제목도 빠져 전체 등록 항목이 비었다. 미리보기에서 이 경우에만 YouTube 공개 oEmbed 제목을 한 번 읽고 기존 제목·날짜·장절 파서로 이어간다. 기존 제목이 있으면 호출하지 않으며 원본 import 경로도 바꾸지 않는다. oEmbed 실패 때는 원래 caption 진단을 유지한다. 3초/16KiB, redirect·쿠키·재시도 없음, Zod·UTF-8/제어문자 검증, HTML/작성자/썸네일은 반환하지 않는다. 새 키·서비스·의존성·migration·AI 호출은 없다.

Context7 `/websites/oembed`와 [oEmbed 규격](https://oembed.com/), [YouTube 등록 정보](https://github.com/iamcal/oembed/blob/master/providers/youtube.yml)를 대조했다. 실제 사용자 영상에 대한 로컬 WSL oEmbed GET 한 번은 HTTP200/1001bytes·기존 watch 제목 일치를 확인했다. 실제 자막 요청은 없으며 Cloudflare 결과로 확대하지 않는다.

자막 자동 취득은 여전히 미해결이다. 동일 player/client 재시도는 계속시키지 않는다. [공식 captions.download](https://developers.google.com/youtube/v3/docs/captions/download)는 영상 편집 OAuth 권한을 요구하고 현재 운영자는 그 권한이 없다. API 키만 추가하거나 제목 조회를 분리해도 자막은 해결되지 않는다. 기존 월0원 대안은 [YouTube 스크립트 표시](https://support.google.com/youtube/answer/15930243?hl=ko) 전문을 등록 후 직접 저장하는 것이다. 채널 권한을 받을 수 있다면 공식 OAuth 방식을 다시 검토할 수 있으나 현재 구현/승인으로 간주하지 않는다. 프록시·로그인 쿠키·다른 client 반복·상시 브라우저 서버·유료 외부 자막 서비스를 추가하지 않았다. 목표를 수동 입력으로 바꾸거나 P8-02를 완료 처리하지 않는다.

## 기본 정보 보완 적용·검사 결과

제목이 없는 자막 차단 미리보기에만 공개 oEmbed 제목을 보완해 자동 제목·설교일·장절 입력으로 이어가도록 수정했다. 운영 app **033e9ead-1e0c-4c37-b9e1-75e7b9cbdfbf**100%, 직전 **602bb937-ab11-413e-b037-c89936f8e9f0** 보존. 관련96개·최종 `pnpm check` exit0(unit308/Worker2168/Workflow4/복구CLI2/Node14/Python6·lint/typecheck/Drizzle/build)·데스크톱/모바일 Chromium의 새 차단 화면 검사2개·Production build/strict/후보binding·공개200/관리자302 통과. 초기 타입 오류는 Workers RequestInit/TextDecoder 옵션을 바로잡아 최종 통과했다. 소스657개 중4개변경/653개동일, 산출물73개, 기본dist/deploypointer복구. 모든vars/Secret명·content/backup/Preview/Cron과 발행/참가1/제출2/call7/usage7/860448microUSD/migration39/FK0을 보존했다. 이번 agent의 실제 자막 요청0·oEmbed 로컬조회1·새AI/새migration/mainpush0. 운영에서의 제목 보완 결과와 새 원본 저장/사용자 AI 생성은 아직 미확인이다. `.wrangler/releases/p8-02-metadata-fallback-20261003`와 검증JSON의metadataFallbackRelease가 근거다.

사용자가 “YouTube의 스크립트 표시를 복사해 저장하는 방법은 안 되나”라고 물어 기존 기능으로 가능하다고 설명했다. 새 작업 등록 후 `최초 입력자료 저장`의 자료 종류 `화면에서 복사한 YouTube 자막`, 범위 `전체 자막`, `입력자료 본문` → `최초 원본 저장` 순서다. 실제 저장·확정 후 기존 AI 흐름을 이어간다. 질문을 영구적인 자동화 목표 변경 승인이나 원본 저장 완료로 기록하지 않는다.

## 사용자 의도 정정

앞선 ‘스크립트 표시 복사’는 프로그램/AI가 실제 브라우저에서 자동으로 수행할 수 있는지 묻는 뜻이었다. 사용자 직접 복사 안내를 철회했다. 후속 실제 브라우저 실행에서269구간·12,792자 자동 읽기/파일 저장에 성공했다. [실증·원본·다음 연결](browser-transcript.md)을 따르며 위 수동 안내를 현재 다음 작업으로 사용하지 않는다.
