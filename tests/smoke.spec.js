const { test, expect } = require('@playwright/test');

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:4173';

for (const viewport of [
  { name: 'desktop', size: { width: 1440, height: 900 } },
  { name: 'mobile', size: { width: 390, height: 844 } }
]) {
  test(`BrickIQ smoke (${viewport.name})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: viewport.size });
    const page = await context.newPage();
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(baseURL, { waitUntil: 'networkidle' });
    await expect(page.locator('h1')).toHaveText('BrickIQ');
    await expect(page.locator('#kpis .kpi')).toHaveCount(5);
    await expect(page.locator('#themeTiles .theme-tile').first()).toBeVisible();

    await page.locator('#searchInput').fill('Star Wars');
    await expect(page.locator('#setsTable tbody tr').first()).toBeVisible();

    await page.locator('#ownershipFilter').selectOption('owned');
    await expect(page.locator('#setsTable tbody tr').first()).toBeVisible();

    await page.locator('#clearFiltersBtn').click();
    await expect(page.locator('#searchInput')).toHaveValue('');

    await page.locator('#refreshBtn').click();
    await expect(page.locator('#refreshBtn')).toHaveText('Refresh valuations');

    expect(errors, `Console/page errors: ${errors.join('\n')}`).toEqual([]);
    await context.close();
  });
}

test('BrickIQ print smoke', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print' });

  await expect(page.locator('.controls')).toBeHidden();
  await expect(page.locator('#setsTable')).toBeVisible();

  await page.screenshot({ path: 'test-results/print-smoke.png', fullPage: true });
  await context.close();
});
