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
    await page.locator('#searchInput').fill('Star Wars');
    const filteredRows = page.locator('#setsTable tbody tr');
    await expect(filteredRows.first()).toBeVisible();

    await page.locator('#refreshBtn').click();
    await expect(page.locator('#refreshBtn')).toHaveText('Refresh valuations');

    expect(errors, `Console/page errors: ${errors.join('\n')}`).toEqual([]);
    await context.close();
  });
}
