import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Play, Download, ArrowUpRight } from 'lucide-react';
import { kinds, type Issue, type Note, type Session } from '../shared/types';
export const time = (s: number) =>
  `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
export const date = (s: string) =>
  new Date(s).toLocaleString('zh-CN', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
export function NoteBody({ note }: { note: Note }) {
  // Images are not fetched automatically: imported notes must not leak reading activity to remote hosts.
  const display = note.body
    .replace(/!\[\[([^\]]+)\]\]/g, '（附件：$1，未导入）')
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_m, target: string, label?: string) => label || target,
    );
  return (
    <article className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          img: ({ alt }) => <span className="muted">（图片：{alt || '未导入附件'}）</span>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
              <ArrowUpRight size={12} />
            </a>
          ),
        }}
      >
        {display}
      </Markdown>
    </article>
  );
}
export function download(blob: Blob, filename: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
export function ReportView({
  session,
  notes,
  previous,
  onUpdate,
  onRetry,
  onAgain,
  busy,
}: {
  session: Session;
  notes: Note[];
  previous?: Session;
  onUpdate: (s: Session) => void;
  onRetry: () => void;
  onAgain: () => void;
  busy: string;
}) {
  const [url, setUrl] = useState(''),
    [current, setCurrent] = useState(0),
    [playError, setPlayError] = useState('');
  const audio = useRef<HTMLAudioElement>(null),
    stopAt = useRef<number | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(session.audio);
    setUrl(u);
    setCurrent(0);
    return () => URL.revokeObjectURL(u);
  }, [session.id, session.audio]);
  const seek = async (start: number, end: number) => {
    const el = audio.current;
    if (!el) return;
    try {
      setPlayError('');
      el.currentTime = Math.max(0, start - 0.25);
      stopAt.current = Math.min(session.facts.duration, end + 0.4);
      await el.play();
    } catch {
      setPlayError('暂时无法播放，请先使用播放器加载录音，再点击时间标记。');
    }
  };
  const changeStatus = (id: string, status: Issue['status']) => {
    if (session.report)
      onUpdate({
        ...session,
        report: {
          ...session.report,
          issues: session.report.issues.map((i) => (i.id === id ? { ...i, status } : i)),
        },
      });
  };
  const report = session.report;
  const confirmed = (s: Session, kind: string) =>
    s.report?.issues.filter(
      (i) => i.kinds.includes(kind as (typeof kinds)[number]) && i.status === 'confirmed',
    ).length ?? 0;
  const suspected = (s: Session, kind: string) =>
    s.report?.issues.filter(
      (i) => i.kinds.includes(kind as (typeof kinds)[number]) && i.status === 'suspected',
    ).length ?? 0;
  return (
    <div className="report-stack">
      <section className="panel report-heading">
        <div>
          <span className="eyebrow">REFLECT & RETRY / 复盘</span>
          <h2>{report ? '听见进步的起点。' : '先听听，刚才的自己。'}</h2>
          <p>{session.topic.text}</p>
          <span className="muted">
            {date(session.createdAt)} · {session.facts.duration.toFixed(1)} 秒 ·{' '}
            {session.mode === 'prepared' ? '准备模式' : '临场模式'}
          </span>
        </div>
        <button className="primary" disabled={!!busy} onClick={onAgain}>
          同题再挑战 <ArrowUpRight size={17} />
        </button>
      </section>
      {session.interrupted && (
        <div className="notice">
          录音因页面切换、设备中断或浏览器事件提前停止，本次按实际保存时长复盘。
        </div>
      )}
      <section className="panel playback">
        <div className="row spread">
          <h3>本次录音</h3>
          <button
            className="text-button"
            onClick={() => download(session.audio, `一分-${session.id}.wav`)}
          >
            <Download size={15} /> 下载 WAV
          </button>
        </div>
        <div className="waveform" aria-label="实际录音音量波形">
          {session.facts.waveform.map((v, i) => (
            <span
              key={i}
              style={{
                height: `${Math.max(3, Math.min(100, (v / Math.max(...session.facts.waveform, 0.001)) * 100))}%`,
                background: i / 160 < current / session.facts.duration ? 'var(--green)' : undefined,
              }}
            />
          ))}
        </div>
        <audio
          ref={audio}
          src={url}
          controls
          preload="metadata"
          onPointerDown={() => {
            stopAt.current = null;
          }}
          onKeyDown={() => {
            stopAt.current = null;
          }}
          onTimeUpdate={() => {
            const el = audio.current!;
            setCurrent(el.currentTime);
            if (stopAt.current !== null && el.currentTime >= stopAt.current) {
              el.pause();
              stopAt.current = null;
            }
          }}
        />
        <button
          className="text-button"
          onClick={() => {
            stopAt.current = null;
            if (audio.current) {
              audio.current.currentTime = 0;
              void audio.current.play().catch(() => setPlayError('请使用播放器开始播放。'));
            }
          }}
        >
          从头完整回听
        </button>
        <details>
          <summary>下载原始录音与复盘数据</summary>
          <div className="row">
            <button
              className="text-button"
              onClick={() =>
                download(
                  session.original,
                  `一分-原始-${session.id}.${session.original.type.includes('mp4') ? 'm4a' : 'webm'}`,
                )
              }
            >
              下载原始录音
            </button>
            <button
              className="text-button"
              onClick={() => {
                const { audio: _audio, original: _original, ...data } = session;
                download(
                  new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
                  `一分-复盘-${session.id}.json`,
                );
              }}
            >
              导出转写与复盘 JSON
            </button>
          </div>
        </details>
        {playError && (
          <p role="alert" className="error">
            {playError}
          </p>
        )}
        <p className="caption">
          问题与转写使用这份 WAV
          的同一时间轴。转写定位精度为语音服务返回的分段，点击后会保留少量前后文。
        </p>
      </section>
      {busy && (
        <div role="status" className="notice">
          <span className="spinner" />
          {busy}，录音已保存在本机。
        </div>
      )}
      {session.error && (
        <div role="alert" className="notice warning">
          {session.error}
        </div>
      )}
      {!report && !busy && (
        <section className="panel dashed">
          <h3>完整复盘等待分析</h3>
          <p>分析需要配置语音转写和支持音频输入的 AI 服务。不会用预设评价代替你的真实表现。</p>
          <button className="primary" onClick={onRetry}>
            {session.transcript ? '重试音频分析' : '转写并分析'}
          </button>
        </section>
      )}
      {report && (
        <>
          <section className="panel">
            <span className="eyebrow">这一分钟</span>
            <h3>{report.summary}</h3>
            <div className="strengths">
              {report.strengths.map((s, i) => (
                <div key={i}>
                  <span>✦</span>
                  <p>
                    {s.text}
                    <q>{s.quote}</q>
                  </p>
                </div>
              ))}
            </div>
            <div className="assessment-grid">
              {report.assessments.map((a) => (
                <div key={a.dimension}>
                  <span className="tag">{a.dimension}</span>
                  <p>{a.feedback}</p>
                  <q>{a.quote}</q>
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <div className="row spread">
              <h3>值得回听的地方</h3>
              <span className="caption">疑似项由你确认 · 不设分数</span>
            </div>
            <div className="metrics">
              {kinds.map((kind) => (
                <div key={kind}>
                  <span>{kind}</span>
                  <strong>
                    {confirmed(session, kind)}
                    <small> 已确认</small>
                  </strong>
                  <span>{suspected(session, kind)} 项疑似</span>
                </div>
              ))}
            </div>
            <p className="caption">
              次数按证据事件统计。同一事件可有多个表现；同一时间段重叠的思路中断只计一次。分段较粗时可能合并，需回听确认。
            </p>
            {!report.issues.length && (
              <p className="muted">本次未返回可核验的问题事件。这不代表表达没有改善空间。</p>
            )}
            {report.issues.map((issue) => (
              <div
                className={`issue ${issue.status === 'ignored' ? 'ignored' : ''}`}
                key={issue.id}
              >
                <div className="row spread">
                  <button className="time-button" onClick={() => void seek(issue.start, issue.end)}>
                    <Play size={13} />
                    {time(issue.start)}–{time(issue.end)}
                  </button>
                  <div className="tags">
                    {issue.kinds.map((k) => (
                      <span className="tag" key={k}>
                        {k}
                      </span>
                    ))}
                    <span className="caption">
                      {issue.status === 'suspected'
                        ? '疑似'
                        : issue.status === 'confirmed'
                          ? '已确认'
                          : '已忽略'}
                    </span>
                  </div>
                </div>
                {issue.quote && <blockquote>“{issue.quote}”</blockquote>}
                <p>{issue.explanation}</p>
                <p className="suggestion">可以试试：{issue.suggestion}</p>
                <div className="row">
                  <button
                    className="text-button"
                    onClick={() => changeStatus(issue.id, 'confirmed')}
                  >
                    确认此问题
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      changeStatus(issue.id, issue.status === 'ignored' ? 'suspected' : 'ignored')
                    }
                  >
                    {issue.status === 'ignored' ? '恢复疑似' : '忽略'}
                  </button>
                </div>
              </div>
            ))}
          </section>
        </>
      )}
      <section className="panel">
        <h3>带时间标记的转写原文</h3>
        <p className="caption">
          保留服务原始返回内容，未经润色。语音识别仍可能遗漏口头禅、重复或识别错误，请以回听为准。
        </p>
        {session.transcript ? (
          <>
            <div className="transcript">
              {session.transcript.segments.map((s) => (
                <button
                  className={current >= s.start && current < s.end ? 'active' : ''}
                  key={s.id}
                  onClick={() => void seek(s.start, s.end)}
                >
                  <span>{time(s.start)}</span>
                  <p>{s.text}</p>
                  <Play size={14} />
                </button>
              ))}
            </div>
            <details>
              <summary>查看服务返回的完整原文</summary>
              <p className="raw-text">{session.transcript.text}</p>
            </details>
          </>
        ) : (
          <p className="muted">尚无转写。完成服务配置后可从这份录音重试。</p>
        )}
      </section>
      <section className="panel">
        <div className="row spread">
          <h3>音频停顿观察</h3>
          <span className="tag">阈值 {session.threshold.toFixed(1)} 秒</span>
        </div>
        <p className="caption">
          依据真实 WAV
          的低音量区间计算，包含开头和结尾。安静不一定是卡壳，背景噪声也可能影响检测。以下不直接计入问题次数。
        </p>
        <div className="pause-list">
          {session.facts.pauses.length ? (
            session.facts.pauses.map((p) => (
              <button key={p.id} onClick={() => void seek(p.start, p.end)}>
                <Play size={12} />
                {time(p.start)}–{time(p.end)}
                <span>{p.duration.toFixed(2)} 秒</span>
              </button>
            ))
          ) : (
            <span className="muted">未检测到超过当前阈值的低音量区间。</span>
          )}
        </div>
      </section>
      {report && (
        <>
          <section className="panel priorities">
            <span className="eyebrow">下一次，只专注这几件事</span>
            {report.priorities.map((p, i) => (
              <div key={i}>
                <strong>0{i + 1}</strong>
                <div>
                  <h3>{p.focus}</h3>
                  <p>{p.exercise}</p>
                </div>
              </div>
            ))}
          </section>
          <section className="panel">
            <span className="eyebrow">保留你的意思</span>
            <h3>一种更清楚的说法</h3>
            <p className="improved">{report.improved}</p>
            <p className="caption">
              AI 根据本次回答整理的练习示例。请检查是否符合你的本意，再用自己的话说一遍。
            </p>
          </section>
          <section className="panel">
            <h3>让知识，再多走一步</h3>
            <p className="caption">以下关联在复盘阶段提供，只作启发。没有使用某篇笔记不会扣分。</p>
            {report.connections.map((c, i) => (
              <div className="connection" key={i}>
                <strong>{notes.find((n) => n.id === c.noteId)?.title || '关联笔记已删除'}</strong>
                <p>{c.inspiration}</p>
              </div>
            ))}
            {report.alternatives.map((a, i) => (
              <p key={i}>↗ {a}</p>
            ))}
            {!report.connections.length && <p className="muted">本次没有返回可核验的笔记关联。</p>}
          </section>
          <section className="panel">
            <h3>分析边界</h3>
            <p className="caption">
              此报告由音频模型结合
              WAV、未润色转写和声学停顿数据生成，属于待核实的训练建议。引用一致不等于判断一定正确。
            </p>
            {report.limitations.map((l, i) => (
              <p className="caption" key={i}>
                {l}
              </p>
            ))}
            {report.discarded > 0 && (
              <p className="caption">
                有 {report.discarded} 条未通过引用或时间依据校验的内容被过滤。
              </p>
            )}
            <button className="text-button" disabled={!!busy} onClick={onRetry}>
              重新分析（会重置人工确认）
            </button>
          </section>
        </>
      )}
      {previous && (
        <section className="panel comparison">
          <h3>和上一次的自己比一比</h3>
          <p className="caption">
            同一道题 · {date(previous.createdAt)} → 本次 · {previous.facts.duration.toFixed(1)} 秒 →{' '}
            {session.facts.duration.toFixed(1)}{' '}
            秒。时长不一致时，次数不能直接代表进步；优先比较具体表达。
          </p>
          {report && previous.report ? (
            <div className="comparison-grid">
              {kinds.map((kind) => (
                <div key={kind}>
                  <span>{kind}</span>
                  <strong>
                    {confirmed(previous, kind)} → {confirmed(session, kind)}
                  </strong>
                  <small>
                    已确认事件；疑似 {suspected(previous, kind)} → {suspected(session, kind)}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">两次均完成分析后，可比较已确认问题与疑似事件的变化。</p>
          )}
          <details>
            <summary>对照上一次的原文与总体反馈</summary>
            <p>{previous.report?.summary || '上次尚无分析'}</p>
            <p className="raw-text">{previous.transcript?.text || '上次尚无转写'}</p>
          </details>
          {session.threshold !== previous.threshold && (
            <p className="notice">两次停顿阈值不同，停顿次数不宜直接比较。</p>
          )}
        </section>
      )}
    </div>
  );
}
