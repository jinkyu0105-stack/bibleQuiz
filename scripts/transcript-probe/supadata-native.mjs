// Isolated, explicitly authorized probe. No production bindings or AI fallback.
import { z } from 'zod';
const language = z.enum(['ko', 'ko-KR']);
const segment = z.object({
  text: z.string().min(1), offset: z.number().finite().nonnegative(),
  duration: z.number().finite().nonnegative(), lang: language,
});
const transcript = z.object({
  content: z.array(segment).min(1), lang: language,
  availableLangs: z.array(z.string()).optional(),
});
const job = z.object({ jobId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) });
const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('fetch'), videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/) }).strict(),
  z.object({ action: z.literal('status'), jobId: job.shape.jobId }).strict(),
]);
async function readLimited(response) {
  const reader = response.body?.getReader();
  if (!reader) throw Error('EMPTY_RESPONSE');
  let bytes = 0;
  const chunks = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1_048_576) throw Error('RESPONSE_TOO_LARGE');
      chunks.push(part.value);
    }
    const all = new Uint8Array(bytes);
    let cursor = 0;
    for (const chunk of chunks) { all.set(chunk, cursor); cursor += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all));
  } finally { await reader.cancel().catch(() => {}); }
}
export async function probe(requestInput, apiKey, fetcher = fetch) {
  const parsed = input.safeParse(requestInput);
  if (!parsed.success || !apiKey) return { outcome: 'invalid_input' };
  const command = parsed.data;
  const url = new URL('https://api.supadata.ai/v1/transcript');
  if (command.action === 'fetch') {
    url.searchParams.set('url', `https://www.youtube.com/watch?v=${command.videoId}`);
    url.searchParams.set('mode', 'native');
    url.searchParams.set('lang', 'ko');
    url.searchParams.set('text', 'false');
  } else url.pathname += '/' + command.jobId;
  const started = Date.now();
  let status = null;
  try {
    const response = await fetcher(url.toString(), {
      headers: { 'x-api-key': apiKey }, redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
    status = response.status;
    if (!response.ok) { await response.body?.cancel(); return { outcome: 'upstream_error', httpStatus: status, elapsedMs: Date.now() - started }; }
    const body = await readLimited(response);
    if (status === 202) {
      const pending = job.safeParse(body);
      return pending.success ? { outcome: 'pending', jobId: pending.data.jobId, httpStatus: status }
        : { outcome: 'invalid_job', httpStatus: status };
    }
    if (command.action === 'status' && ['queued', 'active'].includes(body?.status)) {
      return { outcome: 'pending', jobId: command.jobId, httpStatus: status };
    }
    if (body?.status === 'failed') return { outcome: 'job_failed', httpStatus: status };
    const data = transcript.safeParse(body);
    if (!data.success) return { outcome: 'invalid_or_non_korean_transcript', httpStatus: status };
    const rows = data.data.content;
    if (rows.some((row, i) => i > 0 && row.offset < rows[i - 1].offset)) return { outcome: 'invalid_timing', httpStatus: status };
    const characters = [...rows.map(row => row.text).join('\n')].length;
    if (characters > 30_000) return { outcome: 'transcript_too_long', httpStatus: status, characters };
    return { outcome: 'fetched', httpStatus: status, elapsedMs: Date.now() - started,
      segments: rows.length, characters, privateTranscript: data.data };
  } catch {
    // Do not echo upstream messages, URLs, API credentials, or response bodies.
    return { outcome: 'network_or_response_failed', httpStatus: status, elapsedMs: Date.now() - started };
  }
}
export default {
  async fetch(request, env) {
    if (!env.PROBE_AUTH || request.headers.get('Authorization') !== `Bearer ${env.PROBE_AUTH}`) return new Response(null, { status: 401 });
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (Number(request.headers.get('Content-Length') ?? '0') > 1024) return new Response(null, { status: 413 });
    let command;
    try { command = JSON.parse(await request.text()); } catch { return new Response(null, { status: 400 }); }
    return Response.json(await probe(command, env.SUPADATA_API_KEY), { headers: { 'Cache-Control': 'no-store' } });
  },
};
