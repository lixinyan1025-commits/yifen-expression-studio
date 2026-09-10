import { z } from 'zod';
import { decodeWav, measureAudio } from '../shared/audio';
import { groundReport, validateTranscript } from './validation';
import { analysisPrompt, topicPrompt } from './prompts';

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
async function hashAudio(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}
function readAudio(encoded: string, threshold: number) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('录音编码无效。');
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
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
export class ServiceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function serviceStatus(config: Config) {
  return {
    appId: 'yifen-expression',
    ai: !!config.aiKey,
    stt: !!config.sttKey,
    aiHost: providerHost(config.aiBase),
    sttHost: providerHost(config.sttBase),
    topicModel: config.topicModel,
    audioModel: config.audioModel,
    sttModel: config.sttModel,
  };
}
export async function topic(config: Config, body: unknown) {
  if (!config.aiKey) {
    throw new ServiceError(503, '未配置 AI 服务。可以先使用内置场景题。');
  }
  const context = z
    .object({ category: z.string().min(1).max(40), seed: z.string().min(1).max(400) })
    .parse(body);
  const raw = await upstream(config.aiBase, config.aiKey, 'chat/completions', {
    model: config.topicModel,
    messages: [
      { role: 'system', content: topicPrompt },
      { role: 'user', content: JSON.stringify(context) },
    ],
  });
  const result = z
    .object({
      text: z.string().min(10).max(160),
      category: z.string().min(1).max(40),
      reading: z
        .array(z.object({ title: z.string().min(1).max(30), text: z.string().min(20).max(180) }))
        .length(3),
    })
    .parse(parseCompletion(raw));
  if (/请.{0,8}(复述|背诵|解释.{0,4}概念)|答题框架|参考答案/.test(result.text))
    throw new Error('生成题目泄露了学习线索或不符合场景要求，请重试。');
  return { ...result, id: crypto.randomUUID(), source: 'ai', noteIds: [] };
}
export async function transcribe(config: Config, body: unknown) {
  if (!config.sttKey) {
    throw new ServiceError(503, '未配置语音转写服务。录音已保存，可配置后重试。');
  }
  const input = audioRequest.parse(body);
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
  return {
    ...validateTranscript(raw, facts.duration),
    model: config.sttModel,
    audioHash: await hashAudio(bytes),
  };
}
export async function analyze(config: Config, body: unknown) {
  if (!config.aiKey) {
    throw new ServiceError(503, '未配置音频 AI 分析服务。录音和转写已保存，可配置后重试。');
  }
  const input = audioRequest
    .extend({ transcript: transcriptSchema, topic: z.string().min(1).max(500), notes: noteList })
    .parse(body);
  const { bytes, facts } = readAudio(input.audio, input.threshold);
  if (input.transcript.audioHash !== (await hashAudio(bytes)))
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
  return groundReport(parseCompletion(raw), validated.segments, facts, input.notes);
}
export function serviceFailure(err: unknown) {
  if (err instanceof z.ZodError)
    return {
      status: 422,
      body: { error: '请求或服务返回的数据结构不符合约定，无法可靠分析。请检查模型兼容性并重试。' },
    };
  return {
    status: err instanceof ServiceError ? err.status : 400,
    body: { error: err instanceof Error ? err.message : '处理失败，请重试。' },
  };
}
