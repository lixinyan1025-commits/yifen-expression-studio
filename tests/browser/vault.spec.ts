import { test, expect } from '@playwright/test';
import { parseNote } from '../../shared/notes';
test('linked notes automatically load, update and disappear in cache without deleting manual imports', async ({
  page,
}) => {
  const note = (id: string, body: string) => ({
    ...parseNote(`# ${id}\n${body}`, `${id}.md`, id),
    source: {
      kind: 'obsidian',
      rootId: 'TEST_ROOT',
      relativePath: `入世/${id}.md`,
      modifiedAt: new Date().toISOString(),
      isIndex: false,
    },
  });
  let linked = [note('直连测试一', '原始正文'), note('直连测试二', '第二篇正文')];
  await page.route('**/api/vault', (route) =>
    route.fulfill({
      json: {
        configured: true,
        rootPath: 'TEST:/智慧',
        rootId: 'TEST_ROOT',
        notes: linked,
        syncedAt: new Date().toISOString(),
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByText('已连接 Obsidian · 智慧')).toBeVisible();
  await page.getByRole('button', { name: '我的知识库' }).click();
  await expect(page.locator('.note-row')).toHaveCount(2);
  await page
    .getByLabel('导入 Markdown 笔记')
    .setInputFiles([
      { name: '手动.md', mimeType: 'text/markdown', buffer: Buffer.from('# 手动笔记\n应当保留。') },
    ]);
  linked = [note('直连测试一', '更新后的正文')];
  await page.getByRole('button', { name: '同步更新' }).click();
  await expect(page.locator('.note-row')).toHaveCount(2);
  await page.locator('.note-open').filter({ hasText: '直连测试一' }).click();
  await expect(page.locator('.markdown')).toContainText('更新后的正文');
  await expect(page.locator('.note-open').filter({ hasText: '直连测试二' })).toHaveCount(0);
  await expect(page.locator('.note-open').filter({ hasText: '手动笔记' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '我的知识库' }).click();
  await expect(page.locator('.note-row')).toHaveCount(2);
});
