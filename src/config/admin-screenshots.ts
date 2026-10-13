/** Real rendered app screens with synthetic examples; no production records. */
export const adminScreenshots = {
  dashboard: { title: '작성 중과 공개 중 구분하기', file: 'dashboard.png', alt: '퀴즈 관리 화면의 상태별 필터와 초안 편집·퀴즈 설정 버튼', caption: '작성 중인 퀴즈는 초안 편집, 공개한 퀴즈는 퀴즈 설정에서 이어 갑니다.' },
  input: { title: '설교 정보 확인하기', file: 'input.png', alt: '설교 영상 단계에서 제목·설교 날짜·성경 장절을 확인하는 화면', caption: '설교 제목·설교일·성경 장절을 확인합니다. 다음 단계에서는 설교 자료를 읽고 확정 여부를 확인하세요.' },
  review: { title: '요약과 두 난도를 각각 검수하기', file: 'review.png', alt: '요약·어린이·장년 검수 대상을 고르는 탭과 요약 편집란', caption: '요약·어린이·장년을 각각 선택해 내용을 검수합니다. 자동 저장과 검수 완료는 다른 단계입니다.' },
  settings: { title: '공개한 퀴즈의 설정 찾기', file: 'settings.png', alt: '발행 정보·접수 마감·결과와 순위 표시로 나뉜 퀴즈 설정 화면', caption: '제목 수정, 마감 변경, 결과에 표시할 인원은 각각의 항목을 펼쳐 설정합니다.' },
  submissions: { title: '숨김과 개인정보 삭제 구분하기', file: 'submissions.png', alt: '참여 기록의 공개 상태·개인정보 관리와 처리할 작업·사유 입력란', caption: '숨김은 다시 공개할 수 있습니다. 개인정보 삭제는 복구할 수 없으므로 대상과 영향을 확인하세요.' },
  privacy: { title: '문의에 답변하고 처리 상태 남기기', file: 'privacy.png', alt: '삭제 요청의 실제 조치 안내와 처리 상태·관리자 답변 입력란', caption: '실제 제출 삭제는 참여 기록에서 처리합니다. 이곳에서는 결과를 답변하고 문의 상태를 바꿉니다.' },
  filters: { title: '필터를 저장하기 전에 시험하기', file: 'filters.png', alt: '이름·문구 필터의 시험할 범위·시험 문구·저장 없이 시험 버튼', caption: '차단 여부 시험은 문구를 필터에 추가하지 않습니다. 현재 규칙이 어떻게 적용되는지 확인할 때 사용하세요.' },
  operations: { title: '비용과 최근 백업 함께 확인하기', file: 'operations.png', alt: '비용·백업 화면의 서비스 사용량·최근 정상 백업·상세 열기 버튼', caption: '기록된 사용량과 최근 정상 백업 시각을 확인합니다. 미확인은 사용량 0을 뜻하지 않습니다.' },
} as const;
export type AdminScreenshotId = keyof typeof adminScreenshots;
