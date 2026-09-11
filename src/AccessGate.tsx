import { useEffect, useState, type ReactNode } from 'react';
import { LockKeyhole, ArrowRight, Leaf } from 'lucide-react';
export default function AccessGate({ children }: { children: ReactNode }) {
  const cloud = import.meta.env.MODE === 'cloud';
  const [allowed, setAllowed] = useState(!cloud);
  const [checking, setChecking] = useState(cloud);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function check() {
    setChecking(true);
    setError('');
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
    if (!cloud) return;
    void check();
    const locked = () => {
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
                const response = await fetch('/api/auth/login', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-Yifen-Request': '1' },
                  body: JSON.stringify({ password }),
                  signal: AbortSignal.timeout(15000),
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || '暂时无法登录，请重试。');
                if (data.authenticated !== true) throw new Error('登录未完成，请重试。');
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
              {busy ? '正在解锁…' : '进入练习室'}
              <ArrowRight size={18} />
            </button>
          </form>
        )}
        {error && (
          <div className="access-error" role="alert">
            {error}
            <button className="text-button" onClick={() => void check()} disabled={busy}>
              重新连接
            </button>
          </div>
        )}
        <p className="access-note">
          无需注册账号 · 学习 10 分钟 + 表达 1 分钟
          <br />
          练习记录仅保存在当前浏览器
        </p>
      </section>
    </main>
  );
}
