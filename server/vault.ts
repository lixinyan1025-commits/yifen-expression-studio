import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseNote } from '../shared/notes';
import type { Note, VaultSnapshot } from '../shared/types';

const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 24);
export async function readVault(configuredPath?: string): Promise<VaultSnapshot> {
  if (!configuredPath)
    return {
      configured: false,
      rootPath: '',
      rootId: '',
      notes: [],
      syncedAt: new Date().toISOString(),
    };
  let root: string;
  try {
    root = await realpath(configuredPath);
  } catch {
    throw new Error(
      '无法找到已配置的 Obsidian 智慧目录，请检查磁盘连接与 OBSIDIAN_WISDOM_PATH。现有缓存仍保留。',
    );
  }
  if (!(await lstat(root)).isDirectory()) throw new Error('Obsidian 配置路径必须是文件夹。');
  const rootId = hash(process.platform === 'win32' ? root.toLowerCase() : root);
  const notes: Note[] = [];
  let totalBytes = 0;
  const withinRoot = (candidate: string) => {
    const relative = path.relative(root, candidate);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  async function walk(folder: string) {
    const entries = await readdir(folder, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const file = path.join(folder, entry.name);
      const stat = await lstat(file);
      if (stat.isSymbolicLink()) continue;
      const resolved = await realpath(file);
      if (!withinRoot(resolved)) continue;
      if (stat.isDirectory()) {
        await walk(resolved);
        continue;
      }
      if (!stat.isFile() || !/\.md$/i.test(entry.name)) continue;
      if (stat.size > 1000000)
        throw new Error(`笔记 ${entry.name} 超过 1 MB，同步已中止，原有缓存保留。`);
      totalBytes += stat.size;
      if (totalBytes > 20000000 || notes.length >= 1000)
        throw new Error('智慧目录超出单次同步范围（1000 篇 / 20 MB），请缩小配置目录。');
      const relativePath = path.relative(root, resolved).split(path.sep).join('/');
      const id = `obsidian-${hash(`${rootId}/${relativePath}`)}`;
      const bytes = await readFile(resolved);
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const note = parseNote(raw, entry.name, id);
      note.source = {
        kind: 'obsidian',
        rootId,
        relativePath,
        modifiedAt: stat.mtime.toISOString(),
        isIndex: /(?:入口|索引|分类说明)/.test(entry.name),
      };
      notes.push(note);
    }
  }
  try {
    await walk(root);
  } catch (error) {
    throw new Error(
      `Obsidian 同步失败，未更新本机缓存：${error instanceof Error ? error.message : '请检查文件读取权限。'}`,
    );
  }
  return { configured: true, rootPath: root, rootId, notes, syncedAt: new Date().toISOString() };
}
