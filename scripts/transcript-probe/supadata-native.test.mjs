import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { probe } from './supadata-native.mjs';
const command = { action: 'fetch', videoId: 'TEST_ONLY01' };
const good = { lang: 'ko', content: [{ text: '합성 자막', offset: 0, duration: 1000, lang: 'ko' }] };
test('only native Korean captions are requested once; key stays out of results', async () => {
  let calls = 0;
  const result = await probe(command, 'SYNTHETIC_KEY', async (url, init) => {
    calls++;
    const u = new URL(url);
    assert.equal(u.origin, 'https://api.supadata.ai');
    assert.equal(u.searchParams.get('mode'), 'native');
    assert.equal(u.searchParams.get('lang'), 'ko');
    assert.equal(u.searchParams.get('text'), 'false');
    assert.equal(init.headers['x-api-key'], 'SYNTHETIC_KEY');
    assert.equal(init.redirect, 'manual');
    return Response.json(good);
  });
  assert.equal(calls, 1); assert.equal(result.outcome, 'fetched');
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_KEY'));
});
test('rejects other-language fallback, empty and unsorted transcripts', async () => {
  for (const body of [
    { ...good, lang: 'en' }, { ...good, content: [] },
    { ...good, content: [{ ...good.content[0], lang: 'en' }] },
    { ...good, content: [{ ...good.content[0], offset: 2 }, good.content[0]] },
  ]) assert.notEqual((await probe(command, 'synthetic', async () => Response.json(body))).outcome, 'fetched');
});
test('errors do not retry or leak bodies; pending jobs are returned without re-requesting', async () => {
  let calls = 0;
  const denied = await probe(command, 'synthetic', async () => { calls++; return new Response('SYNTHETIC_PRIVATE_ERROR', { status: 429 }); });
  assert.equal(calls, 1); assert.equal(denied.outcome, 'upstream_error');
  assert.ok(!JSON.stringify(denied).includes('SYNTHETIC_PRIVATE_ERROR'));
  const pending = await probe(command, 'synthetic', async () => Response.json({ jobId: 'synthetic-job' }, { status: 202 }));
  assert.equal(pending.outcome, 'pending');
  await probe({ action: 'status', jobId: pending.jobId }, 'synthetic', async url => {
    assert.equal(url, 'https://api.supadata.ai/v1/transcript/synthetic-job'); return Response.json({ ...good, status: 'completed' });
  });
});
test('invalid inputs and unauthorized remote requests make no external calls', async () => {
  for (const bad of [{ ...command, videoId: 'https://example.com/file.mp4' }, { ...command, mode: 'generate' }]) {
    const result = await probe(bad, 'synthetic', () => { throw Error('must not fetch'); });
    assert.equal(result.outcome, 'invalid_input');
  }
  const response = await worker.fetch(new Request('https://example.invalid/', { method: 'POST' }), { PROBE_AUTH: 'synthetic' });
  assert.equal(response.status, 401);
});

test('Cloudflare native fetch supports the request options and never follows redirects', async () => {
  const { createRequire } = await import('node:module');
  const requireFromWrangler = createRequire(import.meta.resolve('wrangler'));
  const { Miniflare, convertV4MiniflareOptions } = requireFromWrangler('miniflare');
  const { build } = requireFromWrangler('esbuild');
  const { fileURLToPath } = await import('node:url');
  const source = `import {probe} from './supadata-native.mjs'; export default {async fetch(){return Response.json(await probe({action:'fetch',videoId:'TEST_ONLY01'},'synthetic'));}}`;
  const bundle = await build({ stdin: { contents: source, resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, write: false, format: 'esm', platform: 'browser' });
  for (const redirect of [false, true]) {
    let calls = 0;
    const runtime = new Miniflare(convertV4MiniflareOptions({
      modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-25',
      outboundService: async request => {
        calls++;
        assert.equal(new URL(request.url).searchParams.get('mode'), 'native');
        return redirect ? new Response(null, { status: 302, headers: { Location: 'https://example.invalid/never-follow' } }) : Response.json(good);
      },
    }));
    try {
      const result = await (await runtime.dispatchFetch('https://example.invalid')).json();
      assert.equal(result.outcome, redirect ? 'upstream_error' : 'fetched');
      assert.equal(calls, 1);
    } finally { await runtime.dispose(); }
  }
});
