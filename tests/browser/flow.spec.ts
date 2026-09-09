import { test, expect, chromium, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fixtureReport, fixtureSegments } from '../fixtures';
import { groundReport } from '../../server/validation';
import { measureAudio } from '../../shared/audio';
import { tone } from '../fixtures';

test.beforeEach(async ({ page }) => {
  // Baseline tests must never use the user's configured real vault.
  await page.route('**/api/vault', (route) =>
    route.fulfill({
      json: {
        configured: false,
        rootPath: '',
        rootId: '',
        notes: [],
        syncedAt: new Date().toISOString(),
      },
    }),
  );
});

async function importNotes(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '我的知识库' }).click();
  await page.getByLabel('导入 Markdown 笔记').setInputFiles([
    {
      name: '长期主义.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(
        '---\ntitle: 长期主义\ntags: [选择, 成长]\n---\n# 长期主义\n这段私人笔记只能在学习时展示。机会成本与自我认知。',
      ),
    },
  ]);
  await expect(page.getByText('已导入 1 篇笔记', { exact: false })).toBeVisible();
}
async function getReady(page: Page) {
  await importNotes(page);
  await page.getByRole('button', { name: '用这些笔记练习' }).click();
  await expect(page.getByRole('timer')).toHaveText('10:00');
  await expect(page.getByText('这段私人笔记只能在学习时展示。机会成本与自我认知。')).toBeVisible();
  await expect(page.getByText(/面对家人的担心/)).toHaveCount(0);
  await page.getByRole('button', { name: '结束学习，进入挑战' }).click();
  await expect(page.getByRole('button', { name: '开始演讲', exact: true })).toBeVisible();
}

test('import, hidden topic, real MediaRecorder, acoustic playback, IndexedDB persistence and deletion', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await getReady(page);
  await expect(page.getByText('这段私人笔记只能在学习时展示。机会成本与自我认知。')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '我的知识库' })).toBeDisabled();
  await page.getByRole('button', { name: '开始演讲', exact: true }).click();
  await expect(page.getByText('麦克风已连接 · 录音中')).toBeVisible();
  await page.waitForTimeout(7200);
  await page.getByRole('button', { name: '结束演讲，查看复盘' }).click();
  await expect(page.locator('audio')).toBeVisible();
  await expect(page.getByText('完整复盘等待分析')).toBeVisible();
  const duration = await page.locator('audio').evaluate((a: HTMLAudioElement) => a.duration);
  expect(duration).toBeGreaterThan(6);
  expect(duration).toBeLessThan(10);
  const pause = page.locator('.pause-list button').first();
  await expect(pause).toBeVisible();
  await pause.click();
  await expect
    .poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThan(0.7);
  await page.reload();
  await page.getByRole('button', { name: '练习记录' }).click();
  await expect(page.locator('.history-row')).toHaveCount(1);
  await page.locator('.history-open').click();
  await expect(page.locator('audio')).toBeVisible();
  await page.getByRole('button', { name: '同题再挑战' }).click();
  await expect(page.getByRole('button', { name: '开始演讲', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '退出本次挑战' }).click();
  await page.getByRole('button', { name: '练习记录' }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /删除 .* 的记录/ }).click();
  await expect(page.locator('.history-row')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('explicit TEST provider responses connect real capture to transcript, issue playback, retry and comparison', async ({
  page,
}) => {
  let audioSent = '',
    analysisAudio = '',
    failAnalysis = true;
  await page.route('**/api/transcribe', async (route) => {
    audioSent = route.request().postDataJSON().audio;
    await route.fulfill({
      json: {
        text: fixtureSegments.map((s) => s.text).join(''),
        segments: fixtureSegments,
        model: 'TEST_FIXTURE',
        audioHash: 'TEST_ONLY_HASH',
      },
    });
  });
  await page.route('**/api/analyze', async (route) => {
    analysisAudio = route.request().postDataJSON().audio;
    if (failAnalysis)
      await route.fulfill({
        status: 503,
        json: { error: '测试：服务暂时不可用，录音与转写已保留。' },
      });
    else
      await route.fulfill({
        json: groundReport(fixtureReport(), fixtureSegments, measureAudio(tone(6), 24000), []),
      });
  });
  await getReady(page);
  await page.getByRole('button', { name: '开始演讲', exact: true }).click();
  await page.waitForTimeout(6800);
  await page.getByRole('button', { name: '结束演讲，查看复盘' }).click();
  await expect(page.locator('audio')).toBeVisible();
  await page.getByRole('checkbox', { name: /允许本次训练上传/ }).check();
  await page.getByRole('button', { name: '转写并分析', exact: true }).click();
  await expect(page.getByText('测试：服务暂时不可用，录音与转写已保留。')).toBeVisible();
  await expect(page.locator('.transcript button')).toHaveCount(2);
  failAnalysis = false;
  await page.getByRole('button', { name: '重试音频分析' }).click();
  await expect(page.getByText('测试夹具：先了解，再行动。')).toBeVisible();
  expect(audioSent.length).toBeGreaterThan(10000);
  expect(analysisAudio).toEqual(audioSent);
  expect(Buffer.from(audioSent, 'base64').subarray(0, 4).toString()).toEqual('RIFF');
  await page.locator('.transcript button').nth(1).click();
  await expect
    .poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThan(3);
  await page.getByRole('button', { name: '确认此问题' }).click();
  await expect(page.locator('.issue .caption')).toHaveText('已确认');
  await page.getByRole('button', { name: '忽略', exact: true }).click();
  await expect(page.locator('.issue .caption')).toHaveText('已忽略');
  await page.getByRole('button', { name: '恢复疑似' }).click();
  await page.locator('.issue .time-button').click();
  await expect
    .poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeLessThan(2);
  await page.screenshot({ path: '.local/report-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '同题再挑战' }).click();
  await page.getByRole('button', { name: '开始演讲', exact: true }).click();
  await page.waitForTimeout(6200);
  await page.getByRole('button', { name: '结束演讲，查看复盘' }).click();
  await expect(page.getByText('和上一次的自己比一比')).toBeVisible();
  await expect(page.locator('.comparison-grid')).toBeVisible();
});
test('prepared mode reveals the question before study; mobile library and training fit the screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await importNotes(page);
  await page.getByRole('button', { name: '今日练习' }).click();
  await page.getByRole('button', { name: /准备模式/ }).click();
  await page.screenshot({ path: '.local/home-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '开始今天的练习' }).click();
  await expect(page.locator('.prepared-topic')).toContainText('面对家人的担心');
  await expect(page.getByRole('timer')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/study-mobile.png', fullPage: true });
});
test('denied microphone exposes a useful retry; no recording or fake result is created', async () => {
  // Fake-UI capture bypasses permissions, so this case uses a separate real permission context.
  const executablePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await chromium.launch({
    executablePath: existsSync(executablePath) ? executablePath : undefined,
    args: ['--use-fake-device-for-media-stream'],
  });
  try {
    const context = await browser.newContext({ baseURL: 'http://localhost:4317' });
    const page = await context.newPage();
    await getReady(page);
    const cdp = await context.newCDPSession(page);
    const { targetInfo } = await cdp.send('Target.getTargetInfo');
    await cdp.send('Browser.setPermission', {
      permission: { name: 'microphone' },
      setting: 'denied',
      origin: 'http://localhost:4317',
      browserContextId: targetInfo.browserContextId,
    });
    await page.getByRole('button', { name: '开始演讲', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('麦克风权限被拒绝');
    await expect(page.locator('audio')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '开始演讲', exact: true })).toBeEnabled();
  } finally {
    await browser.close();
  }
});
test('real sixty-second deadline stops microphone capture automatically', async ({ page }) => {
  await page.addInitScript(() => {
    const observed: MediaStream[] = [];
    (window as any).__observedStreams = observed;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      observed.push(stream);
      return stream;
    };
  });
  await getReady(page);
  await page.getByRole('button', { name: '开始演讲', exact: true }).click();
  await expect(page.getByText('麦克风已连接 · 录音中')).toBeVisible();
  await expect(page.locator('audio')).toBeVisible({ timeout: 70000 });
  const duration = await page.locator('audio').evaluate((a: HTMLAudioElement) => a.duration);
  expect(duration).toBeGreaterThan(59);
  expect(duration).toBeLessThan(62);
  expect(
    await page.evaluate(() =>
      (window as any).__observedStreams.every((s: MediaStream) =>
        s.getTracks().every((t) => t.readyState === 'ended'),
      ),
    ),
  ).toBe(true);
  await expect(page.getByText('完整复盘等待分析')).toBeVisible();
});

test('ten-minute deadline is based on wall clock and reveals the hidden question when time expires', async ({
  page,
}) => {
  await importNotes(page);
  await page.clock.install();
  await page.getByRole('button', { name: '用这些笔记练习' }).click();
  await expect(page.getByText(/面对家人的担心/)).toHaveCount(0);
  await page.clock.fastForward(600001);
  await expect(page.getByRole('button', { name: '开始演讲', exact: true })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText('01:00');
});

test('imported HTML cannot execute and remote Markdown images are not requested', async ({
  page,
}) => {
  const remote: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('note-image.example')) remote.push(r.url());
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');
  await page.getByRole('button', { name: '我的知识库' }).click();
  await page.getByLabel('导入 Markdown 笔记').setInputFiles([
    {
      name: '安全笔记.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(
        '# 安全笔记\n<script>window.noteExecuted=true</script>\n![示意图](https://note-image.example/private.png)\n正常阅读的文字。',
      ),
    },
  ]);
  await expect(page.locator('.markdown').getByText('正常阅读的文字。')).toBeVisible();
  expect(await page.evaluate(() => (window as any).noteExecuted)).toBeUndefined();
  expect(remote).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('desktop empty state and missing service status are honest, responsive and do not upload', async ({
  page,
}) => {
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && !r.url().endsWith('/api/vault')) posts.push(r.url());
  });
  await page.goto('/');
  await expect(page.getByText('让知识，成为你的表达。')).toBeVisible();
  await page.screenshot({ path: '.local/home-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '服务与隐私' }).click();
  await expect(page.getByText('未配置', { exact: true })).toHaveCount(2);
  expect(posts).toEqual([]);
});
