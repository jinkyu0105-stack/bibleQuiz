// One explicit trial; writes private output, never retries or changes app data.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const [modulePath, video, output] = process.argv.slice(2);
if (!modulePath || !/^[A-Za-z0-9_-]{11}$/.test(video ?? '') || !output) throw Error('Expected module, video ID, new private output directory');
await mkdir(output, { mode: 0o700 });
const moduleSha256 = createHash('sha256').update(await readFile(modulePath)).digest('hex');
const { createAccountlessPublicTranscriptProvider } = await import(pathToFileURL(resolve(modulePath)));
const started = Date.now();
// Pass native Node fetch exactly as the original runner did.
const result = await createAccountlessPublicTranscriptProvider({ fetcher: fetch }).inspectVideo({ video });
await writeFile(resolve(output, 'result-private.json'), JSON.stringify(result), { mode: 0o600, flag: 'wx' });
const r = result.result;
const report = { moduleSha256, runtime: process.version, elapsedMs: Date.now() - started, outcome: r.outcome,
  code: r.code ?? null, diagnostic: r.diagnostic, segments: r.transcript?.segments.length ?? null,
  characters: r.transcript ? [...r.transcript.segments.map(s => s.text).join('\n')].length : null };
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify(report));
