# BibleQuiz 상세 명세 목차

제품 기준은 아래 분야별 정본과 [DECISIONS](docs/DECISIONS.md), 현재 상태는 [STATUS](docs/STATUS.md), 정확한 다음 동작은 [HANDOFF](docs/HANDOFF.md)를 따른다. 완료한 P5~P8-01 검수는 재사용하며 [DELIVERY_PLAN](docs/DELIVERY_PLAN.md)의 종료 조건은 유지한다.

이전 **P8-02·Phase8은 완료**했다. 운영 자동 자막·실제 AI 생성/사람 검수·시험 발행·대표 공개 경로·백업/운영 검수, 캐시 저장 비용 수정 배포와 공급자 청구 대조를 마쳤다. OpenAI5회/USD0.57, Cloudflare2026년10월 현재 예상 사용료0은 사용자 확인 근거이며 미래 청구 보장은 아니다. [최종 판정·배포 버전·관측 한계](docs/work/p8-02/closeout-review.md#운영-반영청구-대조종료--2026-10-06)와 [인계](docs/HANDOFF.md)를 따른다. 관리자 UI 조사는 Phase9에서 시작했다. 격자/후보 개선·Supadata 사용량 등 나머지 [향후 계획](docs/future/notes.md)은 별도 사용자 선택 전 착수하지 않는다. 기존 자료·키·유료 결과·0000~0038과 승인된 운영/복구 합의를 보존한다.

현재 **Phase9의 이번 승인 범위는 완료**했다. [P9-01 조사](docs/work/P9-01.md) → [P9-02 승인 시안 기반 프런트엔드 개편·CI 수정](docs/work/P9-02.md) → 사용자 명시 승인에 따른 [P9-04 운영 배포](docs/work/P9-04.md)를 마쳤다. P9-03은 P9-02에 통합된 제안으로 재사용하지 않는다. 공개·관리자 기존 기능과 실제 자료를 보존했으며 새 AI/DB migration 없이 앱만 갱신했다. 실제 소스·버전·명령·알려진 한계는 STATUS/HANDOFF와 P9-04를 따른다. 추가 시안 검수를 새 필수 단계로 두지 않는다.

2026-10-08 별도 요청의 **Air 계승 UI를 P9-06에서 실제 React 페이지에 로컬 적용**했다. [P9-05](docs/work/P9-05.md)의 원본 탐색 → [P9-06](docs/work/P9-06.md) 대표 시안/유리 컴포넌트 → 2026-10-10 사용자 지시의 [실제 페이지 적용](docs/work/p9-06/app-integration.md) 순서다. 제품 기준은 [디자인10.7](docs/spec/design.md#107-air-계승-하늘-방향--2026-10-08)을 따르고 이전 숲·종이·색상 기준은 종료했다. 후속 [P9-07](docs/work/P9-07.md)은 메인 탐색·서울 자동 시간을, [P9-08](docs/work/P9-08.md)은 잔디 사진 복귀·이동 속도·관리자 투명 버튼을 보정했다. 현재 공통 버튼은 [P9-09](docs/work/P9-09.md)의 풀이 기준 단순한 버튼을 따른다. 관리자 좌측 패널은 [P9-10](docs/work/P9-10.md)에서 검토본과 같은 구성으로 보정했다. 현재 Preview는 [P9-14](docs/work/P9-14.md)(소스0fbde84/versioncd6efb0e)이며 Production은 P9-04를 유지한다. 현재 내부 화면의 정보 구조·명조 제목·관리 목록 개편은 [P9-17](docs/work/P9-17.md)의 로컬 완료본을 따른다. 기존 안내 P9-13과 메뉴 P9-10의 해당 기준을 대체하며 실제 Preview는 위 P9-14 버전을 유지한다. 운영 매뉴얼의 현재 목차·읽기 화면과 잔디 스케치는 [P9-20](docs/work/P9-20.md)의 로컬 구현을 따른다. 최종 검사 상태는 STATUS/HANDOFF에 기록한다.

현재 후속 UI 요청 **[P9-22](docs/work/P9-22.md)는 진행 중**이다. 네 시간대 의미 색상·굵은 고딕 사이드바 제목·직선 잔디를 저장했고, 승인 시안의 실제 사이드바·콜아웃·매뉴얼 위계 적용이 남아 있다. 응답 스트림 오류로 사용자 요청에 따라 세션을 인계하며 STATUS/HANDOFF의 재개 지점을 따른다.

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
