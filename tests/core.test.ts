import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, decodeWav, measureAudio } from '../shared/audio';
import { parseNote, localTopic } from '../shared/notes';
import { groundReport, validateTranscript } from '../server/validation';
import { fixtureReport, fixtureSegments, tone } from './fixtures';

test('Obsidian frontmatter, title, inline Unicode and nested tags are preserved', () => {
  const raw =
    '---\ntitle: 我的思考\ntags:\n  - 成长\n  - 心理/认知\n---\n# 原始标题\n保留 [[双链]]。 #思考 #成长\n```js\n#不是标签\n```';
  const n = parseNote(raw, '中文.md', 'n1');
  assert.equal(n.title, '我的思考');
  assert.equal(n.raw, raw);
  assert.deepEqual(n.tags, ['成长', '心理/认知', '思考']);
  assert.ok(n.body.includes('[[双链]]'));
});
test('invalid YAML fails explicitly rather than deleting metadata', () =>
  assert.throws(() => parseNote('---\ntags: [未闭合\n---\n正文', 'broken.md', 'n'), /YAML/));
test('common topics are independent of notes, contain brief context and avoid immediate repetition', () => {
  const t = localTopic(undefined, () => 0);
  assert.equal(t.source, 'local');
  assert.ok(t.text.includes('短视频'));
  assert.deepEqual(t.noteIds, []);
  assert.equal(t.reading?.length, 3);
  assert.notEqual(localTopic(t.text, () => 0).text, t.text);
});
test('WAV round trip preserves duration, pause location and sample amplitude', () => {
  const samples = tone(6);
  const bytes = encodeWav(samples, 24000);
  const audio = decodeWav(bytes);
  assert.equal(audio.sampleRate, 24000);
  assert.equal(audio.samples.length, samples.length);
  const facts = measureAudio(audio.samples, 24000, 1.5);
  assert.equal(facts.duration, 6);
  assert.equal(facts.pauses.length, 1);
  assert.ok(Math.abs(facts.pauses[0].start - 1.2) < 0.03);
  assert.ok(Math.abs(facts.pauses[0].duration - 2) < 0.03);
  assert.equal(measureAudio(audio.samples, 24000, 2.5).pauses.length, 0);
});
test('silence is audio evidence, not an interruption assertion', () => {
  const facts = measureAudio(new Float32Array(24000 * 3), 24000);
  assert.equal(facts.activeSeconds, 0);
  assert.equal(facts.pauses.length, 1);
  assert.equal(facts.pauses[0].duration, 3);
});
test('truncated/unsupported WAV is refused', () => {
  const bytes = encodeWav(tone(2), 24000);
  assert.throws(() => decodeWav(bytes.subarray(0, 100)), /不完整/);
  const stereo = bytes.slice();
  new DataView(stereo.buffer).setUint16(22, 2, true);
  assert.throws(() => decodeWav(stereo), /参数/);
});
test('STT text keeps hesitations; out-of-range and absent timestamps are rejected', () => {
  const r = validateTranscript(
    { text: '我，我觉得，嗯，要先了解。', segments: fixtureSegments },
    6,
  );
  assert.equal(r.segments[0].text, fixtureSegments[0].text);
  assert.throws(
    () => validateTranscript({ text: '测试', segments: [{ start: 7, end: 8, text: '测试' }] }, 6),
    /时间戳/,
  );
  assert.throws(() => validateTranscript({ text: '', segments: [] }, 6), /有效语音/);
});
test('report rejects fabricated quotes, validates pause IDs and deduplicates interruptions', () => {
  const facts = measureAudio(tone(6), 24000);
  const raw = fixtureReport();
  raw.issues.push({ ...raw.issues[0], quote: '凭空捏造的话' });
  raw.issues.push({ ...raw.issues[0], kinds: ['思路中断', '卡壳'] });
  raw.issues[0].kinds = ['思路中断'];
  raw.issues.push({
    kinds: ['长停顿'],
    segmentIds: [],
    quote: '',
    pauseId: '不存在',
    explanation: '测试',
    suggestion: '测试',
  });
  const report = groundReport(raw, fixtureSegments, facts, []);
  assert.equal(report.discarded, 2);
  assert.equal(report.issues.filter((i) => i.kinds.includes('思路中断')).length, 1);
  assert.equal(report.issues[0].start, 0);
  assert.equal(report.issues[0].end, 1.1);
  assert.equal(report.issues[0].status, 'suspected');
  assert.ok(report.issues[0].kinds.includes('卡壳'));
});
test('pure pause events inherit exact acoustic boundaries; semantic events need words', () => {
  const facts = measureAudio(tone(6), 24000);
  const raw = fixtureReport();
  raw.issues = [
    {
      kinds: ['长停顿'],
      segmentIds: [],
      quote: '',
      pauseId: facts.pauses[0].id,
      explanation: '测试上下文说明',
      suggestion: '测试建议',
    },
    {
      kinds: ['思路中断'],
      segmentIds: [],
      quote: '',
      pauseId: facts.pauses[0].id,
      explanation: '不能仅凭停顿',
      suggestion: '应过滤',
    },
  ];
  const r = groundReport(raw, fixtureSegments, facts, []);
  assert.equal(r.issues.length, 1);
  assert.equal(r.discarded, 1);
  assert.equal(r.issues[0].start, facts.pauses[0].start);
});
test('ungrounded overall assessments do not become a valid report', () => {
  const raw = fixtureReport();
  raw.assessments[0].quote = '不在录音中的话';
  assert.throws(() => groundReport(raw, fixtureSegments, measureAudio(tone(6), 24000), []), /引用/);
});

test('transitively overlapping thought interruptions are counted once', () => {
  const raw = fixtureReport();
  raw.issues = [
    { ...raw.issues[0], kinds: ['思路中断'] },
    { ...raw.issues[0], kinds: ['思路中断'], segmentIds: [1], quote: fixtureSegments[1].text },
    {
      ...raw.issues[0],
      kinds: ['思路中断'],
      segmentIds: [0, 1],
      quote: fixtureSegments.map((s) => s.text).join(''),
    },
  ];
  const report = groundReport(raw, fixtureSegments, measureAudio(tone(6), 24000), []);
  assert.equal(report.issues.length, 1);
  assert.equal(report.issues[0].start, 0);
  assert.equal(report.issues[0].end, 5.5);
});

test('a non-pause issue cannot inherit an unrelated pause timestamp', () => {
  const raw = fixtureReport();
  const facts = measureAudio(tone(6), 24000);
  raw.issues[0].pauseId = facts.pauses[0].id;
  const report = groundReport(raw, fixtureSegments, facts, []);
  assert.equal(report.issues[0].start, 0);
  assert.equal(report.issues[0].end, 1.1);
});
