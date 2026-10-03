export function QuizLoading() {
  return <section className="quiz-loading" role="status" aria-label="퀴즈를 불러오고 있습니다.">
    <p>퀴즈를 불러오고 있습니다.</p>
    <div className="loading-title" aria-hidden="true" />
    <div className="loading-meta" aria-hidden="true" />
    <div className="loading-workspace" aria-hidden="true"><div /><div /></div>
  </section>;
}
