🌐 last30days v3.26.0 · synced 2026-10-13

What I learned:

**이 프로젝트의 AI용 시각 참고처로는 Refero Styles를 우선 추천한다.** 색·글꼴·간격·컴포넌트를 DESIGN.md로 읽을 수 있다. 현재 하늘·투명 콘셉트와 한글 서체를 유지하면서 참고 규칙을 추출하기에 적합하다. 다만 Styles는 주로 마케팅/제품 사이트이므로 관리자 목록 동작까지 그대로 해결해 주지는 않는다. [공식 Styles](https://styles.refero.design/) · [공식 범위 설명](https://github.com/referodesign/refero_skill/blob/master/skills/refero-design/references/mcp-tools.md).

**게시판·폼 세부 기준은 Carbon과 Geist가 더 직접적이다.** Carbon의 목록 구조와 펼침 콘텐츠, Geist의 버튼 종류·크기·상태를 참고해 기존 React/CSS 컴포넌트에 적용했다. 외부 브랜드의 폰트·색·유료 코드를 가져오지 않았다. [Carbon](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines) · [Geist](https://vercel.com/geist/button).

**실제 제품 흐름은 Mobbin, 코드 기반 출발점은 shadcn/ui가 강점이다.** Mobbin MCP는 Pro·Team에 제공되므로 이번 무료 작업에서는 연결하지 않았다. shadcn/ui는 AI가 읽을 수 있는 공개 컴포넌트 코드가 장점이지만, 현재 CSS 앱을 바꾸는 비용을 고려해 새 패키지는 넣지 않았다. Untitled UI는 완성된 컴포넌트 참고 후보지만 무료·유료 자산 경계를 확인해야 한다. Radix Themes도 문서화된 기본 요소를 참고할 수 있다. [Mobbin](https://mobbin.com/mcp) · [shadcn/ui](https://ui.shadcn.com/docs) · [Untitled UI](https://www.untitledui.com/faqs) · [Radix](https://www.radix-ui.com/themes/docs/overview/getting-started).

**최근 30일 커뮤니티만으로 특정 사이트를 1위라고 단정할 근거는 부족했다.** 2026-09-13~10-13의 Reddit 20건·Hacker News 11건을 읽었다. 디자인 규칙이 흐트러지는 문제와 AI 결과를 사람이 다시 다듬는 경험이 보였지만, 추천 서비스 간 직접 비교는 드물었다. 따라서 위 추천은 이 프로젝트의 요구와 공식 문서를 대조한 판단이다. [디자인 규칙 불일치 논의](https://www.reddit.com/r/DesignSystems/comments/1x427ka/for_teams_using_ai_coding_tools_cursor_claude_v0/) · [AI 결과 검토 경험](https://www.reddit.com/r/UI_Design/comments/1x0llrx/claude_design_is_awful_so_where_is_ai_actually/).

KEY PATTERNS from the research:

1. 참고 이미지만 전달하지 않고 글꼴·선·간격·상태 규칙을 문서와 공통 코드에 함께 남긴다.
2. 화면을 바꿀 때마다 새 스타일을 만들지 않고 같은 목록 도구·행·버튼을 재사용한다.
3. 새벽·낮·노을·밤, PC·모바일, 펼침·오류·키보드 상태에서 실제로 대조한다.

한계: 일부 Reddit 목록 보충 조회에서 HTTP422가 발생했다. X·YouTube는 이번 공개 자료 경로에 포함되지 않았다. 브라우저 쿠키·설치·유료 서비스 설정은 추가하지 않았다. 원자료는 ignored `.wrangler/releases/p9-23/research/`에 보존했다.

---
✅ All agents reported back!
├─ 🟠 Reddit: 20 threads │ 245 upvotes │ 375 comments
├─ 🟡 HN: 11 storys │ 211 points │ 163 comments
├─ 🗣️ Top voices: r/DesignSystems, r/UI_Design, r/UIUX
├─ 🕒 Recent evidence is thin: only 9 of 31 dated items are from the last 7 days.
└─ 📎 Raw results saved to ~/work/bibleQuiz/.wrangler/releases/p9-23/research/ui-design-references-and-ai-readable-design-systems-refero-mobbin-shadcn-and-carbon-raw.md
---
