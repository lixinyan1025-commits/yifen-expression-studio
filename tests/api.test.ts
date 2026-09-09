import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createApp, type Config } from '../server/app';
import { encodeWav } from '../shared/audio';
import { fixtureReport, fixtureSegments, tone } from './fixtures';
const headers = { 'Content-Type': 'application/json', 'X-Yifen-Request': '1' };
const listen = async (server: ReturnType<typeof createServer>) => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};
test('real HTTP adapter sends exact WAV bytes, preserves STT and grounds AI against the same hash', async (t) => {
  let audioInput = '',
    formContent = '',
    mode = 'ok';
  const provider = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'fail') {
      res.writeHead(503);
      res.end('{}');
      return;
    }
    if (req.url?.includes('transcriptions')) {
      formContent = body.toString('latin1');
      res.end(
        JSON.stringify({
          text: fixtureSegments.map((s) => s.text).join(''),
          segments: fixtureSegments,
        }),
      );
    } else {
      const request = JSON.parse(body.toString());
      audioInput = request.messages[1].content[1].input_audio.data;
      res.end(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(fixtureReport()) } }] }),
      );
    }
  });
  const base = await listen(provider);
  const config: Config = {
    aiBase: base,
    sttBase: base,
    aiKey: 'TEST_ONLY_KEY',
    sttKey: 'TEST_ONLY_KEY',
    topicModel: 'test',
    audioModel: 'test',
    sttModel: 'test',
  };
  const server = createServer(createApp(config));
  const url = await listen(server);
  t.after(() => {
    server.closeAllConnections();
    server.close();
    provider.closeAllConnections();
    provider.close();
  });
  const bytes = encodeWav(tone(6), 24000),
    encoded = Buffer.from(bytes).toString('base64');
  const tr = await fetch(`${url}/api/transcribe`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ audio: encoded, threshold: 1.5 }),
  });
  assert.equal(tr.status, 200);
  const transcript = await tr.json();
  assert.equal(transcript.audioHash, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(transcript.segments, fixtureSegments);
  assert.ok(formContent.includes('timestamp_granularities[]'));
  assert.ok(formContent.includes('verbose_json'));
  assert.ok(formContent.includes(Buffer.from(bytes).toString('latin1')));
  const payload = {
    audio: encoded,
    threshold: 1.5,
    topic: '你会怎么行动？',
    transcript,
    notes: [],
  };
  const analysis = await fetch(`${url}/api/analyze`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  assert.equal(analysis.status, 200);
  const report = await analysis.json();
  assert.equal(audioInput, encoded);
  assert.equal(report.issues[0].start, 0);
  const mismatch = await fetch(`${url}/api/analyze`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, transcript: { ...transcript, audioHash: 'wrong' } }),
  });
  assert.equal(mismatch.status, 400);
  assert.match((await mismatch.json()).error, /不匹配/);
  mode = 'fail';
  const failed = await fetch(`${url}/api/analyze`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  assert.match((await failed.json()).error, /503/);
  const silent = await fetch(`${url}/api/transcribe`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      audio: Buffer.from(encodeWav(new Float32Array(24000), 24000)).toString('base64'),
      threshold: 1.5,
    }),
  });
  assert.match((await silent.json()).error, /没有足够/);
});
test('unconfigured services are explicit and cross-origin callers cannot spend API keys', async (t) => {
  const server = createServer(
    createApp({
      aiBase: 'https://example.com/v1',
      sttBase: 'https://example.com/v1',
      aiKey: '',
      sttKey: '',
      topicModel: 'test',
      audioModel: 'test',
      sttModel: 'test',
    }),
  );
  const url = await listen(server);
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const status = await (await fetch(`${url}/api/status`)).json();
  assert.equal(status.ai, false);
  assert.equal(status.stt, false);
  assert.equal('aiKey' in status, false);
  const missing = await fetch(`${url}/api/transcribe`, { method: 'POST', headers, body: '{}' });
  assert.equal(missing.status, 503);
  const cross = await fetch(`${url}/api/analyze`, {
    method: 'POST',
    headers: { ...headers, Origin: 'https://evil.example' },
    body: '{}',
  });
  assert.equal(cross.status, 403);
  const noHeader = await fetch(`${url}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(noHeader.status, 403);
});
