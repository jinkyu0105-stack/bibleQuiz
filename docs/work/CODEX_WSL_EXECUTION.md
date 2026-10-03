# Codex Windows / WSL 실행 오류 조사와 재개

2026-10-01. P5-72 로컬 완료 이후 사용자가 요청한 실행 환경 조사·스킬 설치다. 새 제품 작업 번호를 만들거나 P6-01을 시작하지 않았다. 앱 코드·migration·실제 자료·키·유료 결과·원격 환경은 변경하지 않았다.

## 확인된 사실과 초기 안내의 오류

| 확인 항목 | 실제 결과 |
|---|---|
| 저장소 | `/home/onegem/work/bibleQuiz`, Bash와 Git 저장소 존재, 읽기/필수 검사 성공 |
| 앱 설정 | `runCodexInWindowsSubsystemForLinux=true`, `integratedTerminalShell=wsl` |
| 실제 작업 엔진 | Windows 앱이 WSL에서 실행한 Linux `codex-cli 0.159.2` |
| 같은 `pwd`, Bash, workdir의 기본 실행 | 명령 시작 전 `Failed to create unified exec process: No such file or directory (os error 2)` |
| 승인 검토 경로 | `/bin/bash`, `login:false`, `sandbox_permissions:require_escalated`로 같은 `pwd` 성공. 자동 승인 검토를 유지 |
| helper 관측 | 현재 arg0 폴더에는 Windows `.bat` 두 개가 있고 Linux helper가 없다. 실패한 launcher의 실제 target은 확인되지 않았으므로 내부 원인 확정으로 쓰지 않음 |
| 앱/WSL 변경 | 설정 변경·Full access 전환·재설치·WSL 재부팅·저장소 이동·재연결·helper 생성 없이 진행 |

`pwd`는 현재 디렉터리를 출력하는 명령이며 연결을 복구하거나 설정을 바꾸지 않는다. 세션 기록의 첫 두 `pwd` 시도는 기본 실행, 이후 성공 시도는 승인 검토 경로였다. 성공 전에 **실행 경로가 달라졌다**. `pwd`를 몰라서 늦게 알아낸 것이 아니라, 시작 전 도구 실패를 저장소 접근 불가로 과잉 해석하고 가능한 대안을 먼저 확인하지 않은 판단이 문제였다. 사용자에게 재연결을 요청한 초기 설명은 철회했다.

별도 `codex sandbox` 직접 실행은 현재 CLI에서 필수 named permission profile이 없다는 인자 오류로 종료됐다. 이것을 현재 launch 오류의 재현이나 sandbox 구성 성공으로 기록하지 않는다. 정상 대안이 있으므로 임의 profile/보안 설정을 만들어 계속 실험하지 않았다.

## 공식 문서와 커뮤니티의 구분

[공식 Windows 문서](https://learn.chatgpt.com/docs/windows/windows-app#windows-subsystem-for-linux-wsl)는 터미널과 작업 엔진을 별도로 선택하며, 엔진 전환 후 앱 재시작이 필요하다고 설명한다. 이번 설정과 실행 엔진은 이미 WSL이므로 사용자 설정 누락의 증거가 아니다.

아래는 OpenAI 저장소의 **사용자 제보**이며 공식 지원 답변이나 모든 버전의 확정 수정법이 아니다.

- [#26723](https://github.com/openai/codex/issues/26723): 기본 실행 실패·승인된 실행 성공·Windows helper만 남는 관측까지 이번 증상과 특히 유사하다. 조회 시 closed이지만, 현재 버전에서 재현된 오류가 해결됐다는 뜻은 아니다.
- [#16970](https://github.com/openai/codex/issues/16970): 오래된 임시 sandbox helper 경로로 ENOENT, 일부 제보에서 앱 재시작 후 회복.
- [#22185](https://github.com/openai/codex/issues/22185): Windows/WSL 프로세스 경로 혼용, 제보자 버전에서 unified_exec=false와 재시작으로 회복.
- [#47429](https://github.com/openai/codex/issues/47429): 9월 WSL mount/sandbox 초기화 실패. 이번의 generic ENOENT와 다른 오류이며 같은 원인이라고 확정하지 않는다.

최근 [Reddit의 WSL sandbox/tool-routing 제보](https://www.reddit.com/r/codex/comments/1wp8cui/codex_desktop_wsl_luna_6_hits_mountinfo_path_is/)도 직접 읽었다. 사용자별 오류와 해결 결과가 달라 재시작·unified_exec 변경·저장소 이동·보안 해제를 보편 처방으로 쓰지 않는다. 이전 다른 세션의 실패가 모두 같은 내부 원인이었다고 단정하지 않는다.

## 설치·활용한 스킬과 선택 근거

- [last30days 원본](https://github.com/mvanhorn/last30days-skill), v3.26.0, revision `5103ba478b380552207a3754b74c7655d64208cd`를 공식 installer helper로 설치했다. 설치 시 GitHub 별63,306개. 내용과 config/source 경로를 확인하고 실행했다.
- 설치 위치 `/mnt/c/Users/jinky/.codex/skills/last30days`; 공식 [로컬 스킬 탐색 경로](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)에 맞게 `/home/onegem/.agents/skills/last30days` 링크도 등록했다. 원본 스킬 내용을 임의 개조하지 않았다.
- 유료 API credential 없이 공개 Reddit/HN 검색을 실행했다. 환경은 allowlist로 구성하고 프로젝트 `.env`·브라우저 쿠키·비공개 자료를 적재하지 않았다. 첫 preflight에서 기존 gh 인증 사용 가능성이 발견돼 실제 검색은 별도 GH_CONFIG_DIR로 격리했다. GitHub project 검색은 token 없음으로 실행되지 않았다. OpenAI/Gemini/유료 검색·X 호출0.
- 최초 일반 검색은 Reddit1개/HN6개를 반환했지만 일반 AI 뉴스가 섞여 원인 판단에서 제외했다. 좁힌 `Codex WSL ENOENT`의 9월1일~10월1일 검색은 Reddit4개/댓글21개를 반환했다. 그중 10월1일의 관련 제목은 원문 웹 fetch가 실패했으므로 내용 확인했다고 쓰지 않는다. 실제 원인 판단은 직접 재현·공식 문서·열람 성공한 issue/커뮤니티에 근거했다.
- `find-skills`로 skills.sh 목록 확인 뒤 `pnpm dlx skills find 'codex wsl'`와 `'systematic debugging'`을 실행했다. [systematic-debugging](https://skills.sh/obra/superpowers/systematic-debugging)는 설치약277.7K·원본별293,617개, [debugging-and-error-recovery](https://github.com/addyosmani/agent-skills/blob/main/skills/debugging-and-error-recovery/SKILL.md)는 CLI 설치44.6K·원본별100,221개를 확인했다. 두 원문도 읽었다. 일반 프로그램 오류 조사에 유용하지만 이번 tool startup/승인 경로·한 번 실패 후 대안 전환을 직접 다루지 않아 자동 적용 범위를 넓히는 설치를 하지 않았다.
- 해당 공백을 위한 `codex-exec-recovery`를 skill-creator로 생성했다. 글로벌 설치와 `/home/onegem/.agents/skills/` 탐색 링크를 등록했다. 정상적인 자동 발견을 허용하며 다음 턴부터 사용 가능하다. 프로젝트 AGENTS에도 이름과 핵심 규칙을 넣어 새 세션의 재개 절차에 연결했다.

새 스킬은 시작 전/명령 실행 후/권한 거부를 구분하고, 같은 실패 경로를 반복하지 않으며, 현재 권한에서 허용된 대안을 확인한 뒤 승인된 작업을 계속한다. 읽기 전용 진단 script는 작업 경로·Git root/HEAD·shell/helper 존재만 확인한다. 승인 거부 우회·전역 보안 해제·원격/유료 쓰기 승인을 포함하지 않는다. 앱 결함 자체의 영구 수정으로 표현하지 않는다.

## 검증·보존과 로그

새 스킬 quick_validate 통과. 진단 script는 실제 저장소에서 실행했고, 임시 Git 저장소에서 경로 공백·Git 식별·깨진 helper와 원인 미확정·파일 불변·없는 디렉터리 exit2를 확인했다. 문서 변경은 diff/링크·사실 검사만 수행하며 P5-72 코드 검사를 이유 없이 반복하지 않는다.

이번 시작의 Git 파일727개 hash 기준으로 앱·SQL/snapshot·lock·기존 소스는 유지한다. 기존 자료/키의 내용이나 전체 환경·인증값은 출력하지 않았다. 임시 검색/진단 출력은 `/tmp/codex-wsl-research/`에 있고, source/skill 설치는 프로젝트 production 의존성을 추가하지 않는다. 원격 쓰기·배포·유료 호출·commit/push/reset/stash0.

## 세션 권장

실제 이 대화의 로그에는 컨텍스트 압축이 두 번 기록돼 있다. 화면상 사용자 턴이 적어도 도구·코드·검사와 문서가 누적되므로 내부 작업량은 적지 않다. P5-72 필수 검사·STATUS/HANDOFF가 끝났고 출력 P6-01은 독립 Phase 경계이며 이번 별도 환경 조사까지 주제가 넓어졌다. **P6-01은 새 세션 권장**으로 인계를 갱신했다. 앞서 세션 유지 가능이라고 한 판단은 이 맥락을 충분히 반영하지 못했다. 새 세션을 실행 오류의 수리법으로 제안하지 않는다.

다음은 P6-01, 추천 GPT-6.1 Sol·높음. 복사할 시작 문구는 [HANDOFF](../HANDOFF.md#새-대화를-선택할-때-복사할-시작-문구)에 있다. 이 조사는 P6-01 구현 시작이나 새 원격 승인으로 해석하지 않는다.
