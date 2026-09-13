import { encodeWav, measureAudio } from '../shared/audio';
import type { AudioFacts } from '../shared/types';
export type Capture = { audio: Blob; original: Blob; facts: AudioFacts; interrupted: boolean };
export type RecorderControl = { stop: (interrupted?: boolean) => void; cancel: () => void };
export async function startCapture(options: {
  threshold: number;
  onStart: (deadline: number) => void;
  onStop?: () => void;
  onLevel: (v: number) => void;
  onFinish: (capture: Capture) => void;
  onError: (message: string, original?: Blob) => void;
}): Promise<RecorderControl> {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
    throw new Error(
      '当前浏览器不支持录音。请使用最新版 Chrome、Edge 或 Safari，通过 localhost 或 HTTPS 打开。',
    );
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
  });
  let context: AudioContext;
  try {
    context = new AudioContext();
    await context.resume();
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('无法启动音频设备，请关闭占用麦克风的应用后重试。');
  }
  const source = context.createMediaStreamSource(stream),
    analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    await context.close();
    throw new Error('浏览器无法创建录音，请换用 Chrome 或 Edge。');
  }
  const chunks: Blob[] = [];
  let timeout: ReturnType<typeof setTimeout>,
    frame = 0,
    interrupted = false,
    cancelled = false,
    stopping = false;
  const data = new Float32Array(analyser.fftSize);
  const tick = () => {
    analyser.getFloatTimeDomainData(data);
    options.onLevel(Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length));
    frame = requestAnimationFrame(tick);
  };
  const stop = (unexpected = false) => {
    if (stopping) return;
    stopping = true;
    interrupted = unexpected;
    clearTimeout(timeout);
    cancelAnimationFrame(frame);
    if (recorder.state !== 'inactive') recorder.stop();
  };
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  recorder.onerror = () => stop(true);
  stream.getTracks().forEach((track) => {
    track.onended = () => stop(true);
  });
  recorder.onstart = () => {
    options.onStart(Date.now() + 60000);
    timeout = setTimeout(() => stop(), 60000);
    tick();
  };
  recorder.onstop = async () => {
    clearTimeout(timeout);
    cancelAnimationFrame(frame);
    options.onStop?.();
    options.onLevel(0);
    stream.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    const original = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    try {
      if (cancelled) return;
      if (original.size < 100) throw new Error('未收到有效录音数据，请重试。');
      const decoded = await context.decodeAudioData(await original.arrayBuffer());
      const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 24000), 24000);
      const input = offline.createBufferSource();
      input.buffer = decoded;
      input.connect(offline.destination);
      input.start();
      const rendered = await offline.startRendering();
      const samples = rendered.getChannelData(0);
      const audio = new Blob([encodeWav(samples, 24000)], { type: 'audio/wav' });
      if (!cancelled)
        options.onFinish({
          audio,
          original,
          facts: measureAudio(samples, 24000, options.threshold),
          interrupted,
        });
    } catch (error) {
      if (!cancelled)
        options.onError(
          error instanceof Error ? error.message : '录音处理失败，请重试。',
          original,
        );
    } finally {
      await context.close();
    }
  };
  try {
    recorder.start(250);
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    await context.close();
    throw new Error('麦克风启动失败，请重试。');
  }
  return {
    stop,
    cancel: () => {
      cancelled = true;
      stop();
    },
  };
}
export function micError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError')
      return '麦克风权限被拒绝。请在地址栏的网站权限中允许麦克风，然后再次点击开始演讲。';
    if (error.name === 'NotFoundError') return '没有找到麦克风。请连接麦克风后重试。';
    if (error.name === 'NotReadableError') return '麦克风正被占用或设备不可用。请检查设备后重试。';
  }
  return error instanceof Error ? error.message : '无法使用麦克风，请检查权限后重试。';
}
