import { z } from 'zod';
import {
  reportSchema,
  type AudioFacts,
  type Issue,
  type Note,
  type Report,
  type Segment,
} from '../shared/types';

const segmentSchema = z.object({
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  text: z.string().max(10000),
  no_speech_prob: z.number().optional(),
});
export function validateTranscript(raw: unknown, duration: number) {
  const value = z
    .object({ text: z.string().max(30000), segments: z.array(segmentSchema).max(500) })
    .parse(raw);
  if (
    !value.text.trim() ||
    !value.segments.some((s) => s.text.trim() && (s.no_speech_prob ?? 0) < 0.8)
  )
    throw new Error('未识别到有效语音。请回听录音、检查麦克风后重试。');
  const segments: Segment[] = value.segments
    .filter((s) => s.text.trim())
    .map((s, id) => {
      if (s.end <= s.start || s.end > duration + 0.35 || s.start >= duration)
        throw new Error('转写服务返回的时间戳超出录音，无法可靠定位。请检查服务或重试。');
      return { id, start: s.start, end: Math.min(s.end, duration), text: s.text };
    });
  if (!segments.length || segments.some((s, i) => i > 0 && s.start < segments[i - 1].start))
    throw new Error('转写时间戳缺失或顺序错误。请使用支持分段时间戳的转写服务。');
  return { text: value.text, segments };
}
// Whitespace and punctuation may differ in provider segment/full-text formatting; words may not.
const comparable = (text: string) => text.replace(/[\p{P}\p{Z}\s]/gu, '');
export const containsQuote = (source: string, quote: string) =>
  !!comparable(quote) && comparable(source).includes(comparable(quote));
export function groundReport(
  raw: unknown,
  segments: Segment[],
  facts: AudioFacts,
  notes: Pick<Note, 'id'>[],
): Report {
  const parsed = reportSchema.parse(raw);
  const transcript = segments.map((s) => s.text).join('');
  if (new Set(parsed.assessments.map((a) => a.dimension)).size !== 4)
    throw new Error('分析缺少必要的评价维度，请重试。');
  const issues: Issue[] = [];
  let discarded = 0;
  for (const issue of parsed.issues) {
    const cited = issue.segmentIds.map((id) => segments.find((s) => s.id === id));
    const pause = facts.pauses.find((p) => p.id === issue.pauseId);
    const hasWords = !!issue.quote.trim();
    if (
      (hasWords &&
        (!cited.length ||
          cited.some((s) => !s) ||
          issue.segmentIds.some((id, i) => i > 0 && id !== issue.segmentIds[i - 1] + 1) ||
          !containsQuote(cited.map((s) => s!.text).join(''), issue.quote))) ||
      (!hasWords && !(issue.kinds.length === 1 && issue.kinds[0] === '长停顿' && pause)) ||
      (issue.kinds.includes('长停顿') && !pause)
    ) {
      discarded++;
      continue;
    }
    const purePause = pause && issue.kinds.length === 1 && issue.kinds[0] === '长停顿';
    const start = purePause ? pause.start : Math.min(...cited.map((s) => s!.start));
    const end = purePause ? pause.end : Math.max(...cited.map((s) => s!.end));
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      discarded++;
      continue;
    }
    // Conservative event count: overlapping interruption claims collapse to one event.
    const duplicate = issues.find(
      (i) =>
        (i.kinds.includes('思路中断') &&
          issue.kinds.includes('思路中断') &&
          start < i.end &&
          end > i.start) ||
        (i.start === start && i.end === end && i.quote === issue.quote),
    );
    if (duplicate) {
      duplicate.kinds = [...new Set([...duplicate.kinds, ...issue.kinds])];
      duplicate.start = Math.min(duplicate.start, start);
      duplicate.end = Math.max(duplicate.end, end);
      if (!duplicate.explanation.includes(issue.explanation))
        duplicate.explanation += `；${issue.explanation}`;
      continue;
    }
    issues.push({
      ...issue,
      kinds: [...new Set(issue.kinds)],
      id: `e${issues.length + 1}`,
      start,
      end,
      status: 'suspected',
    });
  }
  const strengths = parsed.strengths.filter((s) => containsQuote(transcript, s.quote));
  // Coalesce transitively overlapping interruption intervals regardless of model output order.
  issues.sort((a, b) => a.start - b.start);
  const merged: Issue[] = [];
  for (const issue of issues) {
    const existing = issue.kinds.includes('思路中断')
      ? merged.find(
          (i) => i.kinds.includes('思路中断') && issue.start < i.end && issue.end > i.start,
        )
      : undefined;
    if (existing) {
      existing.end = Math.max(existing.end, issue.end);
      existing.kinds = [...new Set([...existing.kinds, ...issue.kinds])];
      existing.explanation += `；${issue.explanation}`;
    } else merged.push(issue);
  }
  discarded += parsed.strengths.length - strengths.length;
  for (const a of parsed.assessments) {
    if (!containsQuote(transcript, a.quote))
      throw new Error('评价引用与转写不一致，已拒绝显示该报告。请重试分析。');
  }
  const connections = parsed.connections.filter((n) =>
    notes.some((known) => known.id === n.noteId),
  );
  return {
    ...parsed,
    strengths,
    issues: merged,
    connections,
    discarded,
  };
}
