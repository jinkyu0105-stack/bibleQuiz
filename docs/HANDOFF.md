# 다음 작업 인수인계

## 현재 작업

**P9-25 iPhone 터치·모바일 효과 제어 후속: 로컬 보정/관련 검수 완료, 실제 기기 재확인 대기.** 시작 main851e4dc/clean. 히어로 화살표 배경 제거, 모바일 헤더 좌표 기준 수정, 터치 앵커의 중복 rAF 제거, null blur로 효과가 다시 켜지는 경로 수정. 별 버튼 고정/시간대 줄을 세 효과로 전환/초기화 아이콘·ON/OFF/닫으면 시간대 및 초점 복귀를 적용했다. PC 기존 모션·설정 값·하늘/영상/유리는 유지한다. [현재 상세와 실패 기록](work/P9-25.md#iphone-터치와-모바일-효과-제어-후속).

## 검사·한계

- Chromium PC/모바일 첫44통과, 최종 보정 뒤42통과/2실패. 풀이 lazy 본문 도착 전 푸터 측정 조건을 수정한 재검사8건 모두 통과해44개 대상 확인. 실패 이력을 지우지 않는다.
- iPhone12ProMax 설정 Linux WebKit10건 중7통과/3실패. 연속 효과1건은45초 제한으로 실패했으나 이벤트 추적26.08초 정상 완료, 동일 검증의90초 제한 재검사32초 통과. 영상 제외 핵심8건 확인. 영상 켠 첫 로딩2건은5초/45초 시간초과 실패로 남으며 영상 렌더/실기기 성공으로 보고하지 않는다.
- 실제5173 영상 켠 네 시간대×320/375/428/가로667/PC1440의20상태: 넘침0·오류0·별 이동0. 직접320밤/428노을 대조. lint/typecheck/build 통과, 기존fontkit 큰 번들 경고 유지. 마지막 테스트 준비 조건 변경 후 lint/typecheck도 통과. 이번에는 전체check/전체E2E를 반복하지 않았다.
- 실제 iPhone의 ‘도착 후 원위치’는 Linux에서 정확히 재현하지 못했다. 중복 처리 제거 뒤 도착/지연 자료/반복 이동/뒤로·앞으로 검사를 통과했으며, 사용자 실기기 재확인은 남는다.

## Git·다음 범위

이번 보정은 검토한 파일만 명시적으로 stage해 로컬 커밋한다. 최종 커밋/clean 상태는 실제 Git log/status를 확인한다. **이번 push/배포 없음.** 직전 원격 main851e4dc4bbad4992c0f24513bdc1cbc9d7cc7bdb·Preview04d70dfd-d2a2-4480-94fd-d0996cd70af2·100%·2026-10-15 19:45:39KST는 이전 작업의 `.wrangler/releases/p9-25-loading/final-deployment-proof.json` 근거다. 기능 소스f9581ac의 이전 전체check2552건·CI38720299539 성공을 이번 코드 검사로 재사용하지 않는다. [기존 폰 Preview](https://biblequiz-app-preview.jinkyu0105.workers.dev/)에는 이번 수정이 아직 없다. 실제 자료·AI·원격 설정·Production7aea6843은 보존했다. 다음은 Preview 반영 범위 확정 후 실제 iPhone 확인이며 Production 승인이 아니다.

## 실행 환경

Node24.18.0/pnpm11.14.0. /bin/bash·login:false·명시workdir·require_escalated 승인 검토 경로를 사용한다. PATH 필요 시 `/home/onegem/.nvm/versions/node/v24.18.0/bin` 추가. 서버5173/.wrangler/ui-demo-state 보존, 재시작 `pnpm dev:demo --port 5173 --strictPort`. E2E4173 격리자료. 시작 Pro92%×사용자 기준10=920%, 별도5시간 창 없음.

WebKit은 기본 런처의 시스템 라이브러리 누락 때문에 실패했다. 공식 Ubuntu 패키지만 `/tmp/biblequiz-webkit/root`에 풀고 ELF/GLES를 점검했다. `/tmp/biblequiz-webkit/launch.sh`가 WPE bin/lib/sys/lib 및 임시 라이브러리를 연결한다. 시스템 설치/프로젝트 의존성 추가는 없다. 재부팅하면 이 임시 환경은 재준비한다. 원자료와 `webkit.config.ts`는 ignored `.wrangler/releases/p9-25-touch/`에 있다. 이 설정은 cwd가 저장소 루트여야 한다. 실제 영상/GPU를 제외한 검사를 모든 iPhone 동작의 성공으로 확대하지 않는다.

다음 시작은 실제 사용량·경로 확인, AGENTS→PROJECT_CONTEXT→DECISIONS→STATUS→HANDOFF→implementation 관련 정본→P9-25→Git status/diff/log 순서. 현재 변경과 실제 자료를 보존한다.

**현재 P9-25 후속 로컬 완료 · 부모 모바일 보정 실기기 재확인 대기 · 다음 Preview 반영 범위 확정/사용자 iPhone 확인 · 세션 유지 · 추천 GPT-6.1-sol/medium** — 한정된 기기 피드백 검수에 적합하다.
