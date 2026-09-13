import test from 'node:test';
import assert from 'node:assert/strict';
import { liveSignals, localReport } from '../shared/localAnalysis';
import type { AudioFacts, Topic, Transcript } from '../shared/types';

const transcript: Transcript = {
  text: '我我我觉得，嗯，这件事要先看目标。',
  segments: [{ id: 0, start: 0, end: 6, text: '我我我觉得，嗯，这件事要先看目标。' }],
  model: 'browser-web-speech-live',
  audioHash: 'test-hash',
};
const facts: AudioFacts = {
  duration: 6,
  rms: 0.1,
  peak: 0.4,
  activeSeconds: 3.5,
  waveform: [],
  pauses: [{ id: 'pause-1', start: 2, end: 3.7, duration: 1.7 }],
};
const topic: Topic = {
  id: 'topic-1',
  text: '你会怎么做？',
  category: '生活选择',
  source: 'local',
  noteIds: [],
};

test('live and post-recording local analysis only report text or WAV-grounded clues', () => {
  assert.deepEqual(liveSignals(transcript.text), { characters: 17, fillers: 1, repeats: 1 });
  const report = localReport({ transcript, facts, topic });
  assert.equal(report.issues.length, 3);
  assert.ok(report.issues.some((issue) => issue.quote === '嗯'));
  assert.ok(report.issues.some((issue) => issue.quote === '我我我'));
  assert.ok(report.issues.some((issue) => issue.pauseId === 'pause-1'));
  assert.ok(report.issues.every((issue) => !issue.kinds.includes('逻辑不清')));
  assert.match(report.assessments[0].feedback, /不能可靠判断/);
  assert.equal(report.improved, transcript.text);
});
