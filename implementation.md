# BibleQuiz 상세 명세 목차

제품 기준은 아래 분야별 정본과 [DECISIONS](docs/DECISIONS.md), 현재 상태는 [STATUS](docs/STATUS.md), 정확한 다음 동작은 [HANDOFF](docs/HANDOFF.md)를 따른다. 완료한 P5~P8-01 검수는 재사용하며 [DELIVERY_PLAN](docs/DELIVERY_PLAN.md)의 종료 조건은 유지한다.

이전 **P8-02·Phase8은 완료**했다. 운영 자동 자막·실제 AI 생성/사람 검수·시험 발행·대표 공개 경로·백업/운영 검수, 캐시 저장 비용 수정 배포와 공급자 청구 대조를 마쳤다. OpenAI5회/USD0.57, Cloudflare2026년10월 현재 예상 사용료0은 사용자 확인 근거이며 미래 청구 보장은 아니다. [최종 판정·배포 버전·관측 한계](docs/work/p8-02/closeout-review.md#운영-반영청구-대조종료--2026-10-06)와 [인계](docs/HANDOFF.md)를 따른다. 관리자 UI 조사는 Phase9에서 시작했다. 격자/후보 개선·Supadata 사용량 등 나머지 [향후 계획](docs/future/notes.md)은 별도 사용자 선택 전 착수하지 않는다. 기존 자료·키·유료 결과·0000~0038과 승인된 운영/복구 합의를 보존한다.

현재 **Phase9의 이번 승인 범위는 완료**했다. [P9-01 조사](docs/work/P9-01.md) → [P9-02 승인 시안 기반 프런트엔드 개편·CI 수정](docs/work/P9-02.md) → 사용자 명시 승인에 따른 [P9-04 운영 배포](docs/work/P9-04.md)를 마쳤다. P9-03은 P9-02에 통합된 제안으로 재사용하지 않는다. 공개·관리자 기존 기능과 실제 자료를 보존했으며 새 AI/DB migration 없이 앱만 갱신했다. 실제 소스·버전·명령·알려진 한계는 STATUS/HANDOFF와 P9-04를 따른다. 추가 시안 검수를 새 필수 단계로 두지 않는다.

Air 계승 하늘·유리 UI는 [P9-06](docs/work/P9-06.md)에서 실제 React 화면에 연결했다. 메인 탐색·버튼·관리자 정보 구조는 P9-07~22에서 보정했으며, 현재 UI 기준은 [디자인 정본](docs/spec/design.md)을 따른다. 이전 숲·종이 기준은 종료했다. 실제 Preview/Production 소스와 배포 상태는 [STATUS](docs/STATUS.md)·[HANDOFF](docs/HANDOFF.md)에서 확인한다.

완료한 **[P9-23](docs/work/P9-23.md)**은 관리자 안내·게시판·도구/초안 편집의 투명 외곽과 읽기 면, 의미 색상·말풍선·실제 화면 예시와 홈 효과를 포함한다. 홈의 반사/빛줄기는 메인 첫 구역에서만 동작하며, 같은 유리 호버를 쓰는 아이콘 메뉴에서 켜고 끈다. 빛줄기는 광원 너비·밝기·퍼짐, 반사는 밝기·물결 크기·흐름 속도를 인접 제어판에서 바꾼다. 초기에는 화면에 필요 없는 유리 지도·구름·풀이 코드를 준비하지 않으며 영상/효과/유리 모양을 유지한다. 메인의 마지막 목록은 제목 오른쪽 원형 링크로 작게 정리하고 푸터까지 이어지며, 스크롤 중에만 무거운 유리 굴절·흐림을 쉬게 한다. 밤빛은 기존 달 방향을 따른다. 사용자는2026-10-15 검사 뒤 main push를 승인했으며 이는 Preview 자동 배포만 포함한다. 구현·중간 실패·최종 검사·배포 대조는 [P9-23 현재 기록](docs/work/P9-23.md#초기-로딩과-반사-조절-후속)을 따른다. Production·원격 자료·실제 AI는 변경하지 않는다.

**[P9-24](docs/work/P9-24.md)는 완료**했다. 메인 첫 구역의 빛줄기 속도·비단결(Silk Flow)·오로라(Aurora Spire)와 독립 설정을 공통 효과 제어에 추가했고, 기존 영상/유리·성능 제한을 보존했다. 직전본은 전체 검사와 승인된 main push/Preview 반영을 확인했고, 후속 속도·흩어지는 결 보정도 P9-25와 함께 Preview에 반영했다. [현재 디자인](docs/spec/design.md#비단결오로라와-개별-흐름-속도--p9-24)을 따른다.

**[P9-25](docs/work/P9-25.md)**는 오로라 제거, 모바일 헤더 한 줄, 모든 일반 페이지의 공통 플로팅 바로가기와 네 번째 화면 설정 팝업이다. 후속으로 새로고침 때 소개를 먼저 표시하고 자료 대기를 퀴즈 영역에 한정한다. 현재 세 효과와 모바일 기준은 [디자인 정본](docs/spec/design.md#p9-25-모바일-헤더와-화면-설정)을 따른다.

**[P9-26](docs/work/P9-26.md)**은 공개 퀴즈 풀이의 데스크톱/모바일 리디자인이다. 풀이 시안4장과 실제 격자·단서·제출·출력 도구의 적용/검수를 포함하며 입력/공개 정책은 보존한다. 추가 요청한 지난 퀴즈 탐색은 별도의 웹/모바일 시안2장과 검색·연속 목록·행 전체 클릭과 난이도 선택창을 포함한다. 후속 월별 주제 입력·저장, 헤더 난이도 선택창 및 초광폭 원인/비교는 [현재 디자인](docs/spec/design.md#p9-26-월별-주제선택창초광폭-비교--2026-10-20)을 따른다. 공통 부품 모음·주차·선택기·푸터와 헤더 비교는 [부품·화면 외곽 기준](docs/spec/design.md#p9-26-공통-부품주차화면-외곽-보정--2026-10-19)을 따른다. [디자인 정본](docs/spec/design.md#p9-26-공개-풀이-화면--2026-10-16).

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
