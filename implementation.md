# BibleQuiz 상세 명세 목차

제품 기준은 아래 분야별 정본과 [DECISIONS](docs/DECISIONS.md), 현재 상태는 [STATUS](docs/STATUS.md), 정확한 다음 동작은 [HANDOFF](docs/HANDOFF.md)를 따른다. 완료한 P5~P8-01 검수는 재사용하며 [DELIVERY_PLAN](docs/DELIVERY_PLAN.md)의 종료 조건은 유지한다.

현재 **P8-02 마무리 준비 중**이다. Supadata 자동 자막·새 설교 실제 AI 생성·사람 검수·3단어 시험 발행과 첫 주간 SQL 예약 백업을 확인했다. 같은 후보의 더 큰 격자로 원래 목표 개수도 오프라인 성공했으며 [배치 원인·출시 점검](docs/work/p8-02/closeout-review.md)에 원인/수정안과 청구 미확인 경계를 정리했다. 격자 자동 제안·후보 생성 조건 개선과 관리자 UI 개편은 [향후 계획](docs/future/notes.md)에 기록했다. 청구 화면 확인과 Supadata 비용/사용량 목록 보완이 남아 전체v1 완료 선언이나 새 기능/발행본 변경은 하지 않았다. [운영 연결](docs/work/p8-02/supadata-integration.md)·[운영 합의](docs/work/P8-02.md)·[운영 매뉴얼](docs/operations-manual.md)을 따르고 기존 자료·키·유료 결과·0000~0038을 보존한다.

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
