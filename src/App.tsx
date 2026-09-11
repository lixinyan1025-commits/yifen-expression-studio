import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileText,
  History,
  Leaf,
  Mic,
  Plus,
  Pause,
  Play,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  Note,
  Report,
  ServiceStatus,
  Session,
  Topic,
  Transcript,
  VaultSnapshot,
} from '../shared/types';
import { localTopic, parseNote } from '../shared/notes';
import { storage } from './storage';
import { api, blobBase64 } from './api';
import { micError, startCapture, type RecorderControl } from './recorder';
import { date, download, NoteBody, ReportView, time } from './components';
import { readPreferences, savePreferences } from './preferences';

type Page = 'train' | 'library' | 'history' | 'settings';
type Phase =
  'idle' | 'study' | 'topic' | 'ready' | 'requesting' | 'recording' | 'saving' | 'review';
const pages = [
  { id: 'train', title: '今日练习', icon: Mic },
  { id: 'library', title: '我的知识库', icon: BookOpen },
  { id: 'history', title: '练习记录', icon: History },
  { id: 'settings', title: '服务与隐私', icon: Settings2 },
] as const;
const apiNotes = (notes: Note[]) =>
  notes.map(({ id, title, body, tags }) => ({ id, title, body: body.slice(0, 8000), tags }));
const cloud = import.meta.env.MODE === 'cloud';

export default function App() {
  const [preferences] = useState(readPreferences);
  const [page, setPage] = useState<Page>('train'),
    [phase, setPhase] = useState<Phase>('idle');
  const [notes, setNotes] = useState<Note[]>([]),
    [sessions, setSessions] = useState<Session[]>([]),
    [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string[]>(preferences.selected),
    [preview, setPreview] = useState<string>(),
    [search, setSearch] = useState('');
  const [vault, setVault] = useState<VaultSnapshot>();
  const [libraryGroup, setLibraryGroup] = useState('全部');
  const [hideIndex, setHideIndex] = useState(false);
  const [serviceOnline, setServiceOnline] = useState<boolean | null>(null);
  const [studyPaused, setStudyPaused] = useState(false);
  const pauseMilliseconds = useRef(600000);
  const [mode, setMode] = useState<'impromptu' | 'prepared'>(preferences.mode),
    [threshold, setThreshold] = useState(preferences.threshold);
  const [allowAi, setAllowAi] = useState(false),
    [useAiTopic, setUseAiTopic] = useState(preferences.useAiTopic);
  const [status, setStatus] = useState<ServiceStatus>(),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState('');
  const [topic, setTopic] = useState<Topic>();
  const [deadline, setDeadline] = useState<number>(),
    [remaining, setRemaining] = useState(600),
    [level, setLevel] = useState(0);
  const [active, setActive] = useState<Session>(),
    [previousId, setPreviousId] = useState<string>(),
    [unsaved, setUnsaved] = useState(false);
  const [recoveryAudio, setRecoveryAudio] = useState<Blob>(),
    [storageSize, setStorageSize] = useState('');
  const fileInput = useRef<HTMLInputElement>(null),
    recorder = useRef<RecorderControl | null>(null),
    endingStudy = useRef(false);
  const locked =
    ['study', 'topic', 'ready', 'requesting', 'recording', 'saving'].includes(phase) ||
    !!busy ||
    unsaved;
  const chosen = notes.filter((n) => selected.includes(n.id));
  const syncVault = async (announce = true) => {
    setBusy('正在同步 Obsidian 智慧笔记');
    try {
      const snapshot = await api<VaultSnapshot>('vault', {});
      if (snapshot.configured) {
        const next = await storage.syncVault(snapshot);
        setNotes(next);
        setSelected((ids) => ids.filter((id) => next.some((n) => n.id === id)));
        if (announce)
          setNotice(
            `已同步 ${snapshot.notes.length} 篇智慧笔记。仅更新网站缓存，Obsidian 原文件保持不变。`,
          );
      } else if (announce)
        setNotice('尚未配置 Obsidian 目录，请在本机 .env 设置 OBSIDIAN_WISDOM_PATH。');
      setVault(snapshot);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const refreshStatus = async () => {
    try {
      setStatus(await api<ServiceStatus>('status'));
      setServiceOnline(true);
    } catch {
      setServiceOnline(false);
    }
  };
  useEffect(() => {
    savePreferences({ mode, threshold, useAiTopic, selected });
  }, [mode, threshold, useAiTopic, selected]);
  useEffect(() => {
    void Promise.all([storage.notes(), storage.sessions()])
      .then(async ([n, s]) => {
        setNotes(n);
        setSessions(s);
        setSelected((ids) => ids.filter((id) => n.some((note) => note.id === id)));
        await syncVault(false);
        setLoaded(true);
      })
      .catch(() => setNotice('无法打开本机存储，请允许浏览器保存网站数据后刷新。'));
    void refreshStatus();
    void navigator.storage
      ?.estimate()
      .then((s) => setStorageSize(`${((s.usage || 0) / 1024 / 1024).toFixed(1)} MB`));
    return () => recorder.current?.cancel();
  }, []);
  useEffect(() => {
    if (!locked && !unsaved) return;
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [locked, unsaved]);
  useEffect(() => {
    if (phase !== 'recording') return;
    const hidden = () => {
      if (document.hidden) recorder.current?.stop(true);
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, [phase]);
  useEffect(() => {
    if (!deadline || !['study', 'recording'].includes(phase)) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        if (phase === 'study') void finishStudy();
        else recorder.current?.stop();
      }
    };
    tick();
    const id = setInterval(tick, 150);
    return () => clearInterval(id);
  }, [deadline, phase]);
  const navigate = (next: Page) => {
    if (!locked) {
      setPage(next);
      setNotice('');
    }
  };
  const saveSession = async (s: Session) => {
    setActive(s);
    try {
      await storage.saveSession(s);
      setSessions((all) => [...all.filter((x) => x.id !== s.id), s]);
      setUnsaved(false);
      return true;
    } catch {
      setUnsaved(true);
      setNotice('本机保存失败，可能存储空间不足。请先下载录音，释放空间后点击重新保存。');
      return false;
    }
  };
  const importFiles = async (files: FileList | File[]) => {
    setNotice('');
    setBusy('正在导入笔记');
    try {
      const entries = Array.from(files);
      if (entries.length > 300) throw new Error('每次最多导入 300 篇笔记，请分批导入。');
      const parsed: Note[] = [];
      for (const file of entries) {
        if (!file.name.toLowerCase().endsWith('.md'))
          throw new Error(`${file.name} 不是 Markdown 文件，请选择 .md 文件。`);
        if (file.size > 1000000) throw new Error(`${file.name} 超过 1 MB，请拆分后导入。`);
        const raw = await file.text();
        if (
          notes.some((n) => n.raw === raw && n.filename === file.name) ||
          parsed.some((n) => n.raw === raw && n.filename === file.name)
        )
          continue;
        parsed.push(parseNote(raw, file.name, crypto.randomUUID()));
      }
      await storage.saveNotes(parsed);
      setNotes((all) => [...all, ...parsed]);
      if (!selected.length) setSelected(parsed.slice(0, 3).map((n) => n.id));
      if (parsed[0]) setPreview(parsed[0].id);
      setNotice(
        `已导入 ${parsed.length} 篇笔记${entries.length > parsed.length ? '，完全重复的文件已跳过' : ''}。笔记只保存在此浏览器。`,
      );
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy('');
      if (fileInput.current) fileInput.current.value = '';
    }
  };
  const toggleNote = (id: string) => {
    if (selected.includes(id)) setSelected(selected.filter((x) => x !== id));
    else if (selected.length < 3) setSelected([...selected, id]);
    else setNotice('一次复盘最多关联 3 篇储备笔记，请先取消一篇。');
  };
  const removeNote = async (note: Note) => {
    if (
      !confirm(
        `从本网站删除《${note.title}》？原始 Markdown 文件不会被删除，已有复盘仍保留。${note.source ? '这是一篇直连笔记，下次同步会重新读取。' : ''}`,
      )
    )
      return;
    try {
      await storage.deleteNote(note.id);
      setNotes(notes.filter((n) => n.id !== note.id));
      setSelected(selected.filter((id) => id !== note.id));
      if (preview === note.id) setPreview(undefined);
    } catch {
      setNotice('删除失败，请重试。');
    }
  };
  const generate = async (local = false) => {
    const seed = localTopic(topic?.text);
    const result =
      !local && useAiTopic && status?.ai && allowAi
        ? await api<Topic>('topic', { category: seed.category, seed: seed.text })
        : seed;
    // Optional notes are attached for review inspiration only, never sent to topic generation.
    return { ...result, noteIds: chosen.map((n) => n.id) };
  };
  const beginStudy = async (local = false) => {
    setStudyPaused(false);
    setPage('train');
    setNotice('');
    setPreviousId(undefined);
    setActive(undefined);
    endingStudy.current = false;
    setPhase('topic');
    setBusy('正在准备话题相关信息');
    try {
      setTopic(await generate(local));
    } catch (e) {
      setNotice((e as Error).message);
      setPhase('idle');
      setBusy('');
      return;
    }
    setBusy('');
    setRemaining(600);
    setDeadline(Date.now() + 600000);
    setPhase('study');
  };
  const finishStudy = async (local = false) => {
    if (endingStudy.current) return;
    endingStudy.current = true;
    setStudyPaused(false);
    setDeadline(undefined);
    setNotice('');
    setPhase('topic');
    try {
      if (!topic) {
        setBusy('正在生成现实场景题');
        setTopic(await generate(local));
      }
      setRemaining(60);
      setPhase('ready');
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy('');
      endingStudy.current = false;
    }
  };
  const runAnalysis = async (s: Session) => {
    let next = { ...s, error: undefined };
    if (!allowAi) {
      await saveSession({
        ...next,
        error: '尚未允许上传。勾选下面的用途说明后，可转写并分析；也可以只在本机回听。',
      });
      return;
    }
    setBusy(s.transcript ? '正在结合音频和原话分析' : '正在转写原始录音');
    setNotice('');
    try {
      const encoded = await blobBase64(s.audio);
      if (!next.transcript) {
        next.transcript = await api<Transcript>('transcribe', {
          audio: encoded,
          threshold: s.threshold,
        });
        if (!(await saveSession(next))) return;
      }
      setBusy('正在结合音频、停顿和原话分析');
      next.report = await api<Report>('analyze', {
        audio: encoded,
        threshold: s.threshold,
        transcript: next.transcript,
        topic: s.topic.text,
        notes: apiNotes(notes.filter((n) => s.topic.noteIds.includes(n.id))),
      });
      await saveSession(next);
    } catch (e) {
      await saveSession({ ...next, error: (e as Error).message });
    } finally {
      setBusy('');
    }
  };
  const record = async () => {
    if (!topic || recorder.current || phase === 'requesting') return;
    setNotice('');
    setRecoveryAudio(undefined);
    setPhase('requesting');
    try {
      recorder.current = await startCapture({
        threshold,
        onStart: (end) => {
          setRemaining(60);
          setDeadline(end);
          setPhase('recording');
        },
        onLevel: setLevel,
        onFinish: (capture) => {
          recorder.current = null;
          setDeadline(undefined);
          setPhase('saving');
          const s: Session = {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            topic,
            mode,
            previousId,
            ...capture,
            threshold,
          };
          void (async () => {
            const saved = await saveSession(s);
            setPhase('review');
            if (saved && allowAi) await runAnalysis(s);
          })();
        },
        onError: (message, original) => {
          recorder.current = null;
          setDeadline(undefined);
          setPhase('ready');
          setNotice(`录音处理失败：${message}`);
          setRecoveryAudio(original);
        },
      });
    } catch (e) {
      setPhase('ready');
      setNotice(micError(e));
    }
  };
  const again = (s: Session) => {
    if (unsaved) {
      setNotice('请先重新保存当前录音，再开始下一次练习。');
      return;
    }
    setTopic(s.topic);
    setMode(s.mode);
    setPreviousId(s.id);
    setActive(undefined);
    setPage('train');
    setPhase('ready');
    setRemaining(60);
    setNotice('');
    setThreshold(s.threshold);
  };
  const openSession = (s: Session) => {
    setActive(s);
    setPhase('review');
    setPage('train');
    setNotice('');
  };
  const consent = (
    <label className="consent">
      <input
        type="checkbox"
        checked={allowAi}
        onChange={(e) => setAllowAi(e.target.checked)}
        disabled={!!busy}
      />
      <span>
        允许本次训练使用 AI
        出题、转写与复盘。出题不上传笔记；复盘可上传题目、录音和所选储备笔记节选。
        <small>
          经{cloud ? '云端' : '本机'}服务发送至 {status?.aiHost || '配置的 AI 服务'} /{' '}
          {status?.sttHost || '语音服务'}
          ；每篇笔记最多前 8,000 字符。取消勾选后不再发起新请求。
        </small>
      </span>
    </label>
  );
  const selectedNote = notes.find((n) => n.id === preview);
  const noteGroup = (n: Note) =>
    !n.source
      ? '手动导入'
      : n.source.relativePath.split('/')[0].includes('入世')
        ? '入世'
        : n.source.relativePath.split('/')[0].includes('出世')
          ? '出世'
          : '目录页';
  const filteredNotes = notes.filter(
    (n) =>
      (libraryGroup === '全部' || noteGroup(n) === libraryGroup) &&
      (!hideIndex || !n.source?.isIndex) &&
      `${n.title} ${n.body} ${n.tags.join(' ')}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const toggleStudyPause = () => {
    if (studyPaused) {
      setDeadline(Date.now() + pauseMilliseconds.current);
      setStudyPaused(false);
    } else if (deadline) {
      pauseMilliseconds.current = Math.max(0, deadline - Date.now());
      if (!pauseMilliseconds.current) {
        void finishStudy();
        return;
      }
      setRemaining(Math.ceil(pauseMilliseconds.current / 1000));
      setDeadline(undefined);
      setStudyPaused(true);
    }
  };
  const recent = [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate('train');
          }}
        >
          <span className="brand-mark">一</span>
          <span>
            一分<span className="brand-sub">表达练习室</span>
          </span>
        </a>
        <div className="sidebar-caption">把知道的，变成说得出的。</div>
        <nav aria-label="主导航">
          {pages.map((p) => (
            <button
              key={p.id}
              aria-label={p.title}
              className={page === p.id ? 'selected' : ''}
              disabled={locked}
              onClick={() => navigate(p.id)}
            >
              <p.icon size={19} />
              <span className="desktop-nav-label">{p.title}</span>
              <span className="mobile-nav-label">
                {{ train: '练习', library: '知识库', history: '记录', settings: '设置' }[p.id]}
              </span>
              {p.id === 'library' && <small>{notes.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="mini-leaf">
            <Leaf size={20} />
          </div>
          <p>
            表达是一种
            <br />
            可以慢慢长出的能力。
          </p>
          <div className="local-state">
            <span /> 本机保存 · 属于你的练习
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <span>个人成长</span>
            <ChevronRight size={14} />
            <strong>{pages.find((p) => p.id === page)?.title}</strong>
          </div>
          <span className="topbar-note">
            每天十一分钟，向清楚表达靠近一点 <span className="avatar">言</span>
          </span>
        </header>
        <div className="content">
          {cloud && phase === 'idle' && (
            <div className="notice">
              <ShieldCheck size={20} />
              <span>密码访问 · 练习记录保存在当前浏览器。</span>
            </div>
          )}
          {serviceOnline === false && (
            <div role="status" className="notice warning service-offline">
              <div>
                <strong>{cloud ? '在线服务暂时未连接' : '本地网站服务未连接'}</strong>
                <p>
                  {cloud
                    ? '已保存的笔记和录音仍在当前浏览器。请检查网络，确认已登录站点所属账号，再点击重新检测。'
                    : '已保存的笔记和录音仍在本机。请双击项目里的「打开表达练习室.cmd」，再点击重新检测。'}
                </p>
              </div>
              <button onClick={() => void refreshStatus()}>重新检测</button>
            </div>
          )}
          {notice && (
            <div role="alert" className="notice">
              <span>{notice}</span>
              <button aria-label="关闭提示" className="icon-button" onClick={() => setNotice('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {unsaved && active && (
            <div className="notice warning">
              当前记录尚未持久保存。
              <button onClick={() => void saveSession(active)}>重新保存</button>
              <button onClick={() => download(active.audio, '未保存的演讲.wav')}>下载录音</button>
            </div>
          )}
          {recoveryAudio && (
            <div className="notice warning">
              原始录音可恢复下载。
              <button
                onClick={() =>
                  download(
                    recoveryAudio,
                    recoveryAudio.type.includes('mp4') ? '恢复录音.m4a' : '恢复录音.webm',
                  )
                }
              >
                下载原始录音
              </button>
            </div>
          )}
          {!loaded ? (
            <section className="panel">
              <span className="spinner" /> 正在打开本机知识库…
            </section>
          ) : (
            <>
              {vault?.configured &&
                (page === 'library' ||
                  (page === 'train' && phase === 'idle') ||
                  page === 'settings') && (
                  <section className="vault-connection">
                    <BookOpen size={20} />
                    <div>
                      <strong>已连接 Obsidian · 智慧</strong>
                      <p>{vault.rootPath}</p>
                      <span>
                        入世与出世 · {vault.notes.length} 篇 · 最近同步 {date(vault.syncedAt)} ·
                        只读连接
                      </span>
                    </div>
                    <button disabled={locked} onClick={() => void syncVault()}>
                      同步更新
                    </button>
                  </section>
                )}
              {page === 'train' && phase === 'idle' && (
                <>
                  <div className="page-intro">
                    <span className="eyebrow">A LITTLE PRACTICE, A CLEARER VOICE</span>
                    <h1>把想法，自然说出来。</h1>
                    <p>每天一个常见话题，慢慢读，认真想，开口一分钟。</p>
                  </div>
                  <section className="hero">
                    <div className="hero-copy">
                      <span className="pill">
                        <span /> 今日表达训练
                      </span>
                      <h2>
                        十分钟，向内学习。
                        <br />
                        一分钟，向外表达。
                      </h2>
                      <p>
                        从常见话题出发，先读一点背景信息。
                        <br />
                        不必一开始就说得漂亮，先试着说清楚。
                      </p>
                      <button className="primary" onClick={() => void beginStudy()}>
                        开始今天的练习
                        <ArrowRight size={18} />
                      </button>
                      <span className="hero-foot">
                        先学习，再演讲 · 无需导入笔记
                        <span>·</span> 约 11 分钟
                      </span>
                    </div>
                    <div className="orbit-art" aria-label="十分钟学习加一分钟表达">
                      <div className="orbit orbit-one" />
                      <div className="orbit orbit-two" />
                      <div className="orbit-center">
                        <span>
                          10<small>min</small>
                        </span>
                        <span className="orbit-plus">＋</span>
                        <span>
                          1<small>min</small>
                        </span>
                      </div>
                      <span className="orbit-label top">
                        <BookOpen size={16} /> 内化
                      </span>
                      <span className="orbit-label bottom">
                        <Mic size={16} /> 表达
                      </span>
                      <span className="orbit-dot" />
                      <div className="art-caption">LEARN. CONNECT. SPEAK.</div>
                    </div>
                  </section>
                  <div className="dashboard-grid">
                    <section className="panel setup">
                      <div className="row spread">
                        <h3>找到适合你的节奏</h3>
                        <Settings2 size={17} />
                      </div>
                      <div className="mode-grid">
                        <button
                          className={mode === 'impromptu' ? 'mode-card active' : 'mode-card'}
                          onClick={() => setMode('impromptu')}
                        >
                          <span>
                            <Sparkles size={17} />
                            临场模式 <small>推荐</small>
                          </span>
                          <p>
                            先学习，再揭晓题目
                            <br />
                            练习当下的联想与组织
                          </p>
                          <i>{mode === 'impromptu' && <Check size={13} />}</i>
                        </button>
                        <button
                          className={mode === 'prepared' ? 'mode-card active' : 'mode-card'}
                          onClick={() => setMode('prepared')}
                        >
                          <span>
                            <FileText size={17} />
                            准备模式
                          </span>
                          <p>
                            先看题目，带着问题学
                            <br />
                            练习有方向地吸收知识
                          </p>
                          <i>{mode === 'prepared' && <Check size={13} />}</i>
                        </button>
                      </div>
                      <label className="inline-select">
                        题目来源
                        <select
                          value={useAiTopic ? 'ai' : 'local'}
                          onChange={(e) => setUseAiTopic(e.target.value === 'ai')}
                        >
                          <option value="ai">AI 场景题（未配置时使用内置题）</option>
                          <option value="local">常见话题 · 随机抽取</option>
                        </select>
                      </label>
                      {consent}
                    </section>
                    <section className="panel materials">
                      <div className="row spread">
                        <h3>我的个人储备</h3>
                        <button className="text-button" onClick={() => navigate('library')}>
                          {notes.length ? '选择笔记' : '去导入'}
                          <ArrowUpRight size={15} />
                        </button>
                      </div>
                      {chosen.length ? (
                        chosen.map((n) => (
                          <div className="material-row" key={n.id}>
                            <FileText size={17} />
                            <div>
                              <strong>{n.title}</strong>
                              <span>
                                {n.tags
                                  .slice(0, 2)
                                  .map((t) => `#${t}`)
                                  .join(' ') || '来自你的知识库'}
                              </span>
                            </div>
                            <Check size={14} />
                          </div>
                        ))
                      ) : (
                        <div className="empty-small">
                          <BookOpen size={28} />
                          <p>
                            知识库供你平时积累，题目独立抽取。可选最多 3
                            篇笔记，仅在复盘时提供关联启发。
                          </p>
                        </div>
                      )}
                      <button
                        className="text-button system-pick"
                        onClick={() => {
                          setSelected([]);
                          setNotice('本次不指定复盘笔记。题目和学习信息照常独立抽取。');
                        }}
                      >
                        不指定复盘笔记
                      </button>
                    </section>
                  </div>
                  <section className="journey">
                    <div className="row spread">
                      <h3>一次练习，四个小步骤</h3>
                      <span>不背标准答案，练自己的表达</span>
                    </div>
                    <div className="journey-steps">
                      {[
                        {
                          n: '01',
                          title: '专注学习',
                          text: '读一点相关信息，想起自己的经历',
                          icon: BookOpen,
                        },
                        {
                          n: '02',
                          title: '遇见问题',
                          text: '把知识带入一个真实场景',
                          icon: CircleHelp,
                        },
                        { n: '03', title: '开口一分钟', text: '放下资料，说出你的判断', icon: Mic },
                        {
                          n: '04',
                          title: '回听，再试一次',
                          text: '找到一个具体的进步方向',
                          icon: History,
                        },
                      ].map((s) => (
                        <div key={s.n}>
                          <span className="step-num">{s.n}</span>
                          <s.icon size={20} />
                          <h4>{s.title}</h4>
                          <p>{s.text}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                  <div className="storage-footer">
                    <ShieldCheck size={14} />{' '}
                    笔记和练习记录默认保存在当前浏览器。只有你允许后，才会上传内容进行 AI 处理。
                  </div>
                </>
              )}
              {page === 'train' && phase === 'study' && (
                <>
                  <div className="stage-label">
                    <span className="stage-active">01 学习</span>
                    <span>02 演讲</span>
                    <span>03 复盘</span>
                  </div>
                  <div className="study-heading">
                    <div>
                      <span className="eyebrow">留一点时间，给新的连接</span>
                      <h1>现在，只管认真读。</h1>
                      <p>
                        {mode === 'impromptu'
                          ? '题目将在学习结束后揭晓。你不需要提前准备一篇稿子。'
                          : '带着下面的问题学习，之后用自己的话回答。'}
                      </p>
                    </div>
                    <div className="study-clock">
                      <Clock3 size={18} />
                      <strong role="timer" aria-label="学习剩余时间">
                        {time(remaining)}
                      </strong>
                      <span>{studyPaused ? '已暂停 · 可以慢慢读' : '学习倒计时'}</span>
                    </div>
                  </div>
                  <div className="study-tools">
                    <span>
                      {topic?.category} · 3 条背景信息 · {studyPaused ? '计时已暂停' : '专注学习中'}
                    </span>
                    <div className="row">
                      <button onClick={toggleStudyPause}>
                        {studyPaused ? <Play size={14} /> : <Pause size={14} />}{' '}
                        {studyPaused ? '继续计时' : '暂停学习'}
                      </button>
                      <button
                        className="text-button"
                        onClick={() => {
                          setDeadline(undefined);
                          setStudyPaused(false);
                          setTopic(undefined);
                          setPhase('idle');
                        }}
                      >
                        退出学习
                      </button>
                    </div>
                  </div>
                  {mode === 'prepared' && topic && (
                    <div className="prepared-topic">
                      <span className="tag">准备模式 · 本次题目</span>
                      <h3>{topic.text}</h3>
                      <span className="caption">
                        {topic.source === 'ai' ? 'AI 场景题' : '常见话题 · 随机抽取'}
                      </span>
                    </div>
                  )}
                  <section className="reading-brief" aria-label="话题相关信息">
                    <div className="brief-intro">
                      <span className="eyebrow">读一点，想一想</span>
                      <h2>关于{topic?.category}</h2>
                      <p>以下是帮助理解话题的简短情境资料。没有标准答案，可以联系你自己的经历。</p>
                    </div>
                    {topic?.reading?.map((item, i) => (
                      <article className="brief-card" key={i}>
                        <span className="brief-number">0{i + 1}</span>
                        <div>
                          <h3>{item.title}</h3>
                          <p>{item.text}</p>
                        </div>
                      </article>
                    ))}
                    <p className="caption">
                      {topic?.source === 'ai'
                        ? 'AI 生成的情境资料，请结合自己的判断阅读。'
                        : '编辑整理的常见情境资料，独立于个人笔记。'}{' '}
                      可以提前结束学习，再用一分钟表达自己的看法。
                    </p>
                  </section>
                  <div className="row spread study-actions">
                    <span className="muted">不必记住每一句。留下真正触动你的想法。</span>
                    <button className="primary" onClick={() => void finishStudy()}>
                      结束学习，进入挑战
                      <ArrowRight size={17} />
                    </button>
                  </div>
                </>
              )}
              {page === 'train' && phase === 'topic' && (
                <section className="focus-card panel">
                  <span className="eyebrow">CONNECT TO REAL LIFE</span>
                  <h1>{busy ? '把知识带回生活。' : '题目还没有准备好'}</h1>
                  <p>{busy || '可以重试出题，或选择内置现实场景题继续。'}</p>
                  {busy ? (
                    <span className="spinner" />
                  ) : (
                    <div className="row center">
                      <button className="primary" onClick={() => void finishStudy()}>
                        重试出题
                      </button>
                      <button onClick={() => void finishStudy(true)}>使用内置场景题</button>
                    </div>
                  )}
                </section>
              )}
              {page === 'train' &&
                ['ready', 'requesting', 'recording', 'saving'].includes(phase) &&
                topic && (
                  <>
                    <div className="stage-label">
                      <span>01 学习</span>
                      <span className="stage-active">02 演讲</span>
                      <span>03 复盘</span>
                    </div>
                    <section className="focus-card panel">
                      <span className="pill">
                        {topic.category} <span>·</span>{' '}
                        {topic.source === 'ai' ? 'AI 场景题' : '内置场景题'}
                      </span>
                      <h1 className="speech-question">{topic.text}</h1>
                      <p>没有唯一答案。用你的知识、经历和判断，说清楚自己的想法。</p>
                      <div
                        className={`speech-timer ${phase === 'recording' ? 'is-recording' : ''}`}
                        style={
                          {
                            '--progress': `${(phase === 'recording' ? remaining / 60 : 1) * 360}deg`,
                          } as React.CSSProperties
                        }
                      >
                        <div>
                          <strong role="timer" aria-label="演讲剩余时间">
                            {time(remaining)}
                          </strong>
                          <span>
                            {phase === 'recording'
                              ? '正在录音'
                              : phase === 'requesting'
                                ? '等待麦克风权限'
                                : phase === 'saving'
                                  ? '正在保存录音'
                                  : '准备好，再开始'}
                          </span>
                        </div>
                      </div>
                      <div className="mic-state">
                        <span className={phase === 'recording' ? 'record-dot' : 'gray-dot'} />
                        {phase === 'recording'
                          ? '麦克风已连接 · 录音中'
                          : phase === 'requesting'
                            ? '请在浏览器提示中允许使用麦克风'
                            : '尚未录音 · 点击开始时请求麦克风权限'}
                      </div>
                      {phase === 'recording' && (
                        <div className="level-meter" aria-label="实时麦克风音量">
                          <span style={{ width: `${Math.min(100, level * 650)}%` }} />
                        </div>
                      )}
                      <div className="speech-actions">
                        {phase === 'recording' ? (
                          <button className="danger" onClick={() => recorder.current?.stop()}>
                            <Square size={16} />
                            结束演讲，查看复盘
                          </button>
                        ) : (
                          <button
                            className="primary"
                            disabled={phase !== 'ready'}
                            onClick={() => void record()}
                          >
                            <Mic size={18} />
                            {phase === 'requesting'
                              ? '等待麦克风…'
                              : phase === 'saving'
                                ? '正在处理录音…'
                                : '开始演讲'}
                          </button>
                        )}
                      </div>
                      <span className="caption">
                        {phase === 'recording'
                          ? '到时自动结束。请保持页面在前台，切换页面会提前停止并保存。'
                          : '开始后同步录音与计时，60 秒自动结束。学习资料已收起。'}
                      </span>
                      {phase === 'ready' && (
                        <button
                          className="text-button exit-training"
                          onClick={() => {
                            setPhase('idle');
                            setTopic(undefined);
                          }}
                        >
                          退出本次挑战
                        </button>
                      )}
                    </section>
                  </>
                )}
              {page === 'train' && phase === 'review' && active && (
                <>
                  <ReportView
                    session={active}
                    notes={notes}
                    previous={sessions.find((s) => s.id === active.previousId)}
                    onUpdate={(s) => void saveSession(s)}
                    onRetry={() => void runAnalysis(active)}
                    onAgain={() => again(active)}
                    busy={busy}
                  />
                  <section className="panel upload-consent">{consent}</section>
                  <button
                    className="text-button"
                    disabled={!!busy}
                    onClick={() => setPhase('idle')}
                  >
                    返回今日练习
                  </button>
                </>
              )}
              {page === 'library' && (
                <>
                  <div className="page-intro row spread">
                    <div>
                      <span className="eyebrow">YOUR KNOWLEDGE, YOUR VOICE</span>
                      <h1>我的知识库</h1>
                      <p>让你认真记下的东西，有机会在生活里派上用场。</p>
                    </div>
                    <button
                      className="primary"
                      disabled={!!busy}
                      onClick={() => fileInput.current?.click()}
                    >
                      <Plus size={18} />
                      导入 Markdown
                    </button>
                  </div>
                  <input
                    ref={fileInput}
                    type="file"
                    aria-label="导入 Markdown 笔记"
                    accept=".md,text/markdown"
                    multiple
                    hidden
                    onChange={(e) => e.target.files && void importFiles(e.target.files)}
                  />
                  {!vault?.configured && (
                    <div className="notice">
                      <span>
                        {cloud
                          ? '在线版请导入智慧目录中的 .md 文件；云端无法直接读取你电脑的 Obsidian。'
                          : '可在本机配置 Obsidian 智慧目录，实现只读同步。'}
                      </span>
                      {!cloud && (
                        <button disabled={!!busy} onClick={() => void syncVault()}>
                          读取本机连接
                        </button>
                      )}
                    </div>
                  )}
                  {!notes.length ? (
                    <section
                      className="import-area"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (!busy) void importFiles(e.dataTransfer.files);
                      }}
                    >
                      <div className="import-icon">
                        <Upload size={30} />
                      </div>
                      <h2>把你的思考，带到这里。</h2>
                      <p>
                        拖入 Obsidian 的 Markdown 笔记，或批量选择 .md 文件。
                        <br />
                        保留标题、正文与标签，原始文件不受影响。
                      </p>
                      <button disabled={!!busy} onClick={() => fileInput.current?.click()}>
                        选择笔记文件
                        <ArrowUpRight size={16} />
                      </button>
                      <span className="caption">只导入文本 · 每篇最多 1 MB · 每批最多 300 篇</span>
                    </section>
                  ) : (
                    <>
                      <div className="library-toolbar">
                        <label className="search">
                          <Search size={17} />
                          <input
                            aria-label="搜索笔记"
                            placeholder="搜索标题、内容或标签"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </label>
                        <span>
                          显示 {filteredNotes.length}/{notes.length} 篇 · 已选 {selected.length}/3
                          篇
                        </span>
                        <button className="primary" onClick={() => void beginStudy()}>
                          先学资料，再演讲
                          <ArrowRight size={15} />
                        </button>
                      </div>
                      <div className="library-filters">
                        <div className="filter-tabs" role="group" aria-label="笔记分类">
                          {['全部', '入世', '出世', '手动导入'].map((group) => (
                            <button
                              key={group}
                              aria-pressed={libraryGroup === group}
                              className={libraryGroup === group ? 'active' : ''}
                              onClick={() => setLibraryGroup(group)}
                            >
                              {group}
                              <small>
                                {group === '全部'
                                  ? notes.length
                                  : notes.filter((n) => noteGroup(n) === group).length}
                              </small>
                            </button>
                          ))}
                        </div>
                        <label>
                          <input
                            type="checkbox"
                            checked={hideIndex}
                            onChange={(e) => setHideIndex(e.target.checked)}
                          />
                          隐藏入口页
                        </label>
                      </div>
                      {chosen.length > 0 && (
                        <div className="selection-basket">
                          <span>本次学习</span>
                          {chosen.map((n) => (
                            <button
                              key={n.id}
                              aria-label={`取消选择 ${n.title}`}
                              onClick={() => toggleNote(n.id)}
                            >
                              <span>{n.title}</span>
                              <X size={12} />
                            </button>
                          ))}
                          <button className="text-button" onClick={() => setSelected([])}>
                            清空选择
                          </button>
                        </div>
                      )}
                      <div className="library-layout">
                        <section className="panel note-list">
                          {filteredNotes.map((n) => (
                            <div
                              className={`note-row ${preview === n.id ? 'active' : ''}`}
                              key={n.id}
                            >
                              <input
                                aria-label={`选择 ${n.title}`}
                                type="checkbox"
                                checked={selected.includes(n.id)}
                                onChange={() => toggleNote(n.id)}
                              />
                              <button className="note-open" onClick={() => setPreview(n.id)}>
                                <FileText size={18} />
                                <span>
                                  <strong>{n.title}</strong>
                                  <small>
                                    {n.tags.map((t) => `#${t}`).join(' ') || n.filename}
                                  </small>
                                </span>
                              </button>
                              <button
                                className="icon-button"
                                aria-label={`删除 ${n.title}`}
                                onClick={() => void removeNote(n)}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          ))}
                          {!filteredNotes.length && (
                            <div className="empty-small">
                              <Search size={24} />
                              <p>当前筛选下没有笔记。</p>
                              <button
                                className="text-button"
                                onClick={() => {
                                  setSearch('');
                                  setLibraryGroup('全部');
                                  setHideIndex(false);
                                }}
                              >
                                清除筛选
                              </button>
                            </div>
                          )}
                        </section>
                        <section className="panel note-preview">
                          {selectedNote ? (
                            <>
                              <span className="eyebrow">笔记原文</span>
                              <h2>{selectedNote.title}</h2>
                              {selectedNote.source && (
                                <p className="caption">
                                  来自 Obsidian · {selectedNote.source.relativePath}
                                  {selectedNote.source.isIndex ? ' · 入口/索引页' : ''}
                                </p>
                              )}
                              <div className="tags">
                                {selectedNote.tags.map((t) => (
                                  <span className="tag" key={t}>
                                    #{t}
                                  </span>
                                ))}
                              </div>
                              <NoteBody note={selectedNote} />
                              <details>
                                <summary>查看完整 Markdown 源文件</summary>
                                <pre>{selectedNote.raw}</pre>
                              </details>
                            </>
                          ) : (
                            <div className="empty-small">
                              <BookOpen size={32} />
                              <p>选择一篇笔记，开始阅读。</p>
                            </div>
                          )}
                        </section>
                      </div>
                    </>
                  )}
                  <div className="storage-footer">
                    <ShieldCheck size={15} /> 本机同步和手动导入均不会上传到
                    AI。仅只读访问已配置的智慧目录；附件仅显示名称，双链显示文字。
                  </div>
                </>
              )}
              {page === 'history' && (
                <>
                  <div className="page-intro">
                    <span className="eyebrow">SMALL STEPS, REAL PROGRESS</span>
                    <h1>每一次开口，都算数。</h1>
                    <p>这里记录你的尝试。与过去的自己比较，不必与标准答案比较。</p>
                  </div>
                  <div className="history-summary">
                    <div>
                      <strong>{sessions.length}</strong>
                      <span>次真实练习</span>
                    </div>
                    <div>
                      <strong>
                        {(sessions.reduce((sum, s) => sum + s.facts.duration, 0) / 60).toFixed(1)}
                      </strong>
                      <span>分钟表达</span>
                    </div>
                    <div>
                      <strong>{sessions.filter((s) => s.report).length}</strong>
                      <span>份已生成复盘</span>
                    </div>
                  </div>
                  <section className="panel">
                    {recent.length ? (
                      recent.map((s) => (
                        <div className="history-row" key={s.id}>
                          <span className="history-icon">
                            <Mic size={19} />
                          </span>
                          <button className="history-open" onClick={() => openSession(s)}>
                            <strong>{s.topic.text}</strong>
                            <span>
                              {date(s.createdAt)} · {s.facts.duration.toFixed(1)} 秒 ·{' '}
                              {s.report ? '复盘已生成' : s.transcript ? '等待分析' : '等待转写'}
                              {s.previousId ? ' · 同题再练' : ''}
                            </span>
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`删除 ${date(s.createdAt)} 的记录`}
                            onClick={async () => {
                              if (confirm('删除这次练习的录音、转写和报告？此操作无法撤销。')) {
                                try {
                                  await storage.deleteSession(s.id);
                                  setSessions(sessions.filter((x) => x.id !== s.id));
                                  if (active?.id === s.id) {
                                    setActive(undefined);
                                    setPhase('idle');
                                  }
                                } catch {
                                  setNotice('删除失败，请重试。');
                                }
                              }
                            }}
                          >
                            <Trash2 size={17} />
                          </button>
                          <ChevronRight size={17} />
                        </div>
                      ))
                    ) : (
                      <div className="empty-large">
                        <History size={32} />
                        <h3>你的第一段表达，还在等你。</h3>
                        <p>完成一次录音后，会自动保存在这里。</p>
                        <button
                          className="primary"
                          onClick={() => {
                            setPage('train');
                            setPhase('idle');
                          }}
                        >
                          开始练习
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    )}
                  </section>
                  <div className="storage-footer">
                    记录保存在 {location.origin} 的浏览器 IndexedDB 中；不会同步到其他浏览器或设备。
                  </div>
                </>
              )}
              {page === 'settings' && (
                <>
                  <div className="page-intro">
                    <span className="eyebrow">A SPACE YOU CAN TRUST</span>
                    <h1>服务与隐私</h1>
                    {cloud && (
                      <button
                        className="text-button"
                        onClick={async () => {
                          try {
                            await api('auth/logout', {});
                            window.dispatchEvent(new Event('yifen-locked'));
                          } catch {
                            setNotice('暂时无法退出，请稍后重试。');
                          }
                        }}
                      >
                        锁定网站
                      </button>
                    )}
                    <p>知道内容存在哪里，也知道每次上传是为了什么。</p>
                  </div>
                  <section className="panel">
                    <div className="row spread">
                      <h3>语音与 AI 服务</h3>
                      <button className="text-button" onClick={() => void refreshStatus()}>
                        刷新配置状态
                      </button>
                    </div>
                    <div className="service-grid">
                      <div>
                        <Mic size={22} />
                        <h3>语音转写</h3>
                        <span className={`tag ${status?.stt ? 'good' : ''}`}>
                          {status?.stt ? '已配置 · 尚需实际调用验证' : '未配置'}
                        </span>
                        <p>{status?.sttHost || '本地服务尚未连接'}</p>
                        <code>{status?.sttModel || 'whisper-1'}</code>
                      </div>
                      <div>
                        <Sparkles size={22} />
                        <h3>题目与音频分析</h3>
                        <span className={`tag ${status?.ai ? 'good' : ''}`}>
                          {status?.ai ? '已配置 · 尚需实际调用验证' : '未配置'}
                        </span>
                        <p>{status?.aiHost || '本地服务尚未连接'}</p>
                        <code>{status?.audioModel || 'gpt-audio'}</code>
                      </div>
                    </div>
                    <p>
                      {cloud ? (
                        '在线版密钥仅在 Sites 的环境变量设置中配置，前端不会读取密钥。配置 AI_API_KEY、STT_API_KEY 及所需模型后，重新发布网站即可使用。'
                      ) : (
                        <>
                          密钥仅由本机 Node 服务读取。请编辑项目中的 <code>.env</code>，保留已有
                          Obsidian 路径，在本机填写服务地址、密钥和模型，再重启网站服务。
                        </>
                      )}
                    </p>
                    <details>
                      <summary>查看配置字段与接口要求</summary>
                      <pre>
                        {
                          'AI_BASE_URL=https://api.openai.com/v1\nAI_API_KEY=在服务端安全设置中填写\nTOPIC_MODEL=gpt-4o-mini\nAUDIO_MODEL=gpt-audio\nSTT_BASE_URL=https://api.openai.com/v1\nSTT_API_KEY=在服务端安全设置中填写（留空则使用 AI_API_KEY）\nSTT_MODEL=whisper-1'
                        }
                      </pre>
                      <p>
                        转写接口须支持 audio/transcriptions、verbose_json
                        及分段时间戳。音频分析须支持 chat/completions 的 input_audio WAV
                        输入与文本输出。只支持文本的模型不能完成这里的音频分析。
                      </p>
                    </details>
                    <p className="caption">
                      没有服务也能完成学习、内置题目、录音与回听；完整表达分析需要真实服务。
                      {cloud
                        ? '本站通过访问密码解锁，无需注册或登录 ChatGPT 账号。'
                        : '本地版仅监听当前电脑。'}
                    </p>
                  </section>
                  <section className="panel">
                    <h3>停顿观察阈值</h3>
                    <label className="range-label">
                      <input
                        type="range"
                        aria-label="停顿阈值"
                        min="0.5"
                        max="5"
                        step="0.1"
                        value={threshold}
                        onChange={(e) => setThreshold(Number(e.target.value))}
                      />
                      <strong>{threshold.toFixed(1)} 秒</strong>
                    </label>
                    <p className="caption">
                      应用于下一次新训练。再次挑战沿用上次阈值，保持比较条件一致。超过阈值的低音量区间只作为候选证据，不直接判为思路中断。
                    </p>
                  </section>
                  <section className="panel">
                    <h3>你的数据，存在哪里</h3>
                    <div className="privacy-row">
                      <ShieldCheck size={21} />
                      <div>
                        <strong>当前浏览器 · {location.origin}</strong>
                        <p>
                          数据库：yifen-expression（IndexedDB）。笔记、题目、日期、原始录音、WAV、转写和分析均保存在这里。当前网站存储约{' '}
                          {storageSize || '待统计'}。
                        </p>
                        <p>
                          更换端口、浏览器或设备会看到独立的数据。清除网站数据、隐私浏览结束或浏览器回收空间，可能丢失记录。重要录音请下载保存。
                        </p>
                        <button
                          className="text-button"
                          onClick={async () => {
                            const granted = await navigator.storage?.persist?.();
                            setNotice(
                              granted
                                ? '浏览器已授予持久存储，可降低自动回收风险。仍建议备份重要录音。'
                                : '浏览器未授予持久存储，请下载重要录音作为备份。',
                            );
                          }}
                        >
                          请求浏览器保留本机数据
                        </button>
                      </div>
                    </div>
                    <h3>上传的范围与用途</h3>
                    <p>
                      勾选允许后，AI 出题只发送随机生活主题和问题种子；转写会发送本次
                      WAV；复盘会发送同一
                      WAV、题目、原始转写、停顿数据与所选笔记节选。出题仅发送常见主题，不发送笔记。不会发送整个知识库。
                    </p>
                    <p>
                      {cloud ? '云端接口' : '本机服务器'}
                      不持久保存音频和笔记，也不记录内容日志。配置的服务提供方可能按其政策保留上传内容；删除本机记录不会删除服务方已接收的数据。
                    </p>
                    {consent}
                  </section>
                </>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>一分 · 表达练习室</span>
            <span>把想法说清楚，从这一分钟开始。</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
