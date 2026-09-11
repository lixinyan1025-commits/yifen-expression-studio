import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AccessGate from './AccessGate';
import './styles.css';
class ErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="fatal">
        <h1>页面遇到了一点问题</h1>
        <p>已成功保存到本机的记录不会因此被删除。</p>
        <button onClick={() => location.reload()}>重新打开练习室</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <AccessGate>
      <App />
    </AccessGate>
  </ErrorBoundary>,
);
