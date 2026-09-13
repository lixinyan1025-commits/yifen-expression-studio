import { useEffect, useState, type ReactNode } from 'react';
import { LockKeyhole, ArrowRight, Leaf } from 'lucide-react';
import { storage } from './storage';
import {
  decryptKnowledge,
  loadEncryptedKnowledge,
  type EncryptedKnowledge,
} from './knowledgeBundle';
export default function AccessGate({ children }: { children: ReactNode }) {
  const cloud = import.meta.env.MODE === 'cloud';
  const githubPages = import.meta.env.MODE === 'pages';
  const protectedSite = cloud || githubPages;
  const storageKey = 'yifen-pages-access-until';
  const bundleKey = 'yifen-pages-knowledge-id';
  const [allowed, setAllowed] = useState(!protectedSite);
  const [checking, setChecking] = useState(protectedSite);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [knowledge, setKnowledge] = useState<EncryptedKnowledge>();
  async function check() {
    setChecking(true);
    setError('');
    if (githubPages) {
      try {
        const bundle = await loadEncryptedKnowledge();
        setKnowledge(bundle);
        const embedded = (await storage.notes()).filter((note) => note.source?.kind === 'obsidian');
        setAllowed(
          Number(localStorage.getItem(storageKey)) > Date.now() &&
            localStorage.getItem(bundleKey) === bundle.id &&
            embedded.length === bundle.noteCount,
        );
      } catch (cause) {
        setAllowed(false);
        setError(cause instanceof Error ? cause.message : '暂时无法读取加密知识库。');
      }
      setChecking(false);
      return;
    }
    try {
      const response = await fetch('/api/auth/session', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '暂时无法连接网站。');
      setAllowed(data.authenticated === true);
    } catch {
      setError('暂时无法连接网站，请检查网络后重试。');
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    if (!protectedSite) return;
    void check();
    const locked = () => {
      if (githubPages) localStorage.removeItem(storageKey);
      if (githubPages) localStorage.removeItem(bundleKey);
      setAllowed(false);
      setError('访问已过期，请重新输入密码。');
    };
    window.addEventListener('yifen-locked', locked);
    return () => window.removeEventListener('yifen-locked', locked);
  }, []);
  if (allowed) return <>{children}</>;
  return (
    <main className="access-page">
      <section className="access-card">
        <div className="access-brand">
          <Leaf size={22} />
          <span>一分 · 表达练习室</span>
        </div>
        <div className="access-icon">
          <LockKeyhole size={27} />
        </div>
        <h1>给表达，一点时间。</h1>
        <p>输入访问密码，开始今天的十一分钟。</p>
        {checking ? (
          <p role="status">正在连接练习室…</p>
        ) : (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError('');
              try {
                if (githubPages) {
                  const bundle = knowledge || (await loadEncryptedKnowledge());
                  await storage.syncVault(await decryptKnowledge(bundle, password));
                  localStorage.setItem(storageKey, String(Date.now() + 12 * 60 * 60 * 1000));
                  localStorage.setItem(bundleKey, bundle.id);
                } else {
                  const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Yifen-Request': '1' },
                    body: JSON.stringify({ password }),
                    signal: AbortSignal.timeout(15000),
                  });
                  const data = await response.json();
                  if (!response.ok) throw new Error(data.error || '暂时无法登录，请重试。');
                  if (data.authenticated !== true) throw new Error('登录未完成，请重试。');
                }
                setPassword('');
                setAllowed(true);
              } catch (e) {
                setError(e instanceof Error ? e.message : '连接失败，请重试。');
              } finally {
                setBusy(false);
              }
            }}
          >
            <label htmlFor="access-password">访问密码</label>
            <input
              id="access-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              disabled={busy}
            />
            <button className="primary" disabled={busy || !password}>
              {busy ? (githubPages ? '正在解锁知识库…' : '正在解锁…') : '进入练习室'}
              <ArrowRight size={18} />
            </button>
          </form>
        )}
        {error && (
          <div className="access-error" role="alert">
            {error}
            {cloud && (
              <button className="text-button" onClick={() => void check()} disabled={busy}>
                重新连接
              </button>
            )}
          </div>
        )}
        <p className="access-note">
          无需注册账号 · {githubPages ? '知识库只在当前浏览器解密' : '学习 10 分钟 + 表达 1 分钟'}
          <br />
          练习记录仅保存在当前浏览器
        </p>
      </section>
    </main>
  );
}
