# 다음 작업 인수인계

## 현재 작업

**P9-25 iPhone 터치·모바일 효과 제어 후속: 로컬 보정/관련 검수 완료, 실제 기기 재확인 대기.** 시작 main851e4dc/clean. 히어로 화살표 배경 제거, 모바일 헤더 좌표 기준 수정, 터치 앵커의 중복 rAF 제거, null blur로 효과가 다시 켜지는 경로 수정. 별 버튼 고정/시간대 줄을 세 효과로 전환/초기화 아이콘·ON/OFF/닫으면 시간대 및 초점 복귀를 적용했다. PC 기존 모션·설정 값·하늘/영상/유리는 유지한다. [현재 상세와 실패 기록](work/P9-25.md#iphone-터치와-모바일-효과-제어-후속).

## 검사·한계

- Chromium PC/모바일 첫44통과, 최종 보정 뒤42통과/2실패. 풀이 lazy 본문 도착 전 푸터 측정 조건을 수정한 재검사8건 모두 통과해44개 대상 확인. 실패 이력을 지우지 않는다.
- iPhone12ProMax 설정 Linux WebKit10건 중7통과/3실패. 연속 효과1건은45초 제한으로 실패했으나 이벤트 추적26.08초 정상 완료, 동일 검증의90초 제한 재검사32초 통과. 영상 제외 핵심8건 확인. 영상 켠 첫 로딩2건은5초/45초 시간초과 실패로 남으며 영상 렌더/실기기 성공으로 보고하지 않는다.
- 실제5173 영상 켠 네 시간대×320/375/428/가로667/PC1440의20상태: 넘침0·오류0·별 이동0. 직접320밤/428노을 대조. lint/typecheck/build 통과, 기존fontkit 큰 번들 경고 유지. 마지막 테스트 준비 조건 변경 후 lint/typecheck도 통과. 후속 push 요청에 따라 전체 `pnpm check`를 실행해 2,552건·lint/typecheck/build 통과(exit0). 전체 E2E는 원격 CI 진행 중이다.
- 실제 iPhone의 ‘도착 후 원위치’는 Linux에서 정확히 재현하지 못했다. 중복 처리 제거 뒤 도착/지연 자료/반복 이동/뒤로·앞으로 검사를 통과했으며, 사용자 실기기 재확인은 남는다.

## Git·다음 범위

2026-10-16 사용자 “깃 푸시 하세요” 승인으로 기능 소스 `d80b80eac8cbdd0f89237ce299188db19b0c2f37`를 main에 push했고 원격 해시 일치를 확인했다. 시작/푸시 직전 worktree clean. 검사 로그 `/tmp/biblequiz-push-check.log`, exit0. 원격 CI38763709735의 validate/browser는 진행 중이다. 2026-10-16 00:56:20KST 확인: main a403d7f의 Workers Builds bd16892f-096e-4f2f-bf2c-5fe0a61d0df7 success, Preview version5598f5e5-3f1a-44ac-aa83-1221189fb8b7의100% 배포를 deployments API와 대조했다. push 직후에는 이전04d70dfd가 유지됐고 이후 빌드가 시작됐다. 상세 Builds API403으로 지연의 내부 원인은 확정하지 못했다. 배포 결과 기록만 로컬 커밋하며 불필요한 재배포 push는 하지 않는다. 실제 iPhone 재확인은 남는다. 직전 원격851e4dc/Preview04d70dfd 기록은 `.wrangler/releases/p9-25-loading/final-deployment-proof.json`에 보존한다. [폰 Preview](https://biblequiz-app-preview.jinkyu0105.workers.dev/). 실제 자료·AI·원격 설정·Production7aea6843은 변경하지 않았다. 이 결과 문서 커밋은 기능 변경 없이 별도로 push한다. 다음은 자동 배포/원격 CI 결과 확인과 사용자 실제 iPhone 재확인이다.

## 실행 환경

Node24.18.0/pnpm11.14.0. /bin/bash·login:false·명시workdir·require_escalated 승인 검토 경로를 사용한다. PATH 필요 시 `/home/onegem/.nvm/versions/node/v24.18.0/bin` 추가. 서버5173/.wrangler/ui-demo-state 보존, 재시작 `pnpm dev:demo --port 5173 --strictPort`. E2E4173 격리자료. 이번 push 시작 Pro90%×사용자 기준10=900%, 별도5시간 창 없음.

WebKit은 기본 런처의 시스템 라이브러리 누락 때문에 실패했다. 공식 Ubuntu 패키지만 `/tmp/biblequiz-webkit/root`에 풀고 ELF/GLES를 점검했다. `/tmp/biblequiz-webkit/launch.sh`가 WPE bin/lib/sys/lib 및 임시 라이브러리를 연결한다. 시스템 설치/프로젝트 의존성 추가는 없다. 재부팅하면 이 임시 환경은 재준비한다. 원자료와 `webkit.config.ts`는 ignored `.wrangler/releases/p9-25-touch/`에 있다. 이 설정은 cwd가 저장소 루트여야 한다. 실제 영상/GPU를 제외한 검사를 모든 iPhone 동작의 성공으로 확대하지 않는다.

다음 시작은 실제 사용량·경로 확인, AGENTS→PROJECT_CONTEXT→DECISIONS→STATUS→HANDOFF→implementation 관련 정본→P9-25→Git status/diff/log 순서. 현재 변경과 실제 자료를 보존한다.

**현재 P9-25 후속 main 반영 완료 · 부모 모바일 보정 실기기 재확인 대기 · 다음 Preview 자동 배포 결과/사용자 iPhone 확인 · 세션 유지 · 추천 GPT-6.1-sol/medium** — 한정된 기기 피드백 검수에 적합하다.
