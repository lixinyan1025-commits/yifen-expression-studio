import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { handleRequest } from '../worker';
import { encodeWav } from '../shared/audio';
import { fixtureReport, fixtureSegments, tone } from './fixtures';
const origin = 'https://private-site.test';
const identity = { 'oai-authenticated-user-id': 'TEST_GATEWAY_ID' };
const headers = { ...identity, 'content-type': 'application/json', 'x-yifen-request': '1', origin };
const post = (path: string, body: unknown, extra = {}) =>
  new Request(origin + path, {
    method: 'POST',
    headers: { ...headers, ...extra },
    body: JSON.stringify(body),
  });

test('cloud routes require gateway identity, reject cross-site calls and never expose secrets or local vault', async () => {
  assert.equal((await handleRequest(new Request(origin + '/api/status'), {})).status, 401);
  const emailIdentity = await handleRequest(
    new Request(origin + '/api/status', {
      headers: { 'oai-authenticated-user-email': 'TEST_OWNER@example.invalid' },
    }),
    {},
  );
  assert.equal(emailIdentity.status, 200);
  assert.equal(
    (await handleRequest(post('/api/vault', {}, { origin: 'https://evil.test' }), {})).status,
    403,
  );
  assert.equal(
    (await handleRequest(post('/api/vault', {}, { 'x-yifen-request': '' }), {})).status,
    403,
  );
  const status = await handleRequest(new Request(origin + '/api/status', { headers: identity }), {
    AI_API_KEY: 'TEST_SECRET',
  });
  const result = await status.json();
  assert.equal(result.runtime, 'cloud');
  assert.equal(result.ai, true);
  assert.ok(!JSON.stringify(result).includes('TEST_SECRET'));
  const vault = await (await handleRequest(post('/api/vault', { path: 'C:/' }), {})).json();
  assert.equal(vault.configured, false);
  assert.deepEqual(vault.notes, []);
  assert.equal((await handleRequest(post('/api/transcribe', {}), {})).status, 503);
});

test('cloud body limit applies to streamed bytes even without Content-Length', async () => {
  const request = new Request(origin + '/api/analyze', {
    method: 'POST',
    headers,
    body: ' '.repeat(20 * 1024 * 1024 + 1),
  });
  assert.equal(request.headers.has('content-length'), false);
  assert.equal((await handleRequest(request, {})).status, 413);
});

test('cloud adapter preserves exact audio, transcript timestamps and grounded analysis across HTTP provider calls', async (t) => {
  const bytes = encodeWav(tone(6), 24000);
  const audio = Buffer.from(bytes).toString('base64');
  let analyzedAudio = '';
  const provider = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    res.setHeader('Content-Type', 'application/json');
    if (req.url?.includes('transcriptions')) {
      assert.ok(body.includes(Buffer.from(bytes)));
      res.end(
        JSON.stringify({
          text: fixtureSegments.map((s) => s.text).join(''),
          segments: fixtureSegments,
        }),
      );
    } else {
      analyzedAudio = JSON.parse(body.toString()).messages[1].content[1].input_audio.data;
      res.end(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(fixtureReport()) } }] }),
      );
    }
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    provider.closeAllConnections();
    provider.close();
  });
  const base = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
  const env = {
    AI_API_KEY: 'TEST_ONLY',
    STT_API_KEY: 'TEST_ONLY',
    AI_BASE_URL: base,
    STT_BASE_URL: base,
  };
  const tr = await handleRequest(post('/api/transcribe', { audio, threshold: 1.5 }), env);
  assert.equal(tr.status, 200);
  const transcript = await tr.json();
  assert.deepEqual(transcript.segments, fixtureSegments);
  const ar = await handleRequest(
    post('/api/analyze', { audio, threshold: 1.5, transcript, topic: '你会怎么行动？', notes: [] }),
    env,
  );
  assert.equal(ar.status, 200);
  assert.equal(analyzedAudio, audio);
  const report = await ar.json();
  assert.ok(report.issues.length > 0);
  assert.ok(
    report.issues.every(
      (issue: { start: number; end: number }) => issue.start >= 0 && issue.end <= 6,
    ),
  );
});
