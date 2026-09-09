import type { z } from 'zod';
import type { reportSchema, Segment } from '../shared/types';
// Synthetic tone and canned provider responses are TEST FIXTURES ONLY, never imported by the app.
export const tone = (seconds: number) =>
  Float32Array.from({ length: 24000 * seconds }, (_, i) =>
    i / 24000 >= 1.2 && i / 24000 < 3.2 ? 0 : Math.sin((i / 24000) * 440 * Math.PI * 2) * 0.3,
  );
export const fixtureSegments: Segment[] = [
  { id: 0, start: 0, end: 1.1, text: '我，我觉得，嗯，要先了解。' },
  { id: 1, start: 3.3, end: 5.5, text: '因为需要亲自试一试，所以我会先去旁听一节课。' },
];
export function fixtureReport(): z.infer<typeof reportSchema> {
  return {
    summary: '测试夹具：先了解，再行动。',
    strengths: [{ text: '测试夹具：提出具体行动。', quote: '我会先去旁听一节课' }],
    issues: [
      {
        kinds: ['卡壳'],
        segmentIds: [0],
        quote: '我，我觉得',
        pauseId: null,
        explanation: '测试夹具：重复起头。',
        suggestion: '测试夹具：我觉得要先了解。',
      },
    ],
    assessments: ['切题', '核心观点', '理由', '连贯性'].map((dimension) => ({
      dimension: dimension as '切题',
      feedback: '测试夹具评价。',
      quote: '我会先去旁听一节课',
    })),
    priorities: [
      { focus: '测试夹具：起头', exercise: '测试夹具练习一。' },
      { focus: '测试夹具：理由', exercise: '测试夹具练习二。' },
    ],
    improved: '测试夹具示例：我会先了解，再旁听一节课。',
    connections: [],
    alternatives: [],
    limitations: ['仅用于自动化测试，不是真实语音分析。'],
  };
}
