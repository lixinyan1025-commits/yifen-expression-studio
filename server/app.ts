import express from 'express';
import { readVault } from './vault';
import { type Config, serviceStatus, serviceFailure, topic, transcribe, analyze } from './services';
export type { Config } from './services';
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
  app.get('/api/status', (_req, res) => res.json({ ...serviceStatus(config), runtime: 'local' }));
  app.post('/api/vault', async (_req, res) => res.json(await readVault(config.vaultPath)));
  for (const [name, handle] of Object.entries({ topic, transcribe, analyze })) {
    app.post('/api/' + name, async (req, res) => res.json(await handle(config, req.body)));
  }
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在。' }));
  const handleError: express.ErrorRequestHandler = (err, _req, res, _next) => {
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: '请求过大，请减少笔记内容或缩短录音。' });
      return;
    }
    const failure = serviceFailure(err);
    res.status(failure.status).json(failure.body);
  };
  app.use(handleError);
  return app;
}
