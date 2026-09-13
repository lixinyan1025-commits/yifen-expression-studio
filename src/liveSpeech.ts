import type { Segment, Transcript } from '../shared/types';

type SpeechResult = {
  isFinal: boolean;
  0: { transcript: string };
};
type SpeechEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
type SpeechError = { error: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: SpeechError) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export type LiveSpeechSnapshot = {
  text: string;
  segments: Array<{ text: string; observedEnd: number }>;
  error?: string;
};
export type LiveSpeechControl = {
  stop(): Promise<LiveSpeechSnapshot>;
  cancel(): void;
};

const constructor = () => {
  const scope = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scope.SpeechRecognition || scope.webkitSpeechRecognition;
};

export const browserSupportsLiveSpeech = () => Boolean(constructor());

export function startLiveSpeech(options: {
  onUpdate(text: string, interim: string): void;
  onStatus(message: string): void;
}): LiveSpeechControl {
  const Recognition = constructor();
  if (!Recognition) throw new Error('当前浏览器不支持实时转写，录音仍可正常保存和回听。');
  const recognition = new Recognition();
  recognition.lang = 'zh-CN';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  const began = performance.now();
  const segments: LiveSpeechSnapshot['segments'] = [];
  let interim = '';
  let stopped = false;
  let cancelled = false;
  let settled = false;
  let failure = '';
  let resolveStop: ((value: LiveSpeechSnapshot) => void) | undefined;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  const snapshot = (): LiveSpeechSnapshot => ({
    text: `${segments.map((item) => item.text).join('')}${interim}`.trim(),
    segments: [...segments],
    ...(failure ? { error: failure } : {}),
  });
  const publish = () => options.onUpdate(snapshot().text, interim);
  const finish = () => {
    if (settled) return;
    settled = true;
    clearTimeout(fallback);
    resolveStop?.(snapshot());
  };
  recognition.onresult = (event) => {
    interim = '';
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const result = event.results[index];
      const text = result?.[0]?.transcript?.trim();
      if (!text) continue;
      if (result.isFinal) {
        if (segments.at(-1)?.text !== text)
          segments.push({ text, observedEnd: Math.max(0, (performance.now() - began) / 1000) });
      } else interim = text;
    }
    publish();
  };
  recognition.onerror = (event) => {
    if (stopped && event.error === 'aborted') return;
    if (event.error === 'no-speech') {
      options.onStatus('暂未识别到清晰语音，录音仍在继续。');
      return;
    }
    failure =
      event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? '浏览器未允许实时语音识别，录音仍会保存。'
        : event.error === 'network'
          ? '浏览器语音识别网络暂不可用，录音仍会保存。'
          : `实时转写已停止（${event.error}），录音仍会保存。`;
    options.onStatus(failure);
    stopped = true;
  };
  recognition.onend = () => {
    if (cancelled || stopped) {
      finish();
      return;
    }
    // Browser engines may end a continuous session early. Restart while the
    // one-minute recorder is still active and keep already-final text.
    setTimeout(() => {
      if (stopped || cancelled) return;
      try {
        recognition.start();
      } catch {
        failure = '实时转写无法继续，录音仍会保存。';
        options.onStatus(failure);
        stopped = true;
        finish();
      }
    }, 80);
  };
  recognition.start();
  options.onStatus('实时转写已启动。');
  return {
    stop: () => {
      if (settled) return Promise.resolve(snapshot());
      stopped = true;
      const promise = new Promise<LiveSpeechSnapshot>((resolve) => {
        resolveStop = resolve;
      });
      fallback = setTimeout(finish, 1200);
      try {
        recognition.stop();
      } catch {
        finish();
      }
      return promise;
    },
    cancel: () => {
      cancelled = true;
      stopped = true;
      try {
        recognition.abort();
      } finally {
        finish();
      }
    },
  };
}

const hashBlob = async (audio: Blob) => {
  const hash = await crypto.subtle.digest('SHA-256', await audio.arrayBuffer());
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export async function browserTranscript(
  snapshot: LiveSpeechSnapshot,
  audio: Blob,
  duration: number,
): Promise<Transcript | undefined> {
  if (!snapshot.text.trim()) return undefined;
  const raw = [...snapshot.segments];
  const finalized = raw.map((item) => item.text).join('');
  if (snapshot.text.length > finalized.length)
    raw.push({ text: snapshot.text.slice(finalized.length), observedEnd: duration });
  let previous = 0;
  const segments: Segment[] = raw
    .filter((item) => item.text.trim())
    .map((item, id) => {
      const end = Math.min(duration, Math.max(previous + 0.05, item.observedEnd));
      const segment = { id, start: previous, end, text: item.text.trim() };
      previous = end;
      return segment;
    });
  if (!segments.length) segments.push({ id: 0, start: 0, end: duration, text: snapshot.text });
  return {
    text: snapshot.text.trim(),
    segments,
    model: 'browser-web-speech-live',
    audioHash: await hashBlob(audio),
  };
}
