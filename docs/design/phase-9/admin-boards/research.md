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


## 2026-10-14 선택 표면과 읽기 층 재검토

이번에는 사용자 주석의 문의 생성 이미지를 최우선 시각 기준으로 삼았다. 새 참고 사이트 목록을 늘리는 대신 실제로 적용할 규칙을 공식 문서와 대조했다. `pnpm dlx ctx7@latest`의 library 검색으로 `/microsoft/fluentui`를 확인한 뒤 Nav/현재 위치/아이콘 접근성 문서를 조회했다. 프로젝트의 React19.2.8/CSS를 유지하며 Fluent UI 패키지를 설치하거나 호환을 가정하지 않았다.

- [Fluent2 Elevation](https://fluent2.microsoft.design/elevation): 면 사이의 관계를 작은 접촉 그림자와 부드러운 그림자로 구별한다. 이를 메뉴의 밝은 선택 면과1px 윗빛에 적용했다. 기존 유리 굴절 위에 또 렌즈를 얹지는 않는다.
- [Fluent2 Nav](https://fluent2.microsoft.design/components/web/react/core/nav/usage/): 짧은 메뉴 이름·그룹·현재 위치 표시와 기존 아이콘의 의미를 유지한다. 앱과 도움말에서 같은 메뉴 코드를 공유하며 호버를 실제 선택으로 바꾸지 않는다.
- [Carbon Tabs](https://www.carbondesignsystem.com/building-blocks/core/components/tabs/guidelines): 탭과 내용 영역의 시각적 연결을 참고한다. 이 앱은 목록 필터이므로 기존 `role=group`/`aria-pressed`를 보존하며, 외형 때문에 ARIA 탭 동작을 임의 추가하지 않는다.

구현에 반영한 판단은 선택한 탭만 강조하고 비선택 탭의 강한 경계를 없애는 것, 모든 탭의 실제 글자 기준선을 같게 두는 것, 메뉴 선택 면을 공유하는 것, 도움말 본문만 불투명한 한 장으로 묶는 것이다. 공식 라이브러리를 그대로 구현했다거나 새 스타일이 사용자의 미감 승인을 받았다는 뜻은 아니다. 이번에 `last30days`를 다시 실행하지 않았으며 위의 최근30일 조사 날짜와 한계는 그대로다.
