import { writeFile } from "node:fs/promises";

const output = process.argv[2];
if (!output) throw new Error("Output path is required");

const ids = [
  ...Array.from({ length: 100 }, (_, index) => `p527-typical-${index.toString().padStart(3, "0")}`),
  ...Array.from({ length: 100 }, (_, index) => `p527-boundary-${index.toString().padStart(3, "0")}`),
  "p527-concurrent",
];

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const statements = [
  `INSERT INTO bible_translations (id,display_name,edition,publisher_or_rightsholder,mode,status,created_at,updated_at) VALUES ('p527-translation','TEST_ONLY','reference-only','TEST_ONLY','reference_only','pending','2026-09-13T00:00:00.000Z','2026-09-13T00:00:00.000Z');`,
];

for (let start = 0; start < ids.length; start += 25) {
  const values = ids.slice(start, start + 25).map((id) => `(${[
    id,
    id,
    "TEST_ONLY",
    `https://example.invalid/${id}`,
    id,
    "TEST_ONLY",
    "2026-09-13",
    "p527-translation",
    "[]",
    "TEST_ONLY",
    "2026-09-13T00:00:00.000Z",
    "2026-09-13T00:00:00.000Z",
  ].map(quote).join(",")})`).join(",\n");
  statements.push(`INSERT INTO sermons (id,slug_suffix,church_name,youtube_url,youtube_video_id,sermon_title,sermon_date,bible_translation_id,bible_reference_json,bible_reference_label,created_at,updated_at) VALUES\n${values};`);
}

await writeFile(output, `${statements.join("\n")}\n`, { encoding: "utf8", flag: "wx" });
