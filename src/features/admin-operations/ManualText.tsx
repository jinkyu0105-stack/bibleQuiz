import { adminTerms, adminTextTones, type AdminTerm } from "../../config/admin-help";
import { AdminLabel, GuideText, HelpTerm } from "../../components/AdminHelp";
import { AdminIcon } from "../../components/AdminIcon";
import local from "./operations.module.css";

/** A small, escaped Markdown subset for our repository-owned operator guides. */
function Sentence({ text }: { text: string }) {
  return <GuideText text={text.replace(/\s*\n\s*/gu, " ")}/>;
}
function Inline({ text }: { text: string }) {
  return <>{text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/u).map((part, index) =>
    part.startsWith("`") && part.endsWith("`") ? <code key={index} data-admin-tone={adminTextTones[part.slice(1, -1)]}>{Object.hasOwn(adminTerms, part.slice(1, -1)) ? <HelpTerm term={part.slice(1, -1) as AdminTerm}/> : part.slice(1, -1)}</code>
      : part.startsWith("**") && part.endsWith("**") ? <strong key={index} data-admin-tone={adminTextTones[part.slice(2, -2)]}><AdminLabel text={part.slice(2, -2)} explain/></strong>
        : <Sentence key={index} text={part}/>)}</>;
}
export function ManualBody({ source }: { source: string }) {
  return <div className={local.prose}>{source.trim().split(/\n\n+/u).filter(Boolean).map((block, index) => {
    const lines = block.split("\n");
    if (block.startsWith("```")) return <pre key={index}><code>{block.replace(/^```[^\n]*\n|\n```$/gu, "")}</code></pre>;
    if (/^###? /u.test(block)) return <h4 key={index}><Inline text={block.replace(/^#+ /u, "")}/></h4>;
    if (lines.every(line => /^\d+\. /u.test(line))) return <ol key={index} role="list">{lines.map((line, i) => <li key={i} data-admin-tone={adminTextTones[line.match(/\*\*([^*]+)\*\*/u)?.[1] ?? ""]}><Inline text={line.replace(/^\d+\. /u, "")}/></li>)}</ol>;
    if (lines.every(line => line.startsWith("- "))) return <ul key={index}>{lines.map((line, i) => <li key={i}><Inline text={line.slice(2)}/></li>)}</ul>;
    if (block.startsWith("> ")) return <aside className={local.callout} aria-label="주의" key={index}><AdminIcon name="alert"/><div><Inline text={block.replace(/^> ?/gmu, "")}/></div></aside>;
    return <p key={index}><Inline text={block}/></p>;
  })}</div>;
}
export function ManualText({ source }: { source: string }) {
  return <div className={local.manual}>{source.split(/(?=^## )/mu).filter(section => section.trim()).map((section, index) => {
    const [heading = "", ...lines] = section.split("\n");
    const content = lines.join("\n").trim().replace(/^마지막 문서 갱신: \d{4}-\d{2}-\d{2}\.\s*/u, "").trim();
    if (!heading.startsWith("## ")) return content ? <ManualBody key={index} source={content}/> : null;
    return <details key={index}><summary><Inline text={heading.replace(/^## /u, "")}/></summary><div><ManualBody source={content}/></div></details>;
  })}</div>;
}
