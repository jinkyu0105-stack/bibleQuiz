import { useId, useRef, useState } from "react";
import { adminScreenshots, type AdminScreenshotId } from "../config/admin-screenshots";
import { AdminEmoji } from "./AdminHelp";
import css from "./admin-screenshots.module.css";

function Screenshot({ id }: { id: AdminScreenshotId }) {
  const example = adminScreenshots[id];
  const src = `/images/admin-guide/${example.file}`;
  const label = useId(), description = useId();
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [opened, setOpened] = useState(false), [actualSize, setActualSize] = useState(false);
  function close() { dialog.current?.close(); }
  return <figure className={css.figure}>
    <button ref={trigger} type="button" className={css.thumbnail} aria-haspopup="dialog" aria-label={`${example.title} 화면 확대`}
      onClick={() => { setOpened(true); setActualSize(false); dialog.current?.showModal(); }}>
      <img src={src} alt={example.alt} loading="lazy" width="1100" height="680"/>
      <span className={css.enlarge} aria-hidden="true">⤢ 크게 보기</span>
    </button>
    <figcaption><strong>{example.title}</strong><span>{example.caption}</span></figcaption>
    <dialog ref={dialog} className={css.viewer} aria-labelledby={label} aria-describedby={description}
      onKeyDown={event => {
        if (event.key !== "Tab") return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]');
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); } }}
      onClose={() => { setOpened(false); trigger.current?.focus({preventScroll: true}); }}>
      <header><div><p>실제 화면 · 연습 자료 예시</p><h3 id={label}>{example.title}</h3></div><button type="button" className={css.close} onClick={close} autoFocus>닫기 <span aria-hidden="true">×</span></button></header>
      <div className={css.viewActions}><button type="button" aria-pressed={actualSize} onClick={() => setActualSize(value => !value)}>{actualSize ? '화면에 맞추기' : '원본 크기로 보기'}</button><span>Esc로도 닫을 수 있습니다.</span></div>
      <div className={css.imageArea} tabIndex={0} role="region" aria-label="확대한 화면" data-actual-size={actualSize || undefined}>{opened && <img src={src} alt={example.alt}/>}</div>
      <p id={description} className={css.caption}>{example.caption}</p>
    </dialog>
  </figure>;
}
export function AdminScreenshots({ ids, compact = false }: { ids: readonly AdminScreenshotId[]; compact?: boolean }) {
  const content = <><p className={css.note}>연습 자료로 캡처한 실제 화면입니다. 작은 이미지를 누르면 크게 볼 수 있습니다.</p><div className={css.gallery}>{ids.map(id => <Screenshot key={id} id={id}/>)}</div></>;
  return compact ? <details className={css.disclosure} data-admin-screenshots><summary><AdminEmoji>🖼️</AdminEmoji>화면 예시로 살펴보기</summary>{content}</details>
    : <section className={css.examples} aria-label="화면 예시" data-admin-screenshots><h4><AdminEmoji>🖼️</AdminEmoji>화면으로 살펴보기</h4>{content}</section>;
}
