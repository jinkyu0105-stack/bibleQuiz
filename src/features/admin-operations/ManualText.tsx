import { Fragment } from "react";
import local from "./operations.module.css";

/** A small, escaped Markdown subset for our repository-owned operator guides. */
function Inline({ text }: { text: string }) {
  return <>{text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/u).map((part, index) =>
    part.startsWith("`") && part.endsWith("`") ? <code key={index}>{part.slice(1, -1)}</code>
      : part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong>
        : <Fragment key={index}>{part.split(/ {2}\n/u).map((line, i) => <Fragment key={i}>{i > 0 && <br/>}{line}</Fragment>)}</Fragment>)}</>;
}
function Blocks({ source }: { source: string }) {
  return <div className={local.prose}>{source.trim().split(/\n\n+/u).filter(Boolean).map((block, index) => {
    const lines = block.split("\n");
    if (block.startsWith("```")) return <pre key={index}><code>{block.replace(/^```[^\n]*\n|\n```$/gu, "")}</code></pre>;
    if (/^###? /u.test(block)) return <h4 key={index}><Inline text={block.replace(/^#+ /u, "")}/></h4>;
    if (lines.every(line => /^\d+\. /u.test(line))) return <ol key={index}>{lines.map((line, i) => <li key={i}><Inline text={line.replace(/^\d+\. /u, "")}/></li>)}</ol>;
    if (lines.every(line => line.startsWith("- "))) return <ul key={index}>{lines.map((line, i) => <li key={i}><Inline text={line.slice(2)}/></li>)}</ul>;
    if (block.startsWith("> ")) return <aside className={local.callout} key={index}><Inline text={block.replace(/^> ?/gmu, "")}/></aside>;
    return <p key={index}><Inline text={block}/></p>;
  })}</div>;
}
export function ManualText({ source }: { source: string }) {
  return <div className={local.manual}>{source.split(/(?=^## )/mu).filter(section => section.trim()).map((section, index) => {
    const [heading = "", ...lines] = section.split("\n");
    const content = lines.join("\n").trim().replace(/^마지막 문서 갱신: \d{4}-\d{2}-\d{2}\.\s*/u, "").trim();
    if (!heading.startsWith("## ")) return content ? <Blocks key={index} source={content}/> : null;
    return <details key={index}><summary><Inline text={heading.replace(/^## /u, "")}/></summary><div><Blocks source={content}/></div></details>;
  })}</div>;
}
