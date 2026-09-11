import { parseCookie, stringifySetCookie } from 'cookie';
export type AccessEnv = { SITE_PASSWORD_HASH?: string; SITE_SESSION_SECRET?: string };
const encoder = new TextEncoder();
const cookieName = '__Host-yifen-access';
const lifetime = 12 * 60 * 60;
const attempts = new Map<string, { count: number; until: number }>();
const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, '0')).join('');
const unhex = (value: string) => Uint8Array.from(value.match(/../g) || [], (n) => parseInt(n, 16));
const response = (body: unknown, status = 200, cookie?: string) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(cookie ? { 'Set-Cookie': cookie } : {}),
    },
  });
export async function passwordHash(
  password: string,
  salt = crypto.getRandomValues(new Uint8Array(16)),
) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const result = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new Uint8Array(salt), iterations: 100000, hash: 'SHA-256' },
    key,
    256,
  );
  return hex(salt) + ':' + hex(result);
}
function configured(env: AccessEnv) {
  return (
    /^[a-f0-9]{32}:[a-f0-9]{64}$/.test(env.SITE_PASSWORD_HASH || '') &&
    (env.SITE_SESSION_SECRET?.length || 0) >= 32
  );
}
async function signingKey(env: AccessEnv) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(env.SITE_SESSION_SECRET!),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}
const tokenData = (payload: string, env: AccessEnv) =>
  encoder.encode(payload + '.' + env.SITE_PASSWORD_HASH);
export async function validSession(request: Request, env: AccessEnv, now = Date.now()) {
  if (!configured(env)) return false;
  const token = parseCookie(request.headers.get('cookie') || '')[cookieName];
  if (!token || !/^\d{13}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(token)) return false;
  const [expires, nonce, signature] = token.split('.');
  if (Number(expires) <= now || Number(expires) > now + lifetime * 1000) return false;
  return crypto.subtle.verify(
    'HMAC',
    await signingKey(env),
    unhex(signature),
    tokenData(expires + '.' + nonce, env),
  );
}
function sessionCookie(value: string, maxAge: number) {
  return stringifySetCookie({
    name: cookieName,
    value,
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'strict',
    maxAge,
  });
}
// Returns null only for an authenticated non-auth API call. Static assets contain
// no private data; AccessGate withholds the app until this server check succeeds.
export async function authorize(request: Request, env: AccessEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return null;
  if (!configured(env)) return response({ error: '访问密码尚未配置，网站暂时不可用。' }, 503);
  const origin = request.headers.get('origin');
  if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site')
    return response({ error: '不允许跨站调用。' }, 403);
  if (url.pathname === '/api/auth/session' && request.method === 'GET')
    return response({ authenticated: await validSession(request, env) });
  if (['/api/auth/login', '/api/auth/logout'].includes(url.pathname)) {
    if (request.method !== 'POST') return response({ error: '请求方法不支持。' }, 405);
    if (
      request.headers.get('x-yifen-request') !== '1' ||
      request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
    )
      return response({ error: '请求来源或格式无效。' }, 403);
    if (url.pathname === '/api/auth/logout')
      return response({ authenticated: false }, 200, sessionCookie('', 0));
    const ip = request.headers.get('cf-connecting-ip') || 'local';
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    if (attempts.size > 2000) attempts.delete(attempts.keys().next().value!);
    const entry = attempts.get(ip) || { count: 0, until: now + 10 * 60 * 1000 };
    if (entry.count >= 8) return response({ error: '尝试次数过多，请十分钟后再试。' }, 429);
    // Count before awaiting parsing or hashing so concurrent attempts cannot skip the limit.
    entry.count++;
    attempts.set(ip, entry);
    try {
      const reader = request.body?.getReader();
      let text = '',
        size = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 1024) {
            await reader.cancel();
            return response({ error: '请求过大。' }, 413);
          }
          text += new TextDecoder().decode(value);
        }
      }
      const { password } = JSON.parse(text);
      if (typeof password !== 'string' || password.length < 1 || password.length > 256)
        return response({ error: '请输入访问密码。' }, 400);
      const actual = await passwordHash(password, unhex(env.SITE_PASSWORD_HASH!.split(':')[0]));
      let difference = 0;
      for (let i = 0; i < actual.length; i++)
        difference |= actual.charCodeAt(i) ^ env.SITE_PASSWORD_HASH!.charCodeAt(i);
      if (difference !== 0) return response({ error: '密码不正确，请重新输入。' }, 401);
      attempts.delete(ip);
      const payload =
        Date.now() + lifetime * 1000 + '.' + hex(crypto.getRandomValues(new Uint8Array(16)));
      const signature = hex(
        await crypto.subtle.sign('HMAC', await signingKey(env), tokenData(payload, env)),
      );
      return response(
        { authenticated: true },
        200,
        sessionCookie(payload + '.' + signature, lifetime),
      );
    } catch {
      return response({ error: '登录请求无效，请重试。' }, 400);
    }
  }
  if (!(await validSession(request, env)))
    return response({ error: '请先输入访问密码，或重新解锁网站。' }, 401);
  return null;
}
