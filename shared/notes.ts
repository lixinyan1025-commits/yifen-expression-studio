import { parseDocument } from 'yaml';
import type { Note, Topic } from './types';

export function parseNote(raw: string, filename: string, id: string): Note {
  let body = raw.replace(/^\uFEFF/, ''),
    title = '',
    tags: string[] = [];
  const front = body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (front) {
    const doc = parseDocument(front[1]);
    if (doc.errors.length) throw new Error(`${filename} 的 YAML 属性格式有误，请修正后导入。`);
    const meta = doc.toJS({ maxAliasCount: 20 });
    if (meta && typeof meta === 'object') {
      title = typeof meta.title === 'string' ? meta.title : '';
      const value = meta.tags ?? meta.tag;
      tags = Array.isArray(value)
        ? value.filter((t): t is string => typeof t === 'string')
        : typeof value === 'string'
          ? value.split(/[,，\s]+/)
          : [];
    }
    body = body.slice(front[0].length);
  }
  const tagText = body.replace(/```[\s\S]*?```|`[^`]*`/g, '');
  for (const m of tagText.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) tags.push(m[1]);
  title ||= body.match(/^#\s+(.+)$/m)?.[1]?.trim() || filename.replace(/\.md$/i, '');
  return {
    id,
    title,
    body,
    raw,
    tags: [...new Set(tags.map((t) => t.replace(/^#/, '')).filter(Boolean))],
    filename,
    importedAt: new Date().toISOString(),
  };
}
export { drawCommonTopic as localTopic } from './topics';
