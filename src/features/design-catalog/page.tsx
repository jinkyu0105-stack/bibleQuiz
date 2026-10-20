import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { GlassPanel } from "../../components/glass/GlassPanel";
import { GlassArrowButton } from "../../components/glass/GlassArrowButton";
import { QuizChoiceDialog } from "../../components/QuizChoiceDialog";
import { CompactSelect } from "../../components/CompactSelect";
import { AdminMenu, AdminMenuIcon } from "../../components/AdminMenu";
import { AdminIcon } from "../../components/AdminIcon";
import { AdminIndexedBoard, AdminRefreshButton } from "../../components/AdminListTools";
import { Tooltip } from "../../components/Tooltip";
import { Button } from "../../components/Button";
import styles from "./catalog.module.css";

const entries = [
  ["choice", "난이도 선택창"], ["arrow", "유리 화살표 버튼"], ["select", "연결형 선택기"], ["menu", "이동형 메뉴"],
  ["index", "파일 인덱스 탭"], ["refresh", "원형 새로고침"], ["tooltip", "작은 말풍선"],
  ["raised", "입체 작업 버튼"], ["actions", "기본 작업 버튼"], ["surface", "투명 창과 읽기 면"],
] as const;

function Sample({ id, name, component, children }: { id: string; name: string; component: string; children: ReactNode }) {
  return <section id={id} className={styles.sample} aria-labelledby={`${id}-title`}>
    <div className={styles.sampleHeading}><h3 id={`${id}-title`}>{name}</h3><code>{component}</code></div>
    {children}
  </section>;
}

/** Development-only catalogue: real shared components, isolated from saved quiz data. */
export function Component() {
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [message, setMessage] = useState("예시 버튼을 눌러보세요.");
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [menu, setMenu] = useState("quiz");
  const [filter, setFilter] = useState("all");
  return <div className={`design-catalog ${styles.catalog}`}>
    <GlassPanel surface="standard" className={styles.intro}>
      <h2>디자인 부품 모음</h2>
      <p>실제 화면에서 사용하는 부품입니다. 이름을 눌러 찾아가고, 마우스·키보드·터치로 움직임을 확인해 보세요.</p>
      <nav aria-label="부품 바로가기" className={styles.contents}>{entries.map(([id, name]) => <a key={id} href={`#${id}`}>{name}</a>)}</nav>
      <p className={styles.links}><Link to="/archive">지난 퀴즈에서 보기</Link><a href="/docs/design/phase-9/archive/refinement.html">주차 시안·헤더 너비 비교</a></p>
    </GlassPanel>
    <Sample id="choice" name="난이도 선택창" component="QuizChoiceDialog">
      <p>어린이·장년을 고르는 공통 모달 대화상자입니다. Esc로 닫으면 원래 버튼으로 돌아갑니다.</p>
      <Button onClick={() => setChoiceOpen(true)}>선택창 열기</Button>
      <QuizChoiceDialog open={choiceOpen} description="디자인 예시 · 선택하면 현재 퀴즈를 엽니다." choices={[{difficulty:"child",to:"/?level=child"},{difficulty:"adult",to:"/?level=adult"}]} onClose={() => setChoiceOpen(false)}/>
    </Sample>
    <Sample id="arrow" name="유리 화살표 버튼" component="GlassArrowButton">
      <p>지난 퀴즈 오른쪽에 추가한 바로 그 버튼입니다. 얇은 전체 테두리, 윗빛과 작은 그림자를 유지합니다.</p>
      <div className={styles.arrowExamples}>
        <div className={styles.inline}><Tooltip label="다음 예시 보기"><GlassArrowButton label="다음 예시 보기" onClick={() => setMessage("유리 화살표 버튼을 눌렀습니다.")}/></Tooltip><span>단독 버튼</span><GlassArrowButton label="사용할 수 없는 예시" disabled/><GlassArrowButton glyph="more" label="더보기 예시" onClick={() => setMessage("같은 유리 버튼의 더보기 변형입니다.")}/><span>더보기 변형</span></div>
        <button className={styles.demoRow} type="button" data-glass-arrow-group onClick={() => setMessage("행 어디를 눌러도 같은 동작입니다.")}><span><strong>행 전체와 함께 밝아지는 버튼</strong><small>지난 퀴즈 목록에서 쓰는 방식</small></span><GlassArrowButton decorative/></button>
      </div>
      <p className={styles.note}>버튼 그림은 32px, 단독 버튼의 누를 수 있는 영역은 44px입니다. 행 안에서는 전체 행이 반응합니다.</p>
    </Sample>
    <Sample id="select" name="연결형 선택기" component="CompactSelect">
      <p>클릭하면 추가 테두리 없이 바탕만 밝아집니다. 키보드로 이동하면 두 칸 모두 테두리로 위치를 알립니다.</p>
      <div className={styles.selectPair}>
        <CompactSelect label="연도 예시" value={year} onChange={e => setYear(e.target.value)}><option value="">모든 연도</option><option value="2026">2026년</option><option value="2025">2025년</option></CompactSelect>
        <CompactSelect label="월 예시" pointerFocus="surface" value={month} onChange={e => setMonth(e.target.value)}><option value="">모든 월</option><option value="10">10월</option><option value="9">9월</option></CompactSelect>
      </div>
    </Sample>
    <Sample id="menu" name="이동형 메뉴" component="AdminMenu">
      <p>선택 배경과 아이콘의 작은 받침이 한 덩어리로 이동합니다. 관리자 사이드바·도움말·초안 단계에서 함께 사용합니다.</p>
      <AdminMenu label="이동형 메뉴 예시" selectionKey={menu} className={styles.menu}>
        {([['quiz','grid','퀴즈 관리'],['records','people','참여 기록'],['help','book','도움말']] as const).map(([id,icon,label]) => <button key={id} type="button" data-admin-menu-item aria-current={menu === id ? "true" : undefined} onClick={() => setMenu(id)}><AdminMenuIcon><AdminIcon name={icon}/></AdminMenuIcon>{label}</button>)}
      </AdminMenu>
    </Sample>
    <Sample id="index" name="파일 인덱스 탭" component="AdminIndexedBoard">
      <p>탭끼리 붙고 선택한 탭의 바탕이 본문까지 이어집니다. 호버·선택 때 높이는 바뀌지 않습니다.</p>
      <AdminIndexedBoard label="인덱스 예시" value={filter} onChange={setFilter} options={[{value:'all',label:'전체',count:3},{value:'draft',label:'작성 중',count:1},{value:'published',label:'공개 중',count:2,tone:'success'}]}><p className={styles.indexContent}>{filter === 'all' ? '전체 항목' : filter === 'draft' ? '작성 중인 항목' : '공개 중인 항목'}을 선택했습니다.</p></AdminIndexedBoard>
    </Sample>
    <Sample id="refresh" name="원형 새로고침" component="AdminRefreshButton">
      <div className={styles.inline}><AdminRefreshButton label="예시 새로고침" onClick={() => setMessage("새로고침 버튼의 예시를 실행했습니다.")}/><p>목록을 다시 불러올 때 사용하는 공통 원형 버튼입니다.</p></div>
    </Sample>
    <Sample id="tooltip" name="작은 말풍선" component="Tooltip">
      <div className={styles.inline}><Tooltip label="공간이 충분하면 위에, 위가 좁으면 아래에 표시합니다.">{id => <Button aria-describedby={id}>말풍선 확인</Button>}</Tooltip><p>마우스를 올리거나 키보드로 선택해 보세요.</p></div>
    </Sample>
    <Sample id="raised" name="입체 작업 버튼" component="Button / ButtonLink · action-button-raised">
      <p>관리자 화면의 일반 작업 버튼에 공통으로 사용하는 스타일입니다. 주요 버튼은 진한 색, 보조 버튼은 옅은 색을 유지합니다. 은은한 윗빛과 얕은 그림자, 눌렀을 때의 작은 움직임을 공유합니다.</p>
      <div className={styles.inline}><Button variant="primary" className="action-button-raised" onClick={() => setMessage("입체 주요 버튼을 눌렀습니다.")}>새 퀴즈 만들기 ＋</Button><Button className="action-button-raised" onClick={() => setMessage("입체 보조 버튼을 눌렀습니다.")}>공개 화면 ↗</Button></div>
    </Sample>
    <Sample id="actions" name="기본 작업 버튼" component="Button / ButtonLink">
      <div className={styles.inline}><Button variant="primary" onClick={() => setMessage("주요 작업 버튼을 눌렀습니다.")}>입력 확인</Button><Button onClick={() => setMessage("보조 작업 버튼을 눌렀습니다.")}>정답 보기</Button><Button disabled>사용 불가</Button></div>
      <p className={styles.note}>핵심 행동은 진한 색, 보조 행동은 옅은 바탕으로 구분합니다.</p>
    </Sample>
    <Sample id="surface" name="투명 창과 읽기 면" component="GlassPanel">
      <GlassPanel surface="standard" className={styles.surfaceExample}><strong>투명한 외곽</strong><p>하늘이 비치는 제목·안내 영역입니다.</p><div className={styles.readingExample}><strong>불투명한 읽기 면</strong><p>격자·목록·본문을 안정적으로 읽는 영역입니다.</p></div></GlassPanel>
    </Sample>
    <p className={styles.feedback} role="status">{message}</p>
  </div>;
}
