const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');
const { chromium } = require('playwright');

function records(prefix, count) {
  return Array.from({ length: count }, (_, index) => ({
    title: `${prefix} ${String(index).padStart(3, '0')}`,
    year: '2025',
    rating: 8,
    averageRating: 7,
    ratedAt: '2026-10-07',
    url: `https://www.filmaffinity.com/es/${prefix}-${index}.html`
  }));
}

const shared = records('Common', 80);
const suggestions = records('Suggestion', 65);
const payload = {
  libraries: [
    { userName: 'Active', ratings: shared },
    { userName: 'Peer A', ratings: [...shared, ...suggestions] },
    { userName: 'Peer B', ratings: [...shared, ...suggestions] }
  ]
};

async function waitForCount(page, selector, count) {
  await page.waitForFunction(
    ({ selector, count }) => document.querySelectorAll(selector).length === count,
    { selector, count }
  );
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  for (const recommendationPage of [false, true]) {
    test(`${recommendationPage ? 'recommendations' : 'library'} scroll pagination at ${viewport.width}px`, async () => {
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('http://pagination.test/**', async (route) => {
          const pathname = new URL(route.request().url()).pathname;
          if (pathname === '/data/libraries.json') {
            await route.fulfill({ json: payload });
            return;
          }
          const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
          await route.fulfill({
            body: await fs.readFile(path.join(__dirname, '..', 'public', pathname)),
            contentType: contentTypes[path.extname(pathname)] || 'application/octet-stream'
          });
        });
        const file = recommendationPage ? 'watch-next.html' : 'index.html';
        const cards = recommendationPage ? '.watch-next-card' : '.result-card';
        const status = recommendationPage ? '#watch-next-scroll-status' : '#scroll-status';
        const search = recommendationPage ? '#watch-next-search-input' : '#search-input';
        const sort = recommendationPage ? '#watch-next-sort-by' : '#sort-by';
        const title = recommendationPage ? '.watch-next-title' : '.result-title';
        const batch = recommendationPage ? 20 : 24;
        const total = recommendationPage ? 65 : 80;
        const prefix = recommendationPage ? 'Suggestion' : 'Common';

        await page.goto(`http://pagination.test/${file}?userName=Active`);
        await waitForCount(page, cards, batch);
        assert.equal(await page.locator('[id$="prev-page"], [id$="next-page"]').count(), 0);
        await page.locator(cards).first().evaluate((node) => { node.dataset.preserved = 'yes'; });

        await page.locator(status).scrollIntoViewIfNeeded();
        await waitForCount(page, cards, batch * 2);
        assert.equal(await page.locator(cards).first().getAttribute('data-preserved'), 'yes');
        assert(await page.evaluate(() => window.scrollY > 0));

        while (await page.locator(cards).count() < total) {
          const before = await page.locator(cards).count();
          await page.locator(status).scrollIntoViewIfNeeded();
          await waitForCount(page, cards, Math.min(before + batch, total));
        }
        assert.equal(new Set(await page.locator(title).allTextContents()).size, total);
        assert.equal(await page.locator(status).textContent(), 'Todos los resultados están cargados.');
        await page.locator(status).scrollIntoViewIfNeeded();
        assert.equal(await page.locator(cards).count(), total);

        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await page.locator(search).fill(`${prefix} 000`);
        await waitForCount(page, cards, 1);
        assert(await page.locator(status).isHidden());
        await page.locator(search).fill('No matching title');
        await waitForCount(page, cards, 0);
        assert(await page.locator(status).isHidden());
        await page.evaluate((selector) => {
          window.scrollTo({ top: 0, behavior: 'instant' });
          const input = document.querySelector(selector);
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, search);
        await waitForCount(page, cards, batch);

        await page.evaluate((selector) => {
          window.scrollTo({ top: 0, behavior: 'instant' });
          const select = document.querySelector(selector);
          select.value = 'title-asc';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }, sort);
        await waitForCount(page, cards, batch);
        assert((await page.locator(title).first().textContent()).endsWith(`${prefix} 000`));
        await page.locator(status).scrollIntoViewIfNeeded();
        await waitForCount(page, cards, batch * 2);
        if (recommendationPage) {
          assert((await page.locator(title).nth(batch).textContent()).startsWith(`${batch + 1}. `));
        }

        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await page.locator('#global-user-selector').selectOption('Peer A');
        await waitForCount(page, cards, recommendationPage ? 0 : batch);
        assert.equal(await page.locator('[data-preserved]').count(), 0);
        await page.locator('#global-user-selector').selectOption('Active');
        await waitForCount(page, cards, batch);

        await page.setViewportSize({ width: 1280, height: 10000 });
        await waitForCount(page, cards, total);
        assert.deepEqual(errors, []);
      } finally {
        await browser.close();
      }
    });
  }
}
