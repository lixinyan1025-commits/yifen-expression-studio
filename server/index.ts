import { config as dotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { createApp } from './app';
const root = fileURLToPath(new URL('..', import.meta.url));
dotenv({ path: path.join(root, '.env'), quiet: true });
const aiKey = process.env.AI_API_KEY || '';
const app = createApp({
  aiBase: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
  aiKey,
  sttBase: process.env.STT_BASE_URL || 'https://api.openai.com/v1',
  sttKey: process.env.STT_API_KEY || aiKey,
  topicModel: process.env.TOPIC_MODEL || 'gpt-4o-mini',
  audioModel: process.env.AUDIO_MODEL || 'gpt-audio',
  sttModel: process.env.STT_MODEL || 'whisper-1',
  vaultPath: process.env.OBSIDIAN_WISDOM_PATH || undefined,
});
if (process.argv.includes('--dev')) {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
}
const port = Number(process.env.PORT || 4317);
app.listen(port, '127.0.0.1', () => console.log(`一分 · 表达练习室 http://localhost:${port}`));
