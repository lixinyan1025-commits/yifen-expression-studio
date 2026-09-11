import {
  type Config,
  serviceStatus,
  serviceFailure,
  topic,
  transcribe,
  analyze,
} from '../server/services';
import { z } from 'zod';
import { authorize, type AccessEnv } from './auth';
// Workers prohibit runtime code generation. Use Zod's interpreted validators.
z.config({ jitless: true });

export type Env = Partial<
  Record<
    | 'AI_BASE_URL'
    | 'AI_API_KEY'
    | 'STT_BASE_URL'
    | 'STT_API_KEY'
    | 'TOPIC_MODEL'
    | 'AUDIO_MODEL'
    | 'STT_MODEL',
    string
  >
> &
  AccessEnv & {
    ASSETS?: { fetch(request: Request): Promise<Response> };
  };
const limit = 20 * 1024 * 1024;
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });

// Every API call is protected by our signed password session, independent of
// the hosting platform's audience settings or client-supplied identity headers.
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const gate = await authorize(request, env);
  if (gate) return gate;
  if (!url.pathname.startsWith('/api/')) {
    if (!env.ASSETS) return new Response('页面资源尚未就绪', { status: 503 });
    return env.ASSETS.fetch(request);
  }
  const origin = request.headers.get('origin');
  if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site')
    return json({ error: '不允许跨站调用。' }, 403);
  const config: Config = {
    aiBase: env.AI_BASE_URL || 'https://api.openai.com/v1',
    aiKey: env.AI_API_KEY || '',
    sttBase: env.STT_BASE_URL || 'https://api.openai.com/v1',
    sttKey: env.STT_API_KEY || env.AI_API_KEY || '',
    topicModel: env.TOPIC_MODEL || 'gpt-4o-mini',
    audioModel: env.AUDIO_MODEL || 'gpt-audio',
    sttModel: env.STT_MODEL || 'whisper-1',
  };
  if (url.pathname === '/api/status' && request.method === 'GET')
    return json({ ...serviceStatus(config), runtime: 'cloud' });
  if (request.method !== 'POST') return json({ error: '接口不存在或请求方法不支持。' }, 404);
  if (
    request.headers.get('x-yifen-request') !== '1' ||
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  )
    return json({ error: '请求来源或格式无效。' }, 403);
  if (Number(request.headers.get('content-length')) > limit)
    return json({ error: '请求过大，请缩短录音。' }, 413);
  try {
    // Limit the streamed body too; Content-Length is not trusted.
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > limit) {
          await reader.cancel();
          return json({ error: '请求过大，请缩短录音。' }, 413);
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (url.pathname === '/api/vault')
      return json({
        configured: false,
        notes: [],
        rootPath: '',
        rootId: '',
        syncedAt: new Date().toISOString(),
      });
    const routes = { '/api/topic': topic, '/api/transcribe': transcribe, '/api/analyze': analyze };
    const handle = routes[url.pathname as keyof typeof routes];
    if (!handle) return json({ error: '接口不存在。' }, 404);
    return json(await handle(config, body));
  } catch (error) {
    const failure = serviceFailure(error);
    return json(failure.body, failure.status);
  }
}
export default { fetch: handleRequest };
