import { test, expect } from '@playwright/test';
import { commonTopics } from '../../shared/topics';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/vault', (route) =>
    route.fulfill({
      json: {
        configured: false,
        notes: [],
        rootId: '',
        rootPath: '',
        syncedAt: new Date().toISOString(),
      },
    }),
  );
});
test('mobile visitor can learn related brief information before speaking without importing notes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '开始今天的练习' }).click();
  await expect(page.getByRole('timer')).toHaveText('10:00');
  await expect(page.locator('.brief-card')).toHaveCount(3);
  await expect(page.locator('.prepared-topic')).toHaveCount(0);
  await expect(page.locator('.markdown')).toHaveCount(0);
  await page.getByRole('button', { name: '结束学习，进入挑战' }).click();
  await expect(page.getByRole('button', { name: '开始演讲', exact: true })).toBeVisible();
  await expect(page.locator('.brief-card')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('AI topic request uses only a common scenario seed, never selected vault titles, tags or text', async ({
  page,
}) => {
  let sent: any;
  await page.route('**/api/status', (route) =>
    route.fulfill({ json: { ai: true, stt: false, aiHost: 'test', sttHost: 'test' } }),
  );
  await page.route('**/api/topic', (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({
      json: { ...commonTopics[0], id: 'TEST_TOPIC', source: 'ai', noteIds: [] },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '我的知识库', exact: true }).click();
  await page.getByLabel('导入 Markdown 笔记').setInputFiles({
    name: '私人储备.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# 唯一私人标题\n秘密内容 #唯一私密标签'),
  });
  await page.getByRole('button', { name: '今日练习', exact: true }).click();
  await page.locator('.inline-select select').selectOption('ai');
  await page.getByRole('checkbox', { name: /允许本次训练/ }).check();
  await page.getByRole('button', { name: '开始今天的练习' }).click();
  await expect(page.locator('.brief-card')).toHaveCount(3);
  expect(Object.keys(sent).sort()).toEqual(['category', 'seed']);
  expect(commonTopics.some((t) => t.text === sent.seed)).toBe(true);
  expect(JSON.stringify(sent)).not.toMatch(/唯一|秘密|私人/);
  await expect(page.getByText('唯一私人标题', { exact: true })).toHaveCount(0);
});
