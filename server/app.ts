import express from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { decodeWav, measureAudio } from '../shared/audio';
import { groundReport, validateTranscript } from './validation';
import { analysisPrompt, topicPrompt } from './prompts';
import { readVault } from './vault';

export type Config = {
  aiBase: string;
  aiKey: string;
  sttBase: string;
  sttKey: string;
  topicModel: string;
  audioModel: string;
  sttModel: string;
  vaultPath?: string;
};
const noteSchema = z.object({
  id: z.string().max(100),
  title: z.string().max(500),
  body: z.string().max(1000000),
  tags: z.array(z.string().max(200)).max(200),
});
const noteList = z.array(noteSchema).max(3);
const audioRequest = z.object({
  audio: z.string().min(60).max(18000000),
  threshold: z.number().min(0.5).max(5),
});
const transcriptSchema = z.object({
  text: z.string().max(30000),
  segments: z
    .array(
      z.object({
        id: z.number().int(),
        text: z.string().max(10000),
        start: z.number(),
        end: z.number(),
      }),
    )
    .max(500),
  model: z.string(),
  audioHash: z.string(),
});
const briefNotes = (notes: z.infer<typeof noteList>) =>
  notes.map((n) => ({ ...n, body: n.body.slice(0, 8000) }));
const hashAudio = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function readAudio(encoded: string, threshold: number) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('录音编码无效。');
  const bytes = Buffer.from(encoded, 'base64');
  const { samples, sampleRate } = decodeWav(bytes);
  const facts = measureAudio(samples, sampleRate, threshold);
  if (facts.activeSeconds < 0.25 || facts.rms < 0.001)
    throw new Error('录音中没有足够的可用声音。请检查麦克风，回听后重新挑战。');
  return { bytes, facts };
}
function providerHost(base: string) {
  try {
    return new URL(base).host;
  } catch {
    return '地址无效';
  }
}
async function upstream(base: string, key: string, path: string, body: FormData | object) {
  const url = new URL(base);
  if (
    url.username ||
    url.password ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new Error('服务地址须为 HTTPS，或本机 HTTP 地址。');
  const form = body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/$/, '')}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        ...(!form ? { 'Content-Type': 'application/json' } : {}),
      },
      body: form ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
  } catch {
    throw new Error('服务连接中断或超过两分钟未响应。录音仍在本机，可稍后重试。');
  }
  if (!response.ok)
    throw new Error(
      `服务请求失败（HTTP ${response.status}）。请检查服务端密钥、模型权限、余额及接口兼容性，然后重试。`,
    );
  const text = await response.text();
  if (text.length > 2000000) throw new Error('服务返回数据过大。');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('服务没有返回有效 JSON。请检查接口地址与格式。');
  }
}
function parseCompletion(raw: any) {
  const content = raw?.choices?.[0]?.message?.content;
  if (typeof content !== 'string')
    throw new Error('模型没有返回文本分析。请选择支持音频输入和文本输出的模型。');
  try {
    return JSON.parse(
      content
        .trim()
        .replace(/^```(?:json)?\s*/, '')
        .replace(/\s*```$/, ''),
    );
  } catch {
    throw new Error('模型报告格式无效，已保留录音与转写，请重试分析。');
  }
}
export function createApp(config: Config) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const host = req.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) {
      res.status(403).json({ error: '此版本仅供本机使用。' });
      return;
    }
    if (
      req.headers.origin &&
      req.headers.origin !== `http://${host}` &&
      req.headers.origin !== `https://${host}`
    ) {
      res.status(403).json({ error: '不允许跨站调用。' });
      return;
    }
    if (
      req.method === 'POST' &&
      (req.headers['x-yifen-request'] !== '1' || !req.is('application/json'))
    ) {
      res.status(403).json({ error: '请求来源或格式无效。' });
      return;
    }
    next();
  });
  app.use(express.json({ limit: '20mb' }));
  app.get('/api/status', (_req, res) =>
    res.json({
      appId: 'yifen-expression',
      ai: !!config.aiKey,
      stt: !!config.sttKey,
      aiHost: providerHost(config.aiBase),
      sttHost: providerHost(config.sttBase),
      topicModel: config.topicModel,
      audioModel: config.audioModel,
      sttModel: config.sttModel,
    }),
  );
  app.post('/api/vault', async (_req, res) => {
    // The browser cannot supply a path. Only the explicitly configured local directory is readable.
    res.json(await readVault(config.vaultPath));
  });
  app.post('/api/topic', async (req, res) => {
    if (!config.aiKey) {
      res.status(503).json({ error: '未配置 AI 服务。可以先使用内置场景题。' });
      return;
    }
    const notes = noteList.min(1).parse(req.body.notes);
    const raw = await upstream(config.aiBase, config.aiKey, 'chat/completions', {
      model: config.topicModel,
      messages: [
        { role: 'system', content: topicPrompt },
        { role: 'user', content: JSON.stringify(briefNotes(notes)) },
      ],
    });
    const result = z
      .object({ text: z.string().min(15).max(400), category: z.string().min(1).max(40) })
      .parse(parseCompletion(raw));
    if (
      notes.some((n) => n.title.length >= 2 && result.text.includes(n.title)) ||
      /请.{0,8}(复述|背诵|解释.{0,4}概念)|答题框架|参考答案/.test(result.text)
    )
      throw new Error('生成题目泄露了学习线索或不符合场景要求，请重试。');
    res.json({ ...result, id: crypto.randomUUID(), source: 'ai', noteIds: notes.map((n) => n.id) });
  });
  app.post('/api/transcribe', async (req, res) => {
    if (!config.sttKey) {
      res.status(503).json({ error: '未配置语音转写服务。录音已保存，可配置后重试。' });
      return;
    }
    const input = audioRequest.parse(req.body);
    const { bytes, facts } = readAudio(input.audio, input.threshold);
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }), 'speech.wav');
    form.set('model', config.sttModel);
    form.set('language', 'zh');
    form.set('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    form.set(
      'prompt',
      '以下是中文即兴演讲逐字原文。保留嗯、呃、那个、就是说等口头禅、重复起头、语病和未完成句，不润色，不补全。',
    );
    const raw = await upstream(config.sttBase, config.sttKey, 'audio/transcriptions', form);
    res.json({
      ...validateTranscript(raw, facts.duration),
      model: config.sttModel,
      audioHash: hashAudio(bytes),
    });
  });
  app.post('/api/analyze', async (req, res) => {
    if (!config.aiKey) {
      res.status(503).json({ error: '未配置音频 AI 分析服务。录音和转写已保存，可配置后重试。' });
      return;
    }
    const input = audioRequest
      .extend({ transcript: transcriptSchema, topic: z.string().min(1).max(500), notes: noteList })
      .parse(req.body);
    const { bytes, facts } = readAudio(input.audio, input.threshold);
    if (input.transcript.audioHash !== hashAudio(bytes))
      throw new Error('转写与录音不匹配，请重新转写。');
    const validated = validateTranscript(input.transcript, facts.duration);
    const raw = await upstream(config.aiBase, config.aiKey, 'chat/completions', {
      model: config.audioModel,
      modalities: ['text'],
      messages: [
        { role: 'system', content: analysisPrompt },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                topic: input.topic,
                segments: validated.segments,
                pauses: facts.pauses,
                duration: facts.duration,
                threshold: input.threshold,
                notes: briefNotes(input.notes),
              }),
            },
            { type: 'input_audio', input_audio: { data: input.audio, format: 'wav' } },
          ],
        },
      ],
    });
    res.json(groundReport(parseCompletion(raw), validated.segments, facts, input.notes));
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在。' }));
  const handleError: express.ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof z.ZodError) {
      res.status(422).json({
        error: '请求或服务返回的数据结构不符合约定，无法可靠分析。请检查模型兼容性并重试。',
      });
      return;
    }
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: '请求过大，请减少笔记内容或缩短录音。' });
      return;
    }
    res.status(400).json({ error: err instanceof Error ? err.message : '处理失败，请重试。' });
  };
  app.use(handleError);
  return app;
}
