import type { AudioFacts, Pause } from './types';

// Same PCM timeline is used for playback, STT, amplitude measurements and AI audio input.
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(bytes.buffer);
  const str = (at: number, text: string) =>
    [...text].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, bytes.length - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) =>
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * (s < 0 ? 32768 : 32767), true),
  );
  return bytes;
}
export function decodeWav(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n));
  if (bytes.length < 44 || str(0, 4) !== 'RIFF' || str(8, 4) !== 'WAVE')
    throw new Error('录音格式无效，需要 PCM WAV。');
  let rate = 0,
    channels = 0,
    data: Uint8Array | undefined;
  for (let p = 12; p + 8 <= bytes.length;) {
    const size = v.getUint32(p + 4, true);
    if (p + 8 + size > bytes.length) throw new Error('录音文件不完整。');
    if (str(p, 4) === 'fmt ') {
      if (size < 16 || v.getUint16(p + 8, true) !== 1 || v.getUint16(p + 22, true) !== 16)
        throw new Error('需要 16 位 PCM WAV。');
      channels = v.getUint16(p + 10, true);
      rate = v.getUint32(p + 12, true);
    }
    if (str(p, 4) === 'data') data = bytes.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size % 2);
  }
  if (!data || channels !== 1 || rate < 8000 || rate > 96000 || data.length % 2)
    throw new Error('录音采样参数无效。');
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const samples = Float32Array.from(
    { length: data.length / 2 },
    (_, i) => dv.getInt16(i * 2, true) / 32768,
  );
  if (!samples.length || samples.length / rate > 65) throw new Error('录音须为 0–65 秒。');
  return { samples, sampleRate: rate };
}
export function measureAudio(samples: Float32Array, rate: number, threshold = 1.5): AudioFacts {
  const frameSize = Math.round(rate * 0.02);
  const frames: number[] = [];
  let sum = 0,
    peak = 0;
  for (let i = 0; i < samples.length; i += frameSize) {
    let sq = 0;
    const end = Math.min(i + frameSize, samples.length);
    for (let j = i; j < end; j++) {
      sq += samples[j] ** 2;
      peak = Math.max(peak, Math.abs(samples[j]));
    }
    sum += sq;
    frames.push(Math.sqrt(sq / (end - i)));
  }
  const duration = samples.length / rate;
  // Energy is an observable proxy, not a voice or interruption detector.
  const gate = Math.max(0.004, Math.min(0.02, peak * 0.035));
  const pauses: Pause[] = [];
  let start: number | null = null;
  for (let i = 0; i <= frames.length; i++) {
    if (i < frames.length && frames[i] < gate) {
      if (start === null) start = i * 0.02;
    } else if (start !== null) {
      const end = Math.min(i * 0.02, duration);
      if (end - start >= threshold)
        pauses.push({ id: `p${Math.round(start * 100)}`, start, end, duration: end - start });
      start = null;
    }
  }
  const waveform: number[] = [];
  for (let i = 0; i < 160; i++) {
    const chunk = frames.slice(
      Math.floor((i * frames.length) / 160),
      Math.max(
        Math.floor((i * frames.length) / 160) + 1,
        Math.floor(((i + 1) * frames.length) / 160),
      ),
    );
    waveform.push(chunk.length ? Math.max(...chunk) : 0);
  }
  return {
    duration,
    rms: Math.sqrt(sum / Math.max(1, samples.length)),
    peak,
    activeSeconds: frames.filter((v) => v >= gate).length * 0.02,
    waveform,
    pauses,
  };
}
