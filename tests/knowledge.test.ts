import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptKnowledge, type EncryptedKnowledge } from '../src/knowledgeBundle';

const base64 = (value: ArrayBuffer | Uint8Array) =>
  Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value).toString('base64');

async function encryptedFixture(password: string): Promise<EncryptedKnowledge> {
  const salt = new Uint8Array(16).fill(3);
  const iv = new Uint8Array(12).fill(5);
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const payload = JSON.stringify({
    version: 1,
    syncedAt: '2026-09-13T00:00:00.000Z',
    rootId: 'test-wisdom',
    notes: [
      {
        id: 'obsidian-test',
        filename: '行动.md',
        raw: '---\ntags: [实践]\n---\n# 行动\n先做一小步。',
        relativePath: '01-入世/行动.md',
        modifiedAt: '2026-09-12T00:00:00.000Z',
        isIndex: false,
      },
    ],
  });
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(payload),
  );
  return {
    version: 1,
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: 100000,
    salt: base64(salt),
    iv: base64(iv),
    ciphertext: base64(ciphertext),
    id: 'fixture',
    noteCount: 1,
    updatedAt: '2026-09-12T00:00:00.000Z',
  };
}

test('encrypted Pages knowledge decrypts only with the password and preserves Markdown metadata', async () => {
  const envelope = await encryptedFixture('correct-password');
  await assert.rejects(() => decryptKnowledge(envelope, 'wrong-password'), /密码不正确/);
  const snapshot = await decryptKnowledge(envelope, 'correct-password');
  assert.equal(snapshot.notes.length, 1);
  assert.equal(snapshot.notes[0].title, '行动');
  assert.deepEqual(snapshot.notes[0].tags, ['实践']);
  assert.equal(snapshot.notes[0].body.trim(), '# 行动\n先做一小步。');
  assert.equal(snapshot.notes[0].source?.relativePath, '01-入世/行动.md');
});
