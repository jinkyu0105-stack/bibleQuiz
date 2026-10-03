# BibleQuiz 상세 명세 목차

제품 기준은 아래 분야별 문서와 [DECISIONS](docs/DECISIONS.md), 현재 구현은 [STATUS](docs/STATUS.md), 다음 첫 동작은 [HANDOFF](docs/HANDOFF.md)를 따른다. 관련 분야만 읽는다. P5-70·P5-71과 P5-72의 로컬 구현·검수가 완료됐다. P6-01 출력은 PDF 표시 오류 교정·필수 검사·실제 렌더 검수까지 로컬 완료했다. P7B-01은 반응형·접근성·공통 시각 마무리·필수 검사와 승인된 보유 기기 검수까지 로컬 완료했다. 기존 Windows/iPhone 및 노트10+ Chrome 증거로 종료했고 macOS·개별 키보드 미검수 한계는 보존한다. P8-01 백업/격리 복원·기존 Cron·공개 요청 제한·비용/매뉴얼은 필수 검사·상태 문서까지 로컬 완료했다. P8-02는 [운영 합의·배포 후보](docs/work/P8-02.md)를 준비한 뒤 사용자가 실제 서버/저장소·관리자 로그인/백업 연결·배포/공개를 승인했다. 수동 승인·사본 후 SQL·코드/DB 복구 구분을 확정하고 같은 번호로 적용/검수를 진행한다. 공개 전 보호·백업·무료 범위를 확인하며 Paid 전환·새 AI 호출·main push는 제외한다. [P8 코드·검사·승인 경계](docs/work/P8-01.md)·[운영 매뉴얼](docs/operations-manual.md)를 따른다. [P7B 코드·검사·기기](docs/work/P7B-01.md)를 따른다. Production·Preview의0000~0038과 최신 앱/출력/운영 코드는 적용됐다. 별도 Production 콘텐츠/백업은 비공개이며 Turnstile·R2·관리자 Access·사용량 갱신·수동 백업/격리 복원·기존 한 편 이전/실제 발행/두 난도 제출 검수는 완료했다. Production 요청 제한과5분 자동 마감 예약도 적용했다. 자동 백업/삭제 기록 예약·7일 초안 정리·일반 공개/관리자 보호·매뉴얼 동기화를 완료했다. Production AI는 승인된 기존 키를 비공개content에만 연결하고 앱/콘텐츠 설정·필수검사·배포까지 완료했다. [연결 묶음](docs/work/p8-02/ai-readiness-review.md)의 새 유료 생성 시험은 제외/미실행이다. 사용자가 관리자 직접 검수를 시작했고 영상 조회 native 오류의 수정·필수 검사·앱 배포를 마쳤다. [현재 복구와 다음 동작](docs/work/p8-02/video-fetch-recovery.md)에서 실제 영상 재확인·AI 생성/청구 대조를 이어간다. 사용자 영상 조회 성공 뒤 자동 제목 정리·장절 추출 누락을 보완하고 필수 검사·운영 앱 배포를 마쳤다. [자동 등록 확인부터](docs/work/p8-02/automatic-registration.md) 같은 P8-02를 이어간다. 이후 실제 YouTube player 차단에 watch JSON 우선 사용을 보완·검사·배포했으나 최신 운영 조회도 watch 내 challenge로 실패해 자동 취득은 미해결이며 [원격 재확인](docs/work/p8-02/video-fetch-recovery.md#실제-player-차단과-watch-응답-재사용--2026-10-03)이 남는다. 이후 제목이 없는 차단 응답에는 공개 기본 정보로 자동 등록 항목을 보완·검사·배포했고, 자막 자동 취득은 미해결이다. 사용자 직접 복사로 오해한 안내는 철회했고 실제 로컬 브라우저 자동 클릭·자막269구간/12,792자 저장에 성공했다. [원본 보존과 운영 연결](docs/work/p8-02/browser-transcript.md)을 이어간다. P8-02/Phase8/v1은 아직 전체 완료가 아니다. [남은 결과·종료 조건](docs/DELIVERY_PLAN.md)은 기존 명세 전체를 작업에 배정한 실행 기준이다. 실제 자료 보존/완료 근거는 [P5-70](docs/work/P5-70.md), Preview 연결·관리자 DO·무료 플랜 검수와 관측 한계는 [P5-71](docs/work/P5-71.md#preview-관리자-do-적용과-무료-검수-완료), 주간 운영의 코드/검사와 승인 경계는 [P5-72](docs/work/P5-72.md), 출력의 코드/생성 파일/검증과 보존 차이는 [P6-01](docs/work/P6-01.md), 개발 방식의 근거는 [2026-09-28 감사](docs/DEVELOPMENT_AUDIT_2026-09-28.md)를 따른다. 유료 호출·실제 자료 조작·원격 적용·배포·출력은 기존 승인 범위를 넘겨 실행하지 않는다.

## 분야별 정본

| 기존 장 | 주제 | 상세 명세 |
|---|---|---|
| 1 | 1. 제품 목표와 원칙 | [읽기](docs/spec/product.md) |
| 2 | 2. 사용자·권한·정보 구조 | [읽기](docs/spec/users.md) |
| 3 | 3. 반응형 화면 사양 | [읽기](docs/spec/responsive.md) |
| 4 | 4. 퍼즐 콘텐츠와 가변 격자 배치 규칙 | [읽기](docs/spec/puzzle.md) |
| 5 | 5. 한글 IME 입력 설계 | [읽기](docs/spec/ime.md) |
| 6 | 6. 서버 채점과 정답 노출 정책 | [읽기](docs/spec/scoring.md) |
| 7 | 7. 제출·중복 방지·악성 내용 방어 | [읽기](docs/spec/submissions.md) |
| 8 | 8. 리더보드·참여 기록·관리자 조치 | [읽기](docs/spec/leaderboard.md) |
| 9 | 9. 이미지·인쇄 내보내기 | [읽기](docs/spec/export.md) |
| 10 | 10. 시각 디자인과 이미지 자산 | [읽기](docs/spec/design.md) |
| 11 | 11. 매주 발행 흐름 | [읽기](docs/spec/generation.md) |
| 12 | 12. 성경 본문 출처·정확성·장절 UI | [읽기](docs/spec/bible.md) |
| 13 | 13. Cloudflare·React SPA 기술 구조 | [읽기](docs/spec/architecture.md) |
| 14 | 14. D1 데이터 모델 | [읽기](docs/spec/data-model.md) |
| 15 | 15. API 계약 | [읽기](docs/spec/api.md) |
| 18 | 18. 이후 디자인·이미지 스킬 사용 규칙 | [읽기](docs/spec/design-workflow.md) |
| 19 | 19. 테스트 계획 | [읽기](docs/spec/testing.md) |
| 20 | 20. 위험과 대응 | [읽기](docs/spec/risks.md) |
| 21 | 21. v1 완료 정의 | [읽기](docs/spec/release.md) |
| 23 | 23. 용어집 | [읽기](docs/spec/glossary.md) |

단계별 진행/완료 조건은 [ROADMAP](docs/ROADMAP.md), 개발 방식 검토는 [DEVELOPMENT_REVIEW](docs/DEVELOPMENT_REVIEW.md), 현재 계약 정합화는 [P5-48](docs/work/P5-48.md)을 따른다. 기존 16장 디렉터리 기록·17장 단계별 세부 이력·22장 부록은 [변경 전 원문](docs/archive/2026-09-21-p5-48/implementation.md)에 보존한다. 상세 요구를 폐기한 것이 아니며 현재 제품 결정과 충돌하는 과거 지시는 실행하지 않는다.

## 기존 링크 호환

기존 검토서·측정 보고서가 참조하는 절 링크다. 당시 완료 증거를 볼 때는 보관 기록을, 현재 제품 기준을 볼 때는 분야별 정본을 따른다. 모든 이전 제목의 위치는 [source-map](docs/archive/2026-09-21-p5-48/source-map.json)에 있다.

<a id="14327-p5-42-generation-lifecyclecontext-내구성-상세-설계--2026-09-17"></a>

[해당 절로 이동](docs/archive/2026-09-21-p5-48/implementation.md#14327-p5-42-generation-lifecyclecontext-내구성-상세-설계--2026-09-17)

<a id="p5-27-메모리-검증-방법-변경--2026-09-16-d-032"></a>

[해당 절로 이동](docs/archive/2026-09-21-p5-48/implementation.md#p5-27-메모리-검증-방법-변경--2026-09-16-d-032)
