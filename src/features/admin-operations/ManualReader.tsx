import { Link } from "react-router-dom";
import type { AdminTone } from "../../config/admin-help";
import { ServiceIcon } from "../../components/ServiceIcon";
import { AdminLabel, GuideText } from "../../components/AdminHelp";
import { AdminScreenshots } from "../../components/AdminScreenshots";
import type { AdminScreenshotId } from "../../config/admin-screenshots";
import { useRef, useState } from "react";
import { AdminIcon, type AdminIconName } from "../../components/AdminIcon";
import { AdminMenu, AdminMenuIcon } from "../../components/AdminMenu";
import { serviceRegistry, type ServiceId } from "../../config/service-registry";
import { serviceGuides } from "./service-guides";
import { ManualBody } from "./ManualText";
import { manualSections } from "./manual-sections";
import local from "./operations.module.css";
import css from "./manual-reader.module.css";

const shortTitles: Record<string, string> = {
  "guide-1": "사이트 소개", "guide-2": "화면과 기능 찾기", "guide-3": "퀴즈 만들기", "guide-4": "사이트의 작동 구조",
  "guide-5": "연습·운영 서버", "guide-6": "매주 할 일", "guide-7": "매월 비용 확인", "guide-8": "코드 수정과 배포",
  "guide-9": "오류가 났을 때", "guide-10": "백업과 복구", "guide-11": "개인정보와 성경 본문",
  "guide-12": "향후 기능", "guide-13": "안내문과 검사 기록", "guide-14": "용어 모아보기",
};
const examples: Record<string, readonly AdminScreenshotId[]> = {
  "guide-2": ["dashboard", "privacy"], "guide-3": ["input", "review", "settings"],
  "guide-6": ["submissions", "privacy"], "guide-7": ["operations"],
  "guide-9": ["review", "filters"], "guide-10": ["operations"], "guide-11": ["submissions", "filters"],
};
const daily = ["guide-3", "guide-2", "guide-6", "guide-7", "guide-9"];
const topicIcons: Record<string, AdminIconName> = {
  "guide-1": "book", "guide-2": "grid", "guide-3": "document", "guide-4": "flow",
  "guide-5": "cloud", "guide-6": "calendar", "guide-7": "chart", "guide-8": "code",
  "guide-9": "alert", "guide-10": "database", "guide-11": "shield", "guide-12": "edit",
  "guide-13": "document", "guide-14": "book",
};

const topicTones: Record<string, AdminTone> = {
  "guide-1": "guide", "guide-2": "action", "guide-3": "action", "guide-4": "guide",
  "guide-5": "attention", "guide-6": "attention", "guide-7": "attention", "guide-8": "action",
  "guide-9": "danger", "guide-10": "success", "guide-11": "danger", "guide-12": "guide",
  "guide-13": "success", "guide-14": "guide",
};
function TopicIcon({ id }: { id: string }) {
  return id.startsWith("service-") ? <ServiceIcon service={id.slice(8) as ServiceId}/>
    : <AdminIcon name={topicIcons[id] ?? "document"} tone={topicTones[id] ?? "guide"}/>;
}

export function ManualReader({ source }: { source: string }) {
  const sections = manualSections(source);
  const [selected, setSelected] = useState("guide-3");
  const heading = useRef<HTMLHeadingElement>(null);
  const services = serviceRegistry.map(service => ({ id: `service-${service.id}`, title: service.name }));
  const topics = sections.map(section => ({ id: section.id, title: /^\d+$/u.test(section.number) && source.includes(`## ${section.number}.`) ? shortTitles[section.id] ?? section.title : section.title }));
  const all = [...topics, ...services];
  const current = all.find(topic => topic.id === selected) ?? topics[0] ?? services[0]!;
  const section = sections.find(item => item.id === current.id);
  const service = serviceRegistry.find(item => `service-${item.id}` === current.id);
  const guide = service ? serviceGuides[service.id] : null;
  const groups = [
    { title: "퀴즈 운영", items: topics.filter(item => daily.includes(item.id)).sort((a,b) => daily.indexOf(a.id)-daily.indexOf(b.id)) },
    { title: "설정과 자료 보호", items: topics.filter(item => !daily.includes(item.id)) },
    { title: "서비스 사전", items: services },
  ].filter(group => group.items.length);
  const readingOrder = groups.flatMap(group => group.items);
  const next = readingOrder[(readingOrder.findIndex(item => item.id === current.id) + 1) % readingOrder.length];
  const category = groups.find(group => group.items.some(item => item.id === current.id))?.title ?? "운영 안내";
  function choose(id: string) {
    setSelected(id);
    requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      const box = heading.current?.getBoundingClientRect();
      if (box && (window.matchMedia("(max-width: 760px)").matches || box.top < 140 || box.bottom > window.innerHeight)) {
        heading.current?.scrollIntoView({block: "start", behavior: "instant"});
      }
    });
  }
  return <div className={css.reader}>
    <AdminMenu className={css.contents} label="매뉴얼 주제" selectionKey={current.id}>
      {groups.map((group, index) => {
        const items = <ul>{group.items.map(item => <li key={item.id}><button type="button" data-admin-menu-item aria-current={current.id === item.id ? "true" : undefined} onClick={() => choose(item.id)}><AdminMenuIcon><TopicIcon id={item.id}/></AdminMenuIcon><span>{item.title}</span></button></li>)}</ul>;
        return index === 0 ? <section key={group.title}><h3>{group.title}</h3>{items}</section>
          : <details key={group.title} open={group.items.some(item => item.id === current.id)}><summary>{group.title}<AdminIcon name="chevron"/></summary>{items}</details>;
      })}
    </AdminMenu>
    <label className={css.mobileTopics}>읽을 주제
      <select value={current.id} onChange={event => choose(event.target.value)}>{groups.map(group => <optgroup key={group.title} label={group.title}>{group.items.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</optgroup>)}</select>
    </label>
    <article className={css.article} data-topic={current.id} aria-labelledby="manual-article-title">
      <header className={css.articleHeader} data-admin-tone={topicTones[current.id] ?? "guide"}><p>{category}</p><h3 id="manual-article-title" tabIndex={-1} ref={heading}>{service && <TopicIcon id={current.id}/>}<span><AdminLabel text={section?.title ?? service?.name ?? "운영 안내"}/></span></h3>{service && <p className={css.subtitle}><code>{service.plainLanguageName}</code></p>}</header>
      {section && <ManualBody source={section.body}/>}
      {current.id === "guide-12" && <div className={css.futureRecord}><AdminIcon name="document" tone="action"/><div><Link to="/admin/manual/future/member-auth">기능 검토 기록</Link><p>회원 로그인 등 제안된 기능의 검토 내용을 읽어 보세요.</p></div></div>}
      {section && examples[current.id] && <AdminScreenshots key={current.id} ids={examples[current.id]!}/>}
      {service && guide && <div className={css.serviceReading}>
        <aside className={css.serviceIntro} aria-label="서비스 설명"><AdminIcon name="book" tone="action"/><p className={css.lead}>{guide.role}</p></aside>
        <dl className={local.guideFacts}>
          <div data-admin-tone="action"><dt><AdminLabel text="언제 쓰나요?"/></dt><dd><GuideText text={guide.when}/></dd></div>
          <div data-admin-tone="danger"><dt><AdminLabel text="문제가 생기면?"/></dt><dd><GuideText text={guide.failure}/></dd></div>
          <div data-admin-tone="attention"><dt><AdminLabel text="무엇을 확인하나요?"/></dt><dd><GuideText text={guide.check}/></dd></div>
        </dl>
        <a className={local.docLink} href={service.officialDocsUrl} target="_blank" rel="noreferrer">{service.name} 공식 안내 ↗</a>
        <details className={local.technical}><summary><AdminLabel text="연결 설정·비용 기록 자세히"/></summary>
          <p>설정을 점검할 때 참고하는 정보입니다. 평소 퀴즈를 운영할 때는 바꾸지 않아도 됩니다.</p>
          <dl className={local.guideFacts}>
            <div><dt>관리 화면에서 찾는 곳</dt><dd>{service.dashboardPath}</dd></div>
            <div><dt>기록된 요금 방식</dt><dd><p>{service.planAndCostType}</p><p>{service.freeAllowanceSummary}</p></dd></div>
            <div><dt>연결 이름</dt><dd>{service.secretAndBindingNames.length ? service.secretAndBindingNames.map(name => <code key={name}>{name}</code>) : "별도로 입력할 연결 이름이 없습니다."}</dd></div>
          </dl>
          <p className={local.note}>요금 정보 확인일: {service.pricingCheckedAt.slice(0, 10)}. 실시간 요금이나 남은 무료량이 아닙니다. 실제 비용은 공식 안내와 계정의 청구 화면에서 확인하세요.</p>
        </details>
      </div>}
      {next && next.id !== current.id && <footer className={css.next}><span>다음 안내</span><button type="button" onClick={() => choose(next.id)}>{next.title}<span aria-hidden="true">→</span></button></footer>}
    </article>
  </div>;
}
