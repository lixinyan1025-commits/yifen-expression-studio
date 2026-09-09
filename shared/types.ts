import { z } from 'zod';

export type Note = {
  id: string;
  title: string;
  body: string;
  raw: string;
  tags: string[];
  filename: string;
  importedAt: string;
  source?: {
    kind: 'obsidian';
    rootId: string;
    relativePath: string;
    modifiedAt: string;
    isIndex: boolean;
  };
};
export type VaultSnapshot = {
  configured: boolean;
  rootPath: string;
  rootId: string;
  notes: Note[];
  syncedAt: string;
};
export type Topic = {
  id: string;
  text: string;
  category: string;
  source: 'local' | 'ai';
  noteIds: string[];
};
export type Segment = { id: number; start: number; end: number; text: string };
export type Pause = { id: string; start: number; end: number; duration: number };
export type AudioFacts = {
  duration: number;
  rms: number;
  peak: number;
  activeSeconds: number;
  waveform: number[];
  pauses: Pause[];
};
export const kinds = ['卡壳', '长停顿', '口头禅', '无意义重复', '逻辑不清', '思路中断'] as const;
export const issueSchema = z.object({
  kinds: z.array(z.enum(kinds)).min(1).max(6),
  segmentIds: z.array(z.number().int()).max(10),
  quote: z.string().max(1500),
  pauseId: z.string().nullable(),
  explanation: z.string().min(1).max(1500),
  suggestion: z.string().min(1).max(1500),
});
const assessment = z.object({
  dimension: z.enum(['切题', '核心观点', '理由', '连贯性']),
  feedback: z.string().min(1).max(1000),
  quote: z.string().max(1000),
});
export const reportSchema = z.object({
  summary: z.string().min(1).max(2000),
  strengths: z
    .array(z.object({ text: z.string().min(1).max(1000), quote: z.string().min(1).max(1000) }))
    .max(5),
  issues: z.array(issueSchema).max(60),
  assessments: z.array(assessment).length(4),
  priorities: z
    .array(z.object({ focus: z.string().min(1).max(200), exercise: z.string().min(1).max(1000) }))
    .min(2)
    .max(3),
  improved: z.string().min(1).max(1200),
  connections: z.array(z.object({ noteId: z.string(), inspiration: z.string().max(1500) })).max(6),
  alternatives: z.array(z.string().max(1000)).max(4),
  limitations: z.array(z.string().max(1000)).max(8),
});
export type Issue = z.infer<typeof issueSchema> & {
  id: string;
  start: number;
  end: number;
  status: 'suspected' | 'confirmed' | 'ignored';
};
export type Report = Omit<z.infer<typeof reportSchema>, 'issues'> & {
  issues: Issue[];
  discarded: number;
};
export type Transcript = { text: string; segments: Segment[]; model: string; audioHash: string };
export type Session = {
  id: string;
  createdAt: string;
  topic: Topic;
  mode: 'impromptu' | 'prepared';
  previousId?: string;
  audio: Blob;
  original: Blob;
  facts: AudioFacts;
  threshold: number;
  transcript?: Transcript;
  report?: Report;
  error?: string;
  interrupted?: boolean;
};
export type ServiceStatus = {
  ai: boolean;
  stt: boolean;
  aiHost: string;
  sttHost: string;
  topicModel: string;
  audioModel: string;
  sttModel: string;
};
