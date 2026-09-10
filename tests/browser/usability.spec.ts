import { test, expect, type Page } from '@playwright/test';
import { parseNote } from '../../shared/notes';

const emptyVault = {
  configured: false,
  notes: [],
  rootPath: '',
  rootId: '',
  syncedAt: new Date().toISOString(),
};
async function localNotes(page: Page) {
  await page.route('**/api/vault', (route) => route.fulfill({ json: emptyVault }));
  await page.goto('/');
  await page.getByRole('button', { name: '我的知识库', exact: true }).click();
  await page.getByLabel('导入 Markdown 笔记').setInputFiles([
    {
      name: '学习选择.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# 学习选择\n学习需要了解机会成本。'),
    },
    {
      name: '朋友沟通.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# 朋友沟通\n认真倾听。'),
    },
  ]);
}

test('training preferences and selected notes persist, upload consent does not', async ({
  page,
}) => {
  await localNotes(page);
  await page.getByLabel('选择 朋友沟通', { exact: true }).uncheck();
  await page.getByRole('button', { name: '今日练习', exact: true }).click();
  await page.getByRole('button', { name: /准备模式/ }).click();
  await page.locator('.inline-select select').selectOption('local');
  await page.getByRole('checkbox', { name: /允许本次训练/ }).check();
  await page.getByRole('button', { name: '服务与隐私', exact: true }).click();
  await page.getByLabel('停顿阈值').fill('2.4');
  await page.reload();
  await expect(page.getByRole('button', { name: /准备模式/ })).toHaveClass(/active/);
  await expect(page.locator('.inline-select select')).toHaveValue('local');
  await expect(page.getByRole('checkbox', { name: /允许本次训练/ })).not.toBeChecked();
  await expect(page.locator('.material-row')).toHaveCount(1);
  await page.getByRole('button', { name: '服务与隐私', exact: true }).click();
  await expect(page.getByLabel('停顿阈值')).toHaveValue('2.4');
});

test('study pause freezes time, resumes the same remaining duration, and can exit', async ({
  page,
}) => {
  await localNotes(page);
  await page.clock.install();
  await page.getByRole('button', { name: '先学资料，再演讲' }).click();
  await page.clock.fastForward(5000);
  await expect(page.getByRole('timer')).toHaveText('09:55');
  await page.getByRole('button', { name: '暂停学习' }).click();
  await page.clock.fastForward(600000);
  await expect(page.getByRole('timer')).toHaveText('09:55');
  await expect(page.getByText(/面对家人的担心/)).toHaveCount(0);
  await page.getByRole('button', { name: '继续计时' }).click();
  await page.clock.fastForward(1000);
  await expect(page.getByRole('timer')).toHaveText('09:54');
  await page.getByRole('button', { name: '退出学习' }).click();
  await expect(page.getByRole('button', { name: '开始今天的练习' })).toBeVisible();
  await expect(page.getByRole('button', { name: '我的知识库', exact: true })).toBeEnabled();
});

test('wisdom categories, hidden indexes and selection basket work at mobile width', async ({
  page,
}) => {
  const linked = (title: string, relativePath: string, isIndex = false) => ({
    ...parseNote(`# ${title}\n这是测试笔记。`, `${title}.md`, title),
    source: {
      kind: 'obsidian',
      rootId: 'TEST',
      relativePath,
      isIndex,
      modifiedAt: new Date().toISOString(),
    },
  });
  const notes = [
    linked('智慧入口', '00-智慧入口.md', true),
    linked('实践', '01-入世/实践.md'),
    linked('平静', '02-出世/平静.md'),
  ];
  await page.route('**/api/vault', (route) =>
    route.fulfill({
      json: {
        configured: true,
        notes,
        rootPath: 'TEST:/智慧',
        rootId: 'TEST',
        syncedAt: new Date().toISOString(),
      },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '我的知识库', exact: true }).click();
  await expect(page.locator('.note-row')).toHaveCount(3);
  await page.getByRole('group', { name: '笔记分类' }).getByRole('button', { name: /入世/ }).click();
  await expect(page.locator('.note-row')).toHaveCount(1);
  await expect(page.locator('.note-open')).toContainText('实践');
  await page.getByLabel('选择 实践', { exact: true }).check();
  await expect(page.locator('.selection-basket')).toContainText('实践');
  await page.getByRole('group', { name: '笔记分类' }).getByRole('button', { name: /出世/ }).click();
  await expect(page.locator('.note-open')).toContainText('平静');
  await page.getByRole('group', { name: '笔记分类' }).getByRole('button', { name: /全部/ }).click();
  await page.getByLabel('隐藏入口页').check();
  await expect(page.locator('.note-row')).toHaveCount(2);
  await page.getByRole('button', { name: '清空选择' }).click();
  await expect(page.locator('.selection-basket')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/optimized-library-mobile.png', fullPage: true });
});

test('offline service reports recovery steps while cached notes remain usable', async ({
  page,
}) => {
  let offline = false;
  await page.route('**/api/status', (route) =>
    offline
      ? route.abort()
      : route.fulfill({
          json: {
            ai: false,
            stt: false,
            aiHost: 'test',
            sttHost: 'test',
            topicModel: 'test',
            audioModel: 'test',
            sttModel: 'test',
          },
        }),
  );
  await localNotes(page);
  offline = true;
  await page.reload();
  await expect(page.getByText('本地网站服务未连接', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '我的知识库', exact: true }).click();
  await expect(page.locator('.note-row')).toHaveCount(2);
  offline = false;
  await page.getByRole('button', { name: '重新检测' }).click();
  await expect(page.getByText('本地网站服务未连接', { exact: true })).toHaveCount(0);
});
