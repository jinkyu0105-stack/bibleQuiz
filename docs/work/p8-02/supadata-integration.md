# P8-02 운영 자막 연결 — 배포 검토 묶음

2026-10-04. 무료 Cloudflare 시험 성공 뒤 사용자의 다음 작업 요청으로 운영 앱의 조회·원본 저장 연결을 구현했다. 사용자가 구체적 묶음 설명 뒤 “진행하세요 그리고 두 서버가 어디어딘지 알려주세요”로 운영 적용을 승인했다. **content→app 배포·Secret 연결·공개/보호/자료 보존 확인까지 완료했고 관리자 조회·원본 저장 검수는 대기 중이다.** P8-02/Phase8은 진행 중이다. [앞선 실제 시험](transcript-comparison.md#cloudflare-무료-시험-성공)은 그대로 재사용한다.

## 사용자가 확인할 동작

새 설교 화면에서 기존 영상 확인 버튼을 누르면 제목·날짜·장절 자동 입력은 유지하면서 한국어 공개 자막을 Supadata로 조회한다. 설교 등록 후 기존 원본 저장 버튼이 같은 공급자를 사용해 시간 구간과 원문을 불변 저장한다. 저장된 원본이 있거나 이미 등록된 영상이면 기존 중복 처리로 추가 조회를 막는다. 조회와 최초 원본 저장은 각각 한 요청이며 보관 후 재방문은 재취득하지 않는다.

`PUBLIC_TRANSCRIPT_PROVIDER=supadata`인 운영 앱만 `SUPADATA_API_KEY` Secret을 사용한다. 기본/Preview는 기존 공급자를 유지한다. 알 수 없는 설정이나 키 누락은 실패로 반환하고 다른 공급자·AI로 자동 전환하지 않는다. API 키는 브라우저나 공개 API에 전달하지 않는다. oEmbed 공개 제목 조회는 자막과 독립적으로 수행하고 기존 제목 파서로 날짜·장절을 채운다.

Supadata는 canonical YouTube 주소, `mode=native`, `lang=ko`, `text=false`로만 요청한다. 실제 응답과 모든 구간의 한국어 여부, 시간 순서, 응답 1MiB, 기존 3만 자 제한을 검사한다. `202`는 같은 job만 1초 간격으로 전체 30초 이내 조회하며 새 요청/자동 재시도를 만들지 않는다. HTTP 오류·리다이렉트·한도·시간 초과는 안전한 진단만 반환한다. 원문/키/upstream 오류 문자열은 진단에서 제외한다. 공급자가 수동/자동 자막 여부를 제공하지 않으므로 `generated=null`, 공급자 식별자 `supadata-native`와 내부 track 표식 `supadata-ko`를 저장한다. 이 표식은 YouTube의 실제 track ID라는 뜻이 아니다. 화면에서는 수동 자막이라고 추정하지 않는다.

## 대상과 적용 순서

1. 검사한 소스 커밋과 두 Worker의 빌드 지문을 고정한다. 배포 전 기준 앱 `ad9ebbf0-be59-4941-af42-ea063e97f984`, content `95fbc7a6-95f5-4bcc-a85b-30dad3a59e56`. 적용 직전 동일함을 확인했다.
2. 비공개 `biblequiz-content`에 새 출처 읽기 호환 코드 후보를 올리고, 기존 모델·AI flag·OpenAI Secret·D1/Workflow binding·비공개 주소 상태를 대조한 후 100% 적용한다. 이 단계 자체는 AI를 호출하지 않는다.
3. 운영 앱 `biblequiz-app`의 검사한 빌드와 `PUBLIC_TRANSCRIPT_PROVIDER=supadata`를 후보로만 올린다. 최신 후보가 방금 올린 소스/빌드와 일치하는지 확인한다. 기존 운영 traffic은 그대로 둔다.
4. 이미 보관한 Supadata 키를 프로그램의 표준입력으로 `wrangler versions secret put SUPADATA_API_KEY`에 전달해 방금 후보를 복제한 Secret 포함 후보를 만든다. 자동 배포하는 `secret put`은 사용하지 않는다. 코드 지문·Secret 이름·기존 binding·D1/Access/DO/cron 보존을 다시 대조한 후 이 최종 후보를100% 적용한다. 키는 앱에만 두며 content/backup/Preview에는 주지 않는다. 공개 접속과 관리자 보호를 읽기 확인한다.
5. 사용자 관리자 버튼으로 영상 확인 1회와 최초 원본 저장 1회를 확인한다. 기존 성공 시험은 반복하지 않는다. **검수 상한은 native 2크레딧**, 승인된 Free 잔여99에서 최대2를 사용하며 AI 생성·유료 전환·충전은 제외한다. 이미 저장돼 있으면 재취득하지 않는다. 새 설교의 AI 생성 검수는 기존 별도 사용자 단계로 유지한다.

migration 없음(0000~0038 보존), main push 없음, Preview/backup 변경 없음. 이 묶음의 구체적 후속 승인으로 원격 변경을 실행했다. 무료 시험만으로 승인 범위를 확장하지 않았다.

## 복귀와 한계

Supadata 원본이 저장되면 과거 앱/content는 새 공급자 식별자를 읽지 못한다. 따라서 **새 원본 저장 후 과거 Worker 버전으로 무조건 되돌리지 않는다.** 새 출처를 읽는 호환 코드는 유지하고 앱의 `PUBLIC_TRANSCRIPT_PROVIDER=accountless`로만 전환한 후보를 대조/배포한다. 제목 조회·기존 자료 읽기는 유지하지만 기존 직접 자막 경로는 YouTube 차단이 재현돼 있으므로 자막 자동 취득 복구를 보장하지 않는다. 장애 중 새 취득을 중단해야 하면 알 수 없는 provider 값으로 실패 닫힘을 적용할 수 있다. 실제 원본·AI 결과·키·DB를 삭제하지 않는다. 새 출처가 저장되기 전에도 Secret 변경을 고려한 후보 검증 없이 rollback하지 않는다.

Free 100크레딧/월, native 1요청=1크레딧은 현재 플랜 근거다. 제목 조회에는 Supadata 크레딧을 쓰지 않는다. 처리 중 시간 초과된 요청도 크레딧을 소비할 수 있으므로 자동 재시도하지 않는다. `202`가 30초 안에 완료되지 않으면 현재 구현은 대기 job을 영속 저장하지 않으며 완료 자막을 가져왔다고 표시하지 않는다. 이번 실제 표본은 200/7.8초였다. 장기 가용성·계정 전체 월 청구는 이 한 표본으로 보장하지 않는다.

## 검사와 보관

- 새 공급자 회귀22개와 기존 관련93개 통과. 전체 `pnpm check` exit0: unit308/Worker2187/Workflow4/recovery CLI2/Node14/Python7, lint/typecheck/build 포함. 최종 시험 수정 뒤 typecheck/해당 파일 ESLint도 통과했다. Production build 및 app/content `versions upload --dry-run --strict` 통과. 완료한 실제 입력/PDF 검수와 브라우저 E2E는 반복하지 않았다. 기존 큰 번들 경고만 있으며 검사 실패는 없다.
- 기존 실제 성공 자막을 새 공급자에 오프라인 주입했다. 외부 요청0, 768구간·12,993자·모든 글자/시각과 SHA가 기존 보관본과 일치한다.
- 실제 원문·키를 읽거나 출력하는 테스트 fixture는 Git에 넣지 않는다. 새 검사는 합성 자료만 사용한다.
- Git 제외 `.wrangler/releases/p8-02-supadata-integration-20261004/`에 검사 로그·빌드·오프라인 대조·읽기 전용 원격 스냅샷을 보존한다. 원본 시험 결과와 키의 기존 영속 위치는 유지한다.
- 폐기한 접근: `redirect:error`(Workers 미지원), 무조건 AI fallback, 비한국어 fallback, Supadata 자막을 기존 공급자 ID/수동 자막으로 위장, 사용자 수동 복사를 자동화 목표로 대체.

공식 근거: [Supadata API](https://docs.supadata.ai/get-transcript), [Free 가격](https://supadata.ai/pricing), [Wrangler 버전](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/), Context7 `/cloudflare/workers-sdk`와 설치된 Wrangler 4.125.0 도움말. 새 SDK/의존성을 추가하지 않는다.

## 승인 후 실제 적용 결과

- 소스 `701475820e7d4281a4948bac820ff326d9e2ced1` → 비공개 content `66eb96c5-ad4c-4d01-85dd-a13aef598acf`100% → app `f8174f94-d983-4855-8d2d-d02756c41f44`100%. app 코드 후보 `f9d0c25a-5743-4965-a89c-f2347b404f4d`는 traffic 배포하지 않았고 동일 etag의 Secret 포함 후보만 적용했다.
- Supadata 키는 기존0600 영속 파일에서 표준입력으로 app 후보에만 전달했다. 모델/명령 인자/로그에 키값을 출력하지 않았고 새 로컬 키 사본·content/backup/Preview 연결은 없다. OpenAI 키는 기존 content만 유지한다.
- 후보의 모든 기존 binding/Secret 이름·D1/DO/Workflow·handler·호환일·설정을 보존했다. Secret 복제 후보에만 `html_handling=auto-trailing-slash`가 명시됐고, [공식 기본값](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/)과 같음을 확인해 그 한 항목만 정규화 후 동일성을 검사했다. 초기 비교에서 발견한 차이를 무시하거나 다른 설정 차이를 허용하지 않았다.
- app/content 설정은 허용한 app provider/Secret과 배포 annotations 외 동일, 두 서버 예약과 Preview/backup 전체 스냅샷은 동일하다. DB 세션1/제출2/call7/usage7/860448microUSD/migration39/FK0 유지. root·두 난도 URL200, 관리자4경로는 기대 Access 호스트302다. 이 HTTP 확인을 실제 자막 버튼 검수와 혼동하지 않는다.
- Supadata `/v1/me` 검수 전 Free100·사용1·잔여99 확인. 배포 작업의 실제 native 요청0/새 AI0. 관리자 미리보기 한 번을 사용자에게 요청했고 최대2크레딧 범위를 유지한다. 아직 새 원본 저장/그 자료의 실제 AI 생성이 성공했다고 쓰지 않는다.
- `approved-before-private.json`, `approved-after-private.json`, 후보별 private/proof, `deployed-proof.json`, `public-access-proof.json`, 업로드/배포 로그를 기존 release 폴더에 보존한다. 기본 dist/배포 포인터 복원 완료. 로그인 토큰401은 Wrangler 읽기 명령의 기존 로그인 갱신으로 해결했다. 기존 자료/키 재입력을 요구하지 않았다.

## 운영 미리보기 확인 — 2026-10-05

2026-10-05 사용자 운영 화면에서 공개 한국어 자막768구간·12,993자 표시를 확인했다. Supadata 계정 조회도 Free100·used1→2·잔여98로 이번 조회1크레딧을 확인했다. 원본 저장은 아직 미확인이다. 다음은 제목/설교일/장절 확인 체크→새 작업 등록→공개 자막 원본 저장이며, 승인된 검수에서 남은 native1크레딧만 사용한다. 영상 확인 버튼을 반복하지 않는다. 계정 응답은 Git 제외 `account-after-preview-20261005-private.json`에 보존했다. 게시일 미확인은 남지만 자막 조회 성공과는 별개이며 설교일은 제목에서 추출한 날짜를 확인한다. 새 AI 호출/배포/코드 변경은 없다.

2026-10-05 사용자 등록 후 스크린샷을 WSL의 /mnt/c 경로에서 직접 확인했다. 새 주간 초안·제목/날짜/시편 장절 선택과 ‘공개 자막 가져와 원본 저장’ 버튼이 보이며 원본은 아직 미저장이다. 다음은 ‘공개 자막 가져오기’ 상자의 해당 버튼을 한 번 누르는 것이며 아래 수동 붙여넣기 ‘최초 원본 저장’ 버튼과 구분한다. 자동화 브라우저 로그인 연결은 사용자 요청으로 나중에 검토한다. 새 서버/API/크레딧 호출은 하지 않았다.
