# P8-02 영상 조회 즉시 실패 복구

2026-10-03 현재: native fetch 오류와 제목·장절 추출은 수정됐지만 실제 Cloudflare watch/player challenge가 계속되어 **자막 자동 취득은 미해결**이다. 최신 기본 정보 분리와 기존 무료 대안은 [자동 등록 기록](automatic-registration.md#자막-차단과-제목-조회-분리--2026-10-03)을 따른다. 아래는 순서별 장애·수정 근거이며 각 과거 시점의 다음 동작을 현재 재시도 지시로 사용하지 않는다.

사용자는 비용 안내 뒤 “시작합시다”로 관리자 화면에서 직접 생성하는 검수를 시작했다. 같은 발행 영상을 넣은 첫 결과는 중복 안내였으며 제목 조회를 생략하고 날짜/장절 초기값을 유지하는 기존 동작이다. 다른 영상의 실제 조회는11:40:20.020Z에watch/network·elapsed0·HTTP없음/bytes0으로 실패했다. 영상 URL/원문/계정/키는 문서·로그에 기록하지 않는다.

## 원인과 수정

주입된 native fetch를 `options.fetcher(...)`로 호출해 무관한 객체가this가 되는 코드 오류다. 함수 참조를 지역변수로 분리해 독립 호출한다. 같은adapter의영상정보와자막import에적용되며응답schema·차단/timeout·자동재시도없음·쿠키없음·수동붙여넣기경로는유지했다. 앱만배포하며콘텐츠/백업/Preview설정·Secret·Cron은바꾸지않았다.

실제workerd native fetch와가짜data응답을사용한검사는수정전TRANSCRIPT_NETWORK_FAILED exit1/수정후제목조회·자막없음분류exit0이다. 최초data POST fixture의빈본문은테스트GET응답으로교정했고제품의YouTube POST는유지했다. 기존가짜함수검사가검출하지못했던native호출회귀를추가했다. Context7 /cloudflare/cloudflare-docs와 [Cloudflare 공식오류문서](https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors), [workerd native fetch receiver 재현](https://github.com/cloudflare/workerd/issues/6904)을대조했다.

## 검사·적용·보존

관련82개통과. 첫전체검사는새fixture의optional RequestInit타입에서만실패해test를정정했다. 최종pnpm check exit0(unit298/Worker2154/Workflow4/복구CLI2/Node14/Python6·lint/typecheck/Drizzle/build),Production build·strict dry-run·후보binding확인·app100%를완료했다. 소스657개중2개변경/655개동일·산출물73개고정,기본dist/deploypointer복구. 공개root/두난도API200·새관리자화면/영상조회API의Access302를확인했다. 참가1·제출2·provider7·usage7·860448microUSD·migration39/FK0불변이다. 새유료AI/agent실제YouTube/새migration/mainpush0,기존실제자료·키·유료결과·의존성/폰트/fontkit패치보존. 완료한입력/PDF는반복하지않았다.

비공개근거 `.wrangler/releases/p8-02-youtube-fetch-20261003`0700/0600과로그 `/tmp/p802-youtube-*.log`,검증JSON/manifest의videoFetchRecovery가정본이다. 사용자가 같은 버튼 재시도 후 제목·설교일과 공개 한국어 자동 자막768구간·12,993자를 확인했다. 게시일은 확인되지 않음으로 표시됐다. 이는 사용자 보고에 의한 영상 미리보기 성공이며 자막 원본 영속 저장·새 AI 생성 성공은 아직 아니다. 다음은 제목·장절 직접 입력 후 등록 확인이다. YouTube응답변경/원격차단이남을경우관측된안전진단을확인하고기존수동붙여넣기경로를사용하며새proxy/로그인/유료자막/재추출을임의추가하지않는다.

[현재상태](../../STATUS.md) · [재개](../../HANDOFF.md) · [P8-02](../P8-02.md)

## 사용자 영상 조회 성공과 등록 정보 확인

2026-10-03 사용자가 재시도 후 영상 제목·설교일과 공개 자동 자막768구간·12,993자 표시를 보고했다. 영상 URL·자막 원문은 기록하지 않는다. 성경 장절 입력칸의 요한복음3:16-18은 placeholder이고 실제 값은 빈 문자열이다. 선택 UI의창세기1:1은 초기값이며 video-preview는 장절 상태를 변경하지 않는다. 입력칸에 직접 유효 장절을 넣으면 기존changeReference가 책·장·시작/끝절을 동기화한다. 사람 확인 전 등록은 잠겨 있다. 실제 저장 오류나 AI가 잘못된 장절을 추론한 결과로 분류하지 않는다.

제목의 날짜/장절 분리는 결정론적 코드와 기존 장절 파서로 AI 없이 처리할 수 있지만 현재 자동 정리 기능은 없다. 그때 가능 여부 질문에는 현재 구현을 설명하고 수동 수정을 안내했다. 이후 사용자가 자동 입력이 구현 목표임을 재확인해 그 안내를 바로잡았고 [제목·장절 자동 입력](automatic-registration.md)을 같은 P8-02에서 보완한다. 이 앞선 상태 기록을 현재 자동 입력 구현 완료와 혼동하지 않는다.

## 실제 player 차단과 watch 응답 재사용 — 2026-10-03

자동 등록 배포 후 사용자가UTC12:42:54.633(한국시간21:42:54.633)의TRANSCRIPT_SOURCE_BLOCKED/player/challenge·HTTP200/json·7185bytes·전체906ms(watch701/player205)를 보고했다. 네트워크 호출 전 receiver 오류와 다른 실제 upstream 차단이다. 사용자 영상 주소를 받아 로컬WSL에서 공개watch GET을한번만수행했다. HTTP200/1223777bytes·embedded player 존재/요청영상일치/제목·게시일 존재/OK·track3/한국어1을 확인했다. 실제 player POST/자막 timed-text/AI호출은0이고 원문/HTML/track URL/쿠키를 보관하지 않았다. 이는 로컬 관측이며 Cloudflare 성공 증거와 구분한다. 실제 주소·제목은 Git 문서에 넣지 않는다.

기존 provider는 watch의초기player JSON을읽지않고별도player POST를항상수행했다. 같은watch 응답에제공된JSON을먼저기존schema로검증해추가요청을줄인다. script실행은없고문자열/escape/중첩괄호를고려해JSON객체범위만파싱한다. 초기JSON이없을때만기존POST호환경로를쓰며차단/오류뒤client전환·재시도·쿠키/로그인을추가하지않는다. 요청영상과일치하는최소제목/게시일은차단분류전보존해장절자동입력이자막차단에묶이지않게한다. 공개응답·안전진단·원본저장/사람확정계약은유지한다.

이전미리보기의자막768구간/12,993자는서버가영속저장하지않는기존계약이므로회수가능한원본으로보고하지않는다. 등록후원본저장경로를이어가며새cache/table/서비스를임의추가하지않았다. 공식captions.download는영상편집권한/OAuth가필요하고현운영자는채널관리권한이없다는기준을유지한다. Context7 /websites/developers_google_youtube_v3와 [공식다운로드권한](https://developers.google.com/youtube/v3/docs/captions/download), [공식스크립트보기](https://support.google.com/youtube/answer/15930243?hl=ko)를대조했다. 공식APIkey추가만으로자막권한을얻었다고보고하지않는다. Cloudflare에서계속차단되면현존수동붙여넣기fallback을사용하고원본을보존한다.

관련Worker87개(새watch재사용/차단중지/잘못된영상/불완전JSON/비실행/메타데이터보존 포함)통과. 필수전체검사·배포·운영사용자확인 결과는현재STATUS/HANDOFF와watchPlayerRecovery JSON을따른다.

## watch JSON 재사용 배포·필수검사 확정

운영 app **602bb937-ab11-413e-b037-c89936f8e9f0**100% 적용, 직전 **c6e396c0-44f8-4147-bc38-24e35cb8fdc0** 보존. 최종pnpm check exit0(unit308/Worker2159/Workflow4/복구CLI2/Node14/Python6·lint/typecheck/Drizzle/build)·관련87·Production build/strict·후보binding확인·앱100%·공개200/관리자302 통과. 소스657개중2개변경/655개동일·artifact73 고정·기본dist/deploypointer복구. 모든vars/Secret명·content/backup/Preview/예약과 기존발행/참가1/제출2/call7/usage7/860448microUSD/migration39/FK0을보존했다. 새AI/자막timed-text/원격migration/mainpush0이며agent실제영상GET1은위로컬관측뿐이다. 비공개근거 `.wrangler/releases/p8-02-watch-player-20261003`0700/0600·`/tmp/p802-watch-*.log`·검증JSON/manifest의watchPlayerRecovery를따른다. 다음은새로고침없이같은영상확인버튼을한번눌러Cloudflare결과를확인하는것이다. 실제Cloudflare성공/새원본저장/새AI는미확인이다.

## 최신 운영 결과 — 실제 watch 내 player challenge / 2026-10-03

사용자는수정배포후에도등록항목이채워지지않는다고보고했다. 최신진단UTC14:00:46.127/한국시간23:00:46.127·TRANSCRIPT_SOURCE_BLOCKED/player/challenge·HTTP200/html1170293bytes·전체824ms/watch824/player0이다. 현재앱602bb937-ab11-413e-b037-c89936f8e9f0 100%를읽기로재확인했다. 이코드/진단조합은이미받은watch JSON에서challenge를만나추가POST없이중지한경로다. 두번허용/세번째금지같은프로그램규칙을뜻하지않고attempt1은이번동작의시도기록이다. 현재Cloudflare자동자막취득은검수실패/미해결이며로컬성공으로완료처리하지않는다.

동일접근을반복해사용자에게재시도를요구하지않는다. 현재자료입력경로를재검토해야하고기존직접붙여넣기는보존한다. 공식captions API는영상편집권한/OAuth가필요하고현사용자의채널관리권한없음경계는변하지않았다. 새외부서비스·proxy/로그인쿠키·client전환·유료호출을추가하거나질문을변경승인으로해석하지않는다. 이 turn은설명·읽기확인·문서만이며소스/배포/영상재조회/AI호출0이다. Cloudflare읽기인증401은Wrangler읽기전용R2목록의기존자동갱신후같은읽기를완료했고사용자재로그인을요구하지않았다.
