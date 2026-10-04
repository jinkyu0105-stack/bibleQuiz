# P8-02 운영 자막 연결 — 배포 검토 묶음

2026-10-04. 무료 Cloudflare 시험 성공 뒤 사용자의 다음 작업 요청으로 운영 앱의 조회·원본 저장 연결을 구현했다. **로컬 구현·검사·배포 준비이며 원격 적용 전이다.** P8-02/Phase8은 진행 중이다. [앞선 실제 시험](transcript-comparison.md#cloudflare-무료-시험-성공)은 그대로 재사용한다.

## 사용자가 확인할 동작

새 설교 화면에서 기존 영상 확인 버튼을 누르면 제목·날짜·장절 자동 입력은 유지하면서 한국어 공개 자막을 Supadata로 조회한다. 설교 등록 후 기존 원본 저장 버튼이 같은 공급자를 사용해 시간 구간과 원문을 불변 저장한다. 저장된 원본이 있거나 이미 등록된 영상이면 기존 중복 처리로 추가 조회를 막는다. 조회와 최초 원본 저장은 각각 한 요청이며 보관 후 재방문은 재취득하지 않는다.

`PUBLIC_TRANSCRIPT_PROVIDER=supadata`인 운영 앱만 `SUPADATA_API_KEY` Secret을 사용한다. 기본/Preview는 기존 공급자를 유지한다. 알 수 없는 설정이나 키 누락은 실패로 반환하고 다른 공급자·AI로 자동 전환하지 않는다. API 키는 브라우저나 공개 API에 전달하지 않는다. oEmbed 공개 제목 조회는 자막과 독립적으로 수행하고 기존 제목 파서로 날짜·장절을 채운다.

Supadata는 canonical YouTube 주소, `mode=native`, `lang=ko`, `text=false`로만 요청한다. 실제 응답과 모든 구간의 한국어 여부, 시간 순서, 응답 1MiB, 기존 3만 자 제한을 검사한다. `202`는 같은 job만 1초 간격으로 전체 30초 이내 조회하며 새 요청/자동 재시도를 만들지 않는다. HTTP 오류·리다이렉트·한도·시간 초과는 안전한 진단만 반환한다. 원문/키/upstream 오류 문자열은 진단에서 제외한다. 공급자가 수동/자동 자막 여부를 제공하지 않으므로 `generated=null`, 공급자 식별자 `supadata-native`와 내부 track 표식 `supadata-ko`를 저장한다. 이 표식은 YouTube의 실제 track ID라는 뜻이 아니다. 화면에서는 수동 자막이라고 추정하지 않는다.

## 대상과 적용 순서

1. 검사한 소스 커밋과 두 Worker의 빌드 지문을 고정한다. 현재 기준 앱 `ad9ebbf0-be59-4941-af42-ea063e97f984`, content `95fbc7a6-95f5-4bcc-a85b-30dad3a59e56`. 적용 직전 다시 비교한다.
2. 비공개 `biblequiz-content`에 새 출처 읽기 호환 코드 후보를 올리고, 기존 모델·AI flag·OpenAI Secret·D1/Workflow binding·비공개 주소 상태를 대조한 후 100% 적용한다. 이 단계 자체는 AI를 호출하지 않는다.
3. 운영 앱 `biblequiz-app`의 검사한 빌드와 `PUBLIC_TRANSCRIPT_PROVIDER=supadata`를 후보로만 올린다. 최신 후보가 방금 올린 소스/빌드와 일치하는지 확인한다. 기존 운영 traffic은 그대로 둔다.
4. 이미 보관한 Supadata 키를 프로그램의 표준입력으로 `wrangler versions secret put SUPADATA_API_KEY`에 전달해 방금 후보를 복제한 Secret 포함 후보를 만든다. 자동 배포하는 `secret put`은 사용하지 않는다. 코드 지문·Secret 이름·기존 binding·D1/Access/DO/cron 보존을 다시 대조한 후 이 최종 후보를100% 적용한다. 키는 앱에만 두며 content/backup/Preview에는 주지 않는다. 공개 접속과 관리자 보호를 읽기 확인한다.
5. 사용자 관리자 버튼으로 영상 확인 1회와 최초 원본 저장 1회를 확인한다. 기존 성공 시험은 반복하지 않는다. **검수 상한은 native 2크레딧**, 승인된 Free 잔여99에서 최대2를 사용하며 AI 생성·유료 전환·충전은 제외한다. 이미 저장돼 있으면 재취득하지 않는다. 새 설교의 AI 생성 검수는 기존 별도 사용자 단계로 유지한다.

migration 없음(0000~0038 보존), main push 없음, Preview/backup 변경 없음. 원격 변경은 이 묶음에 대한 구체적 승인 뒤 실행한다. 무료 시험 승인을 운영 Secret 설치 완료로 해석하지 않는다.

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
