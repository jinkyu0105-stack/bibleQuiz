export function manualSections(source: string) {
  return source.split(/(?=^## )/mu).filter(section => section.startsWith("## ")).map((section, index) => {
    const [heading = "", ...lines] = section.split("\n");
    const title = heading.replace(/^## (?:\d+\.\s*)?/u, "");
    const number = heading.match(/^## (\d+)\./u)?.[1] ?? String(index + 1);
    return { id: `guide-${number}`, title, body: lines.join("\n").trim(), number };
  });
}
