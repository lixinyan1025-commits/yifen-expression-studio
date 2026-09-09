import { spawn } from 'node:child_process';
import { openSync, closeSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const root = fileURLToPath(new URL('..', import.meta.url));
config({ path: path.join(root, '.env'), quiet: true });
const port = Number(process.env.PORT || 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT 必须是 1–65535 的整数。');
const url = `http://localhost:${port}`;
async function probe() {
  let response;
  try {
    response = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(1500) });
  } catch {
    return false;
  }
  const status = await response.json().catch(() => null);
  if (status?.appId !== 'yifen-expression')
    throw new Error(`端口 ${port} 被其他服务占用，未关闭任何进程。请检查 .env 中的 PORT。`);
  return true;
}
try {
  if (!(await probe())) {
    mkdirSync(path.join(root, '.local'), { recursive: true });
    const out = openSync(path.join(root, '.local/website.log'), 'a');
    const err = openSync(path.join(root, '.local/website-error.log'), 'a');
    const args = ['--import', 'tsx', 'server/index.ts'];
    if (!existsSync(path.join(root, 'dist/index.html'))) args.push('--dev');
    const child = spawn(process.execPath, args, {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', out, err],
    });
    let spawnError;
    child.on('error', (error) => {
      spawnError = error;
    });
    child.unref();
    closeSync(out);
    closeSync(err);
    const deadline = Date.now() + 20000;
    let ready = false;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (await probe()) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!ready)
      throw new Error(
        '网站启动超时。请查看项目 .local/website-error.log，确认已运行 npm install。',
      );
  }
  console.log(`一分 · 已就绪 ${url}`);
  if (!process.argv.includes('--no-open')) {
    if (process.platform !== 'win32') console.log('请在浏览器中打开上面的地址。');
    else {
      const browser = spawn('explorer.exe', [url], {
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
      });
      browser.on('error', () => console.error(`请手动打开 ${url}`));
      browser.unref();
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
