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
const scenarios = [
  {
    category: '学习与选择',
    words: /长期|机会成本|自我认知|专业|选择|职业|决策/,
    text: '学了一段时间后，你发现所选专业可能不适合自己。面对家人的担心，你会如何说明下一步的打算？',
  },
  {
    category: '关系与沟通',
    words: /关系|沟通|情绪|共情|边界|朋友|理解/,
    text: '朋友总在深夜向你倾诉，最近却影响了你的休息。你会怎样向他表达自己的想法？',
  },
  {
    category: '行动与成长',
    words: /行动|习惯|坚持|成长|计划|目标|学习/,
    text: '你和同学约好一起学一项技能，但两周后大家都想放弃。你会在下一次碰面时说些什么？',
  },
  {
    category: '工作与协作',
    words: /工作|团队|效率|合作|责任|管理/,
    text: '小组临近交付时，有人提出推翻现有方案。你会怎样向大家表达自己的判断？',
  },
  {
    category: '生活与判断',
    words: /信息|认知|思考|真相|媒体|价值|理性/,
    text: '群聊里大家都在转发一个很有说服力的观点，你却有些保留。你会怎样表达不同看法？',
  },
  {
    category: '日常生活',
    words: /./,
    text: '朋友问你：最近有什么经历让你改变了原来的看法？请讲清楚发生了什么，以及你为什么改变。',
  },
];
export function localTopic(notes: Note[]): Topic {
  const content = notes.map((n) => `${n.title} ${n.tags.join(' ')} ${n.body}`).join('\n');
  const match = scenarios.find((s) => s.words.test(content)) ?? scenarios.at(-1)!;
  return {
    id: crypto.randomUUID(),
    text: match.text,
    category: match.category,
    source: 'local',
    noteIds: notes.map((n) => n.id),
  };
}
