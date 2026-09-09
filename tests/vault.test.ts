import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readVault } from '../server/vault';

test('read-only vault link recursively imports only scoped Markdown and preserves stable IDs', async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'yifen-vault-test-'));
  // Only remove the exact task-specific temporary directory created above.
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const root = path.join(workspace, '智慧');
  await mkdir(path.join(root, '入世'), { recursive: true });
  await mkdir(path.join(root, '.obsidian'));
  await mkdir(path.join(workspace, '学习知识'));
  await writeFile(path.join(root, '00-智慧入口.md'), '# 智慧入口\n目录。');
  const file = path.join(root, '入世', '行动.md');
  await writeFile(file, '---\ntags: [行动]\n---\n# 我的行动\n保留原始内容。');
  await writeFile(path.join(root, '.obsidian', 'hidden.md'), '不能读取');
  await writeFile(path.join(workspace, '学习知识', 'other.md'), '不在授权目录内');
  await writeFile(path.join(root, 'image.png'), 'not markdown');
  const before = await stat(file),
    original = await readFile(file, 'utf8');
  const first = await readVault(root),
    second = await readVault(root);
  assert.equal(first.notes.length, 2);
  assert.deepEqual(
    first.notes.map((n) => n.id),
    second.notes.map((n) => n.id),
  );
  assert.equal(first.notes.find((n) => n.filename === '行动.md')?.raw, original);
  assert.equal(first.notes.find((n) => n.filename.includes('入口'))?.source?.isIndex, true);
  assert.equal(
    first.notes.find((n) => n.filename === '行动.md')?.source?.relativePath,
    '入世/行动.md',
  );
  assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
  assert.equal(await readFile(file, 'utf8'), original);
  await writeFile(file, '# 新内容\n修改后。');
  const updated = await readVault(root);
  assert.equal(
    updated.notes.find((n) => n.filename === '行动.md')?.id,
    first.notes.find((n) => n.filename === '行动.md')?.id,
  );
  await rm(file);
  assert.equal((await readVault(root)).notes.length, 1);
});

test('vault reader ignores directory junctions escaping the configured wisdom folder', async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'yifen-vault-links-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const root = path.join(workspace, '智慧'),
    outside = path.join(workspace, 'other');
  await mkdir(root);
  await mkdir(outside);
  await writeFile(path.join(outside, 'private.md'), 'outside');
  const link = path.join(root, 'escape');
  await symlink(outside, link, 'junction');
  assert.equal((await readVault(root)).notes.length, 0);
  await rm(link); // Remove only the junction itself before the test temp directory cleanup.
});

test('an absent or invalid configuration never falls back to reading an arbitrary directory', async () => {
  assert.equal((await readVault()).configured, false);
  await assert.rejects(readVault(path.join(os.tmpdir(), 'does-not-exist-yifen-test')), /无法找到/);
});
