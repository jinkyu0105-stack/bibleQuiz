# 프로젝트 맥락

> 프로젝트: 다사랑교회 「이번 주의 말씀 : 낱말 퀴즈」  
> 문서 역할: 제품 목표·사용자·범위·기술 구조의 짧은 입문서  
> 마지막 확인: 2026-08-29, Asia/Seoul

## 1. 한 문장 목표

다사랑교회의 주간 설교 영상을 바탕으로 어린이용·장년용 한글 가로세로 낱말퀴즈를 만들고, 교인이 휴대전화·태블릿·PC에서 풀고 제출·채점·참여 현황·Top N을 확인하며, 주보용 빈 격자와 벽보용 결과물을 쉽게 출력하는 반응형 웹앱을 만든다.

## 2. 사용자와 운영 규모

- 방문자: 회원가입 없이 퀴즈를 풀어 보는 교인
- 참여자: 이름, 일부 또는 전체 답안, 선택 코멘트를 제출하는 익명 브라우저 세션 사용자
- 관리자: 매주 YouTube 링크에서 자막·설교 의도·문제 후보·격자·발행을 검수하는 운영자 1명
- 출력 담당자: 컴퓨터 사용에 익숙하지 않아도 빈 격자와 Top N 결과물을 받을 수 있어야 하는 교회 담당자
- 예상 규모: 주간 방문자 약 30명, 제출자 10~20명, 동시 접속은 몰려도 50명 이하
- 프로젝트 성격: 교회 공식 웹앱이 아니라 개인이 교회 공동체를 위해 운영하는 프로젝트
- 운영 방식: 사용자는 코드를 거의 직접 읽지 않고 앞으로도 AI 도움을 받아 운영·개발한다.

## 3. 핵심 제품 흐름

```text
관리자: YouTube 링크
  → 공개 자막 가져오기 또는 텍스트 직접 붙여넣기
  → 사람 수정 / 선택적 AI 오타 교정과 diff
  → 설교 의도 분석·관리자 수정·확정
  → 문제 후보 생성·관리자 제외/수정
  → 코드가 격자 크기·단어 조합·교차 배치를 계산
  → 어린이용·장년용 검수 후 발행

참여자: 퀴즈 풀이
  → 한 글자 이상 작성한 부분 답안도 제출 가능
  → 서버 채점과 내 답안/정답 비교
  → 진행 중에는 제출자만 참여 현황·Top N·Top N 출력 접근
  → 마감 뒤에는 누구나 정답·참여 현황·Top N·출력 접근
```

빈 문제지의 번호 있는 격자와 단서 텍스트는 누구나 사용할 수 있다. 주보 편집자는 빈 격자 PNG/SVG를 내려받고 단서 텍스트는 별도로 복사해 배치한다. Top N 화면은 완전 정답자를 제출 순으로 정렬해 A4 인쇄에 맞춘다.

## 4. 현재 기술 구조

```text
GitHub main
  → Cloudflare Workers Builds
  → Access 보호 biblequiz-app-preview
     ├─ Static Assets: React SPA
     ├─ Hono /api/*: TypeScript 백엔드
     └─ D1 binding: biblequiz-d1-preview

향후 내부 전용
  ├─ biblequiz-content: 자막·OpenAI·초안 Workflow
  └─ biblequiz-backup: D1 export·비공개 R2 백업 Workflow
```

- 프런트엔드: React 19, React Router Data Mode, Vite, TypeScript strict, Tailwind CSS v4
- 백엔드: Cloudflare Worker, Hono
- 데이터: Cloudflare D1, Drizzle ORM, 검토된 SQL migration
- 비동기 작업: Cloudflare Workflows
- 비공개 백업: D1 Time Travel + R2 Standard 주간 SQL 백업 정상본 8개 순환
- 관리자 인증: Cloudflare Access의 `Cloudflare account / Allow`
- 패키지: Node.js 24.18.0, pnpm 11.14.0, `pnpm-lock.yaml` 단일 lockfile
- AI: OpenAI API, 설교 의도 품질을 우선하는 여러 단계 호출과 비용 기록

## 5. 환경 분리

| 환경 | 역할 | 현재 상태 |
|---|---|---|
| Local | fixture, Local D1, 단위·통합 테스트 | 사용 중 |
| Preview | `biblequiz-app-preview`, `biblequiz-d1-preview`, Access 보호 | 연결·배포 완료 |
| Production | 실제 공개 Worker·D1·도메인 | 아직 생성·연결하지 않음 |

`main` push는 현재 Production이 아니라 고정 Preview Worker에 자동 배포된다. Production 자원은 별도 사용자 승인과 출시 리허설 전까지 만들지 않는다.

## 6. v1 범위

포함:

- 최신 퀴즈, 아직 참여 가능한 퀴즈, 지난 퀴즈 아카이브
- 어린이용·장년용, 5×5~10×10 관리자 시험·선택
- 한글 IME 입력, 로컬 임시 저장, 부분 답안 제출
- 서버 채점, 내 답안/정답 비교, 참여 현황, 완전 정답자 Top N
- 관리자 자막 수정, 선택적 AI 교정 diff, 설교 의도·문제 후보 검수, 발행·마감
- 이름·코멘트 필터, 사칭 방지, 관리자 숨김·복구·삭제
- 주보용 빈 격자 PNG/SVG와 복사 가능한 단서, A4 Top N PNG/PDF
- 라이트 Everforest, 다크 Gruvbox, 크게 보기, 반응형·접근성
- 문의·삭제 요청 폼과 접수번호 기반 처리 상태 확인

제외 또는 보류:

- 일반 사용자 회원가입과 교회 공식 계정 연동
- 네이티브 모바일 앱
- 교회 YouTube 계정 OAuth와 새 영상 자동 감지
- 비공식 YouTube 음원 다운로드
- 공개 이미지용 R2 또는 KV
- 현금·상품이 걸린 대회 수준의 강한 신원 확인

## 7. 변경하면 안 되는 핵심 경계

- 성경 본문을 AI가 생성·번역·교정·보완하지 않는다.
- v1은 개역개정 본문 전문을 저장·복사·인쇄하지 않고 장절, 판본명, 대한성서공회 공식 읽기 링크만 제공한다.
- 제출 전 공개 브라우저에 공식 정답을 보내지 않는다.
- AI 요약을 설교자의 원문처럼 표시하지 않는다.
- 발행 후 첫 제출이 생긴 퍼즐의 격자와 정답을 직접 수정하지 않는다.
- 사용자 입력을 HTML로 해석하지 않는다.
- 이미지 다운로드를 위해 AI를 다시 호출하지 않는다.
- Production, 결제 기능, 새 유료 외부 서비스는 사용자 승인 없이 추가하지 않는다.

## 8. 프로젝트의 공식 기억

- 실제 구현 사실: 코드, 테스트, migration, Wrangler 설정, Git 기록
- 상세 제품 의도: 루트의 `implementation.md`
- 중요한 선택 이유: `docs/DECISIONS.md`
- 현재 완료 상태: `docs/STATUS.md`
- 다음 task 인수인계: `docs/HANDOFF.md`

요약 문서가 코드와 다르면 실제 구현 상태는 코드를 우선해 확인하되, 계획과 다른 구현을 정당화하지 않는다. 차이를 먼저 알리고 코드 또는 문서를 함께 고친다.
