# P8-02 현재 상태의 Git 기준점 — 2026-10-04

사용자 승인으로 기존 미커밋 작업을 하나의 현재 상태 기준점으로 기록한다. 과거 날짜의 작은 커밋들을 꾸며 만들지 않는다. P8-02/Phase8은 진행 중이며 원격 자막 자동 취득과 실제 생성 검수는 미완료다.

## 보존과 포함 범위

Git 제외 `.wrangler/backups/git-baseline-20261004/`에 workspace와 기존 개인 자료의 8,788개 파일을 비공개 tar로 보존하고 모든 파일 SHA-256을 다시 읽어 검증했다. 기존 Git 이력도 bundle로 보존했다. 동일 디스크 로컬 사본이며 외부 재해 복구 백업이라고 주장하지 않는다. 키/원문/실제 DB/유료 결과는 Git에 넣지 않는다. 기존 0000~0038·폰트/fontkit·lockfile·승인된 자산은 보존한다.

브라우저 임시 프로필 `C:*` 디렉터리와 Python 캐시는 삭제하지 않고 ignore한다. `.wrangler`, 개인 state, 환경 비밀 파일은 기존 제외 규칙/저장소 밖 위치를 유지한다. 알려진 키/JWT/개인 이메일 패턴과 의심 경로를 점검했으며 검출된 키 형태는 합성 테스트 값이다. 정적 검색은 모든 비밀 탐지를 보장하지 않는다.

## 저장소와 배포의 관계

원격 origin은 `https://github.com/jinkyu0105-stack/bibleQuiz.git` 하나다. 같은 저장소로 Preview와 Production을 관리한다. main push는 Preview 자동 배포이며 Production은 검토한 묶음을 수동 승인 후 별도 production 설정으로 배포한다. 이번에는 push/새 배포/원격 변경/유료 호출을 하지 않는다.

이번 기준 커밋은 아래 기존 배포 이후에 생성된다. 현재 런타임/검사 소스 657개가 `.wrangler/releases/p8-02-metadata-fallback-20261003/source-proof.json`의 sourceSha256과 모두 일치한다. 당시 최종 pnpm check와 관련 브라우저 검사 성공 기록을 재사용한다. 코드 변경이 없어 완료한 입력/PDF/전체 검사를 반복하지 않는다. 이번 검사는 보존 해시·커밋 후보/비밀 점검·diff 공백·관련 문서 링크와 Git 상태다.

| 환경/역할 | 기존 배포 version | 근거/한계 |
|---|---|---|
| Production app | 033e9ead-1e0c-4c37-b9e1-75e7b9cbdfbf | 위 657개 소스 지문과 현재 코드 일치, 현재 기준 커밋보다 먼저 배포됨 |
| Production content | 95fbc7a6-95f5-4bcc-a85b-30dad3a59e56 | 기존 HANDOFF 설치 기록, 이번에 별도 번들 재대조/재배포 안 함 |
| Production backup | 3fb0e7c7-368b-45a9-89f9-2818739e415d | 기존 HANDOFF 설치 기록, 이번에 별도 번들 재대조/재배포 안 함 |
| Preview app | 7c356a97-f0f3-4793-ab7b-066b2ae2aeea | 이전 버전, 현재 커밋과 같다고 주장하지 않음 |

이후에는 AGENTS의 커밋/배포 규칙에 따라 검증한 변경마다 커밋하고 source commit → 대상 환경 → Worker version을 기록한다. 소급 생성한 이번 기준점은 잃어버린 과거 세부 수정 이력을 복구하지 않는다.

## 기준점 검사 결과

스테이징 전체 `git diff --cached --check`는 기존 누적 파일의 공백 지적 692건으로 exit 2다. CRLF CSV, Markdown 줄바꿈, 보관 원문, 기존 SQL/코드의 끝 빈 줄과 fontkit 패치 문맥 등이 포함된다. 원본·migration·패치·검증 소스 지문 보존을 위해 이번 기준점에서 일괄 수정하지 않는다. 이번 수정 문서/ignore의 범위별 공백 검사는 별도로 통과 여부를 확인한다. 과거 전체 검사 성공을 이번 전체 공백 검사 성공으로 쓰지 않는다.
