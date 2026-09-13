import 'dotenv/config';
import { createCipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readVault } from '../server/vault.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const password = process.env.YIFEN_BUNDLE_PASSWORD;
const vaultPath = process.env.OBSIDIAN_WISDOM_PATH;
if (!password) throw new Error('YIFEN_BUNDLE_PASSWORD is required.');
if (!vaultPath) throw new Error('OBSIDIAN_WISDOM_PATH is required.');

const snapshot = await readVault(vaultPath);
if (!snapshot.configured || !snapshot.notes.length) throw new Error('No knowledge notes found.');
const latest = snapshot.notes
  .map((note) => note.source?.modifiedAt || note.importedAt)
  .sort()
  .at(-1);
const payload = JSON.stringify({
  version: 1,
  syncedAt: new Date().toISOString(),
  rootId: snapshot.rootId,
  notes: snapshot.notes.map((note) => ({
    id: note.id,
    filename: note.filename,
    raw: note.raw,
    relativePath: note.source?.relativePath || note.filename,
    modifiedAt: note.source?.modifiedAt || note.importedAt,
    isIndex: note.source?.isIndex || false,
  })),
});
const iterations = 250000;
const salt = randomBytes(16);
const iv = randomBytes(12);
const key = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
const cipher = createCipheriv('aes-256-gcm', key, iv);
const ciphertext = Buffer.concat([
  cipher.update(payload, 'utf8'),
  cipher.final(),
  cipher.getAuthTag(),
]);
const output = {
  version: 1,
  algorithm: 'AES-256-GCM',
  kdf: 'PBKDF2-SHA256',
  iterations,
  salt: salt.toString('base64'),
  iv: iv.toString('base64'),
  ciphertext: ciphertext.toString('base64'),
  id: createHash('sha256').update(ciphertext).digest('hex').slice(0, 24),
  noteCount: snapshot.notes.length,
  updatedAt: latest || snapshot.syncedAt,
};
await mkdir(path.join(root, 'pages-public'), { recursive: true });
await writeFile(path.join(root, 'pages-public/knowledge.enc.json'), JSON.stringify(output));
console.log(`Encrypted ${snapshot.notes.length} notes (${ciphertext.length} bytes).`);
