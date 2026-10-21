const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { chromium } = require('playwright');
const { buildLibraryAssets } = require('../scripts/build-data');

const common = Array.from({ length: 80 }, (_, index) => ({
  title: `Common ${index}`,
  url: `https://www.filmaffinity.com/es/film${index}.html`,
  rating: 8,
  ratedAt: '2026-10-07',
  year: '2025'
}));
const suggestion = {
  title: 'Suggested film',
  url: 'https://www.filmaffinity.com/es/film999.html',
  rating: 9,
  year: '2026',
  averageRating: null,
  trailerVideoId: 'abcdefghijk'
};
const payload = {
  libraries: [
    { userName: 'Active', ratings: [...common, { title: 'Unrated film', rating: null }] },
    { userName: 'Peer A', ratings: [...common, suggestion] },
    { userName: 'Peer B', ratings: [...common, { ...suggestion, averageRating: 8 }] }
  ]
};
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

async function openPage(file, {
  data = payload, failed = false, directory = 'public', mobile = false, query = 'userName=Active', init
} = {}) {
  const page = await browser.newPage({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }
  });
  const errors = [];
  const warnings = [];
  const requests = [];
  const assets = directory === 'dist'
    ? buildLibraryAssets(data)
    : new Map([['data/libraries.json', JSON.stringify(data)]]);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://site.test') {
      await route.fulfill({ contentType: 'text/html', body: '' });
      return;
    }
    const pathname = url.pathname.replace(/^\/explorer/, '');
    if (pathname.startsWith('/data/')) {
      requests.push(pathname);
      await route.fulfill(failed ? { status: 503, body: 'Unavailable' }
        : assets.has(pathname.slice(1))
          ? { contentType: 'application/json', body: assets.get(pathname.slice(1)) }
          : { status: 404, body: 'Not found' });
      return;
    }
    const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    await route.fulfill({
      body: await fs.readFile(path.join(__dirname, '..', directory, pathname)),
      contentType: contentTypes[path.extname(pathname)] || 'application/octet-stream'
    });
  });
  if (init) await page.addInitScript(init);
  await page.goto(`http://site.test/explorer/${file}?${query}`);
  return { page, errors, warnings, requests, assets };
}

async function openStaticApi(options = {}) {
  const directory = options.directory || 'dist';
  const result = await openPage('sync.html', { ...options, directory });
  const { page } = result;
  if (directory === 'dist') {
    await page.evaluate(() => {
      const link = document.createElement('link');
      link.setAttribute('data-library-index', '');
      link.setAttribute('href', 'data/catalog.json');
      document.head.appendChild(link);
    });
  }
  for (const file of ['site-utils.js', 'static-data.js']) {
    await page.addScriptTag({ path: path.join(__dirname, '..', directory, file) });
  }
  return result;
}

for (const directory of ['public', 'dist']) {
  for (const file of ['index.html', 'watch-next.html', 'affinity.html', 'stats.html', 'sync.html']) {
    test(`${directory}/${file} loads under a deployment subpath`, async () => {
      const { page, errors } = await openPage(file, { directory, mobile: true });
      try {
        if (file !== 'sync.html') {
          await page.waitForFunction(() => document.querySelector('#global-user-selector')?.options.length === 3);
          await page.waitForFunction(() => document.querySelectorAll('.loading-block').length === 0);
          assert.equal(await page.locator('#global-user-selector').getAttribute('aria-label'), 'Usuario activo');
        }
        assert.equal(await page.locator('h1').count(), 1);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        await page.locator('#nav-menu-toggle').click();
        assert.equal(await page.locator('#nav-menu-toggle').getAttribute('aria-expanded'), 'true');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#nav-menu-toggle').getAttribute('aria-expanded'), 'false');
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });
  }
}

for (const directory of ['public', 'dist']) {
  for (const file of ['index.html', 'watch-next.html', 'affinity.html', 'stats.html', 'sync.html']) {
    for (const mobile of [false, true]) {
      test(`${directory}/${file} supports keyboard skip navigation at ${mobile ? 'mobile' : 'desktop'} width`, async () => {
        const { page, errors } = await openPage(file, { directory, mobile });
        try {
          if (file !== 'sync.html') {
            await page.waitForFunction(() =>
              document.getElementById('global-user-selector').options.length === 3 &&
              !document.querySelector('.loading-block'));
          }
          await page.emulateMedia({ reducedMotion: 'reduce' });
          assert.equal(await page.getByRole('navigation', {
            name: 'Navegación principal', includeHidden: true
          }).count(), 1);
          assert.equal(await page.locator('main h1').count(), 1);
          assert(await page.locator('.skip-link').evaluate((link) => link.getBoundingClientRect().bottom <= 0));
          await page.keyboard.press('Tab');
          assert(await page.locator('.skip-link').evaluate((link) => link === document.activeElement));
          assert(await page.locator('.skip-link').evaluate((link) => link.getBoundingClientRect().top >= 0));
          await page.keyboard.press('Enter');
          assert.equal(await page.evaluate(() => document.activeElement.id), 'main-content');
          assert.equal(new URL(page.url()).hash, '#main-content');
          assert.equal(await page.locator('#main-content').getAttribute('tabindex'), '-1');
          assert(await page.evaluate(() =>
            document.getElementById('main-content').getBoundingClientRect().top >=
            document.querySelector('.topbar').getBoundingClientRect().bottom));
          await page.keyboard.press('Tab');
          assert.equal(await page.locator('.topbar').evaluate((header) => header.contains(document.activeElement)), false);
          const current = page.locator('#top-nav [aria-current="page"]');
          assert.equal(await current.count(), file === 'sync.html' ? 0 : 1);
          if (file !== 'sync.html') {
            assert.equal(new URL(await current.getAttribute('href'), page.url()).pathname, `/explorer/${file}`);
          }
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
          assert.deepEqual(errors, []);
        } finally {
          await page.close();
        }
      });
    }
  }

  test(`${directory} central user selection preserves URL, saved, default and first-user precedence`, async () => {
    const { page, errors } = await openPage('sync.html', { directory });
    try {
      await page.addScriptTag({ path: path.join(__dirname, '..', directory, 'site-utils.js') });
      const cases = [
        { query: 'Peer A', saved: 'Peer B', defaultUser: 'Active', expected: 'Peer A' },
        { query: 'missing', saved: 'Peer B', defaultUser: 'Active', expected: 'Peer B' },
        { query: '', saved: '', defaultUser: 'Peer B', expected: 'Peer B' },
        { query: 'missing', saved: 'missing', defaultUser: 'missing', expected: 'Active' },
        { query: '', saved: 'Peer A', defaultUser: 'Peer B', expected: 'Peer A' },
        { query: 'Peer A', saved: 'Peer B', defaultUser: 'Active', empty: true, expected: '' }
      ];
      for (const entry of cases) {
        const result = await page.evaluate(async ({ query, saved, defaultUser, empty }) => {
          const key = 'filmaffinity-browser-selected-user';
          localStorage.removeItem(key);
          if (saved) localStorage.setItem(key, saved);
          const url = new URL(window.location.href);
          url.search = '?keep=1';
          if (query) url.searchParams.set('userName', query);
          url.hash = 'saved';
          history.replaceState({ marker: 'preserved' }, '', url);
          const users = empty ? [] : ['Active', 'Peer A', 'Peer B'].map((name) => ({ name }));
          window.fetch = async () => new Response(JSON.stringify({ filmaffinity: { users, defaultUser } }));
          const selector = document.createElement('select');
          const config = await window.siteUtils.initializeUserSelector(selector);
          return {
            userName: config.userName,
            selected: selector.value,
            disabled: selector.disabled,
            userParam: new URLSearchParams(location.search).get('userName'),
            persisted: localStorage.getItem(key),
            keep: new URLSearchParams(location.search).get('keep'),
            hash: location.hash,
            state: history.state
          };
        }, entry);
        assert.equal(result.userName, entry.expected);
        assert.equal(result.selected, entry.expected);
        assert.equal(result.disabled, Boolean(entry.empty));
        assert.equal(result.userParam, entry.expected || null);
        assert.equal(result.persisted, entry.expected || entry.saved);
        assert.equal(result.keep, '1');
        assert.equal(result.hash, '#saved');
        assert.deepEqual(result.state, { marker: 'preserved' });
      }
      await page.evaluate(() => {
        window.fetch = async () => new Response(JSON.stringify({ error: 'Config unavailable' }), { status: 503 });
      });
      await assert.rejects(page.evaluate(() =>
        window.siteUtils.initializeUserSelector(document.createElement('select'))), /Config unavailable/);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  test(`${directory} keeps the active user through links and retains affinity comparison state`, async () => {
    const { page, errors } = await openPage('index.html', {
      directory, query: 'userName=Active&q=Common&minRating=8&keep=1#saved'
    });
    try {
      await page.waitForSelector('.result-card');
      await page.locator('#global-user-selector').selectOption('Peer A');
      await page.waitForFunction(() => !document.querySelector('.loading-block'));
      const url = new URL(page.url());
      assert.equal(url.searchParams.get('q'), 'Common');
      assert.equal(url.searchParams.get('minRating'), '8');
      assert.equal(url.searchParams.get('keep'), '1');
      assert.equal(url.hash, '#saved');
      for (const href of await page.locator('[data-nav-target], .brand-mark').evaluateAll((links) => links.map((link) => link.href))) {
        assert.equal(new URL(href).searchParams.get('userName'), 'Peer A');
        assert(new URL(href).pathname.startsWith('/explorer/'));
      }
      await page.locator('[data-nav-target="stats"]').click();
      await page.waitForFunction(() =>
        document.getElementById('global-user-selector').options.length === 3 &&
        !document.querySelector('.loading-block'));
      assert.equal(await page.locator('#global-user-selector').inputValue(), 'Peer A');
      assert.equal(await page.locator('[aria-current="page"]').getAttribute('data-nav-target'), 'stats');
      await page.locator('[data-nav-target="affinity"]').click();
      await page.waitForFunction(() =>
        document.getElementById('affinity-peer-selector').options.length === 2 &&
        !document.querySelector('.loading-block'));
      await page.locator('#affinity-peer-selector').selectOption('Peer B');
      await page.evaluate(() => {
        const url = new URL(location.href);
        url.searchParams.set('keep', '1');
        url.hash = 'main-content';
        history.replaceState({ marker: 'kept' }, '', url);
      });
      await page.locator('#global-user-selector').selectOption('Active');
      await page.waitForFunction(() => !document.querySelector('.loading-block'));
      assert.equal(await page.locator('#affinity-peer-selector').inputValue(), 'Peer B');
      assert.equal(new URL(page.url()).searchParams.get('compareUser'), 'Peer B');
      assert.equal(new URL(page.url()).searchParams.get('keep'), '1');
      assert.equal(new URL(page.url()).hash, '#main-content');
      assert.deepEqual(await page.evaluate(() => history.state), { marker: 'kept' });
      await page.locator('#global-user-selector').selectOption('Peer B');
      await page.waitForFunction(() => !document.querySelector('.loading-block'));
      assert.equal(await page.locator('#affinity-peer-selector').inputValue(), 'Active');
      assert.equal(new URL(page.url()).searchParams.get('compareUser'), 'Active');
      assert.equal(await page.locator('#affinity-peer-selector option[value="Peer B"]').count(), 0);
      await page.locator('[data-nav-target="watchnext"]').click();
      await page.waitForFunction(() =>
        document.getElementById('global-user-selector').options.length === 3 &&
        !document.querySelector('.loading-block'));
      assert.equal(await page.locator('#global-user-selector').inputValue(), 'Peer B');
      await page.locator('.brand-mark').click();
      await page.waitForSelector('.result-card');
      assert.equal(await page.locator('#global-user-selector').inputValue(), 'Peer B');
      assert.equal(await page.evaluate(() => localStorage.getItem('filmaffinity-browser-selected-user')), 'Peer B');
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  for (const file of ['index.html', 'watch-next.html', 'stats.html', 'affinity.html']) {
    test(`${directory}/${file} remains usable when local preferences are blocked`, async () => {
      const { page, errors, warnings } = await openPage(file, {
        directory, query: 'userName=Peer B',
        init: () => {
          Object.defineProperty(window, 'localStorage', {
            get() { throw new DOMException('Storage blocked', 'SecurityError'); }
          });
        }
      });
      try {
        await page.waitForFunction(() =>
          document.getElementById('global-user-selector').options.length === 3 &&
          !document.querySelector('.loading-block'));
        assert.equal(await page.locator('#global-user-selector').inputValue(), 'Peer B');
        await page.locator('#global-user-selector').selectOption('Peer A');
        await page.waitForFunction(() => !document.querySelector('.loading-block'));
        assert.equal(new URL(page.url()).searchParams.get('userName'), 'Peer A');
        assert.equal(await page.locator('[role="alert"]').count(), 0);
        assert.equal(warnings.filter((message) => message.includes('preferencias locales')).length, 1);
        await page.locator('.brand-mark').click();
        await page.waitForSelector('.result-card');
        assert.equal(await page.locator('#global-user-selector').inputValue(), 'Peer A');
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });
  }

  test(`${directory} user navigation tolerates a full preference store`, async () => {
    const { page, errors, warnings } = await openPage('index.html', {
      directory,
      init: () => {
        Storage.prototype.setItem = () => { throw new DOMException('Storage full', 'QuotaExceededError'); };
      }
    });
    try {
      await page.waitForSelector('.result-card');
      await page.locator('#global-user-selector').selectOption('Peer B');
      await page.waitForFunction(() => !document.querySelector('.loading-block'));
      assert.equal(new URL(page.url()).searchParams.get('userName'), 'Peer B');
      assert.equal(await page.locator('[role="alert"]').count(), 0);
      assert.equal(warnings.filter((message) => message.includes('preferencias locales')).length, 1);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  test(`${directory} active-user links safely retain Unicode and URL punctuation`, async () => {
    const data = structuredClone(payload);
    const userName = 'Ángela & "Niño" /+?';
    data.libraries[0].userName = userName;
    const { page, errors } = await openPage('index.html', {
      directory, data, query: `userName=${encodeURIComponent(userName)}`
    });
    try {
      await page.waitForSelector('.result-card');
      assert.equal(await page.locator('#global-user-selector').inputValue(), userName);
      for (const href of await page.locator('[data-nav-target], .brand-mark').evaluateAll((links) => links.map((link) => link.href))) {
        assert.equal(new URL(href).searchParams.get('userName'), userName);
        assert.equal(new URL(href).hash, '');
      }
      await page.locator('[data-nav-target="stats"]').click();
      await page.waitForFunction(() =>
        document.getElementById('global-user-selector').options.length === 3 &&
        !document.querySelector('.loading-block'));
      assert.equal(await page.locator('#global-user-selector').inputValue(), userName);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
}

test('unexpected preference-store errors are surfaced rather than hidden', async () => {
  const { page, errors, warnings } = await openPage('index.html', {
    init: () => {
      Object.defineProperty(window, 'localStorage', {
        get() { throw new Error('Unexpected storage failure'); }
      });
    }
  });
  try {
    await page.waitForSelector('[role="alert"]');
    assert.match(await page.locator('[role="alert"]').textContent(), /Unexpected storage failure/);
    assert.equal(warnings.filter((message) => message.includes('preferencias locales')).length, 0);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

const recoveryViews = [
  { file: 'index.html', status: '#import-status', content: '#results' },
  { file: 'watch-next.html', status: '#watch-next-status', content: '#watch-next-results' },
  { file: 'stats.html', status: '#stats-subtitle', content: '#stats-total-votes' },
  { file: 'affinity.html', status: '#affinity-status', content: '#affinity-content' }
];

async function waitForRecoveredView(page) {
  await page.waitForFunction(() =>
    document.getElementById('global-user-selector').options.length === 3 &&
    !document.querySelector('.loading-block') && !document.querySelector('[role="alert"]'));
}

for (const directory of ['public', 'dist']) {
  for (const { file, status, content } of recoveryViews) {
    test(`${directory}/${file} retries a failed initial configuration without reloading`, async () => {
      const { page, assets, errors } = await openPage(file, {
        directory, mobile: true, failed: true,
        query: 'userName=Active&keep=1&q=Common&compareUser=Peer%20B#main-content'
      });
      try {
        await page.waitForSelector('[role="alert"]');
        await page.evaluate(() => {
          window.recoveryMarker = 'same document';
          history.replaceState({ marker: 'kept' }, '', location.href);
        });
        await page.route('**/data/**', async (route) => {
          const name = new URL(route.request().url()).pathname.replace('/explorer/', '');
          await route.fulfill({ contentType: 'application/json', body: assets.get(name) });
        });
        await page.getByRole('button', { name: 'Reintentar', exact: true }).focus();
        await page.keyboard.press('Enter');
        await waitForRecoveredView(page);
        assert.equal(await page.locator('#global-user-selector').inputValue(), 'Active');
        assert.equal(await page.evaluate(() => window.recoveryMarker), 'same document');
        assert.deepEqual(await page.evaluate(() => history.state), { marker: 'kept' });
        const url = new URL(page.url());
        assert.equal(url.searchParams.get('q'), 'Common');
        assert.equal(url.searchParams.get('keep'), '1');
        assert.equal(url.searchParams.get('compareUser'), 'Peer B');
        assert.equal(url.hash, '#main-content');
        assert.equal(await page.locator(status).getAttribute('role'), null);
        assert.equal(await page.locator(status).evaluate((node) => node === document.activeElement), true);
        assert.equal(await page.getByRole('button', { name: 'Reintentar' }).count(), 0);
        assert(await page.locator(content).textContent());
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });

    test(`${directory}/${file} retries library failures repeatedly while preserving selection and filters`, async () => {
      const { page, errors } = await openPage(file, {
        directory, query: 'userName=Active&keep=1&q=Common&compareUser=Peer%20B#main-content'
      });
      try {
        await waitForRecoveredView(page);
        await page.evaluate(() => {
          const original = window.fetch;
          window.libraryUnavailable = true;
          window.failedLibraryAttempts = 0;
          window.recoveryMarker = 'same document';
          history.replaceState({ marker: 'kept' }, '', location.href);
          window.fetch = (url, init) => {
            if (new URL(url, location.href).pathname === '/api/library' && window.libraryUnavailable) {
              window.failedLibraryAttempts += 1;
              return Promise.resolve(new Response(JSON.stringify({ error: 'Temporary library failure' }), { status: 503 }));
            }
            return original(url, init);
          };
        });
        await page.locator('#global-user-selector').selectOption('Peer A');
        await page.waitForSelector('[role="alert"]');
        const url = page.url();
        const firstAttempts = await page.evaluate(() => window.failedLibraryAttempts);
        await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
        await page.waitForFunction((previous) => window.failedLibraryAttempts > previous, firstAttempts);
        await page.waitForSelector('[role="alert"]');
        assert.match(await page.locator(status).textContent(), /Temporary library failure/);
        assert.equal(await page.locator('.loading-block').count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Reintentar' }).isEnabled(), true);
        await page.evaluate(() => { window.libraryUnavailable = false; });
        await page.getByRole('button', { name: 'Reintentar', exact: true }).focus();
        await page.keyboard.press('Enter');
        await waitForRecoveredView(page);
        assert.equal(page.url(), url);
        assert.equal(await page.locator('#global-user-selector').inputValue(), 'Peer A');
        if (file === 'affinity.html') {
          assert.equal(await page.locator('#affinity-peer-selector').inputValue(), 'Peer B');
          assert.equal(await page.locator('.affinity-summary-card').count(), 1);
        }
        if (file === 'stats.html') assert.equal(await page.locator(content).textContent(), '81');
        if (file === 'index.html') assert(await page.locator('.result-card').count() > 0);
        assert.equal(await page.locator(status).getAttribute('role'), null);
        assert.equal(await page.locator(status).evaluate((node) => node === document.activeElement), true);
        assert.equal(await page.evaluate(() => window.recoveryMarker), 'same document');
        assert.deepEqual(await page.evaluate(() => history.state), { marker: 'kept' });
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });

    test(`${directory}/${file} ignores obsolete results and failures after switching away and back`, async () => {
      const { page, errors } = await openPage(file, { directory });
      try {
        await waitForRecoveredView(page);
        for (const mode of ['success', 'http', 'network', 'json', 'latest-failure']) {
          await page.evaluate((failureMode) => {
            const original = window.fetch;
            let held = false;
            window.heldResponseReady = false;
            window.obsoleteResponse = new Promise((resolve) => { window.releaseObsoleteResponse = resolve; });
            window.fetch = async (url, init) => {
              const hold = !held && new URL(url, location.href).searchParams.get('userName') === 'Peer A';
              if (hold) held = true;
              const response = await original(url, init);
              if (!hold) {
                if (failureMode === 'latest-failure' &&
                    document.getElementById('global-user-selector').value === 'Peer A') {
                  return new Response(JSON.stringify({ error: 'Current library failure' }), { status: 503 });
                }
                return response;
              }
              window.heldResponseReady = true;
              await window.obsoleteResponse;
              if (failureMode === 'network') throw new TypeError('Obsolete network failure');
              if (failureMode === 'json') return new Response('not JSON');
              if (failureMode === 'http') {
                return new Response(JSON.stringify({ error: 'Obsolete HTTP failure' }), { status: 503 });
              }
              return new Response(JSON.stringify({ ...(await response.json()), ratings: [] }));
            };
            window.restoreFetch = () => { window.fetch = original; };
          }, mode);
          await page.locator('#global-user-selector').selectOption('Peer A');
          await page.waitForFunction(() => window.heldResponseReady);
          await page.locator('#global-user-selector').selectOption('Active');
          await waitForRecoveredView(page);
          await page.locator('#global-user-selector').selectOption('Peer A');
          if (mode === 'latest-failure') {
            await page.waitForSelector('[role="alert"]');
            assert.match(await page.locator(status).textContent(), /Current library failure/);
          } else {
            await waitForRecoveredView(page);
          }
          const current = await page.locator('main').innerHTML();
          await page.evaluate(async () => {
            window.releaseObsoleteResponse();
            await window.obsoleteResponse;
            await new Promise(requestAnimationFrame);
            window.restoreFetch();
          });
          assert.equal(await page.locator('main').innerHTML(), current, `${mode} replaced the current view`);
          assert.equal(await page.locator('#global-user-selector').inputValue(), 'Peer A');
          assert.equal(await page.locator('[role="alert"]').count(), mode === 'latest-failure' ? 1 : 0);
        }
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });
  }
}

test('changing the affinity peer while loading or after failure cannot render an old library', async () => {
  const { page, errors } = await openPage('affinity.html');
  try {
    await waitForRecoveredView(page);
    await page.evaluate(() => {
      window.pendingLibrary = new Promise((resolve) => { window.failPendingLibrary = resolve; });
      window.fetch = async () => {
        await window.pendingLibrary;
        return new Response(JSON.stringify({ error: 'Comparison temporarily unavailable' }), { status: 503 });
      };
    });
    await page.locator('#global-user-selector').selectOption('Peer A');
    await page.locator('#affinity-peer-selector').selectOption('Peer B');
    assert.equal(await page.locator('.loading-block').count(), 1);
    assert.equal(await page.locator('.affinity-summary-card').count(), 0);
    await page.evaluate(() => window.failPendingLibrary());
    await page.waitForSelector('[role="alert"]');
    await page.locator('#affinity-peer-selector').selectOption('Active');
    assert.equal(await page.locator('.affinity-summary-card').count(), 0);
    assert.match(await page.locator('[role="alert"]').textContent(), /Comparison temporarily unavailable/);
    assert.equal(await page.getByRole('button', { name: 'Reintentar' }).count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

for (const file of ['index.html', 'stats.html', 'affinity.html', 'watch-next.html']) {
  test(`production ${file} downloads only the data its view needs`, async () => {
    const { page, requests, assets, errors } = await openPage(file, { directory: 'dist' });
    try {
      await page.waitForFunction(() =>
        document.getElementById('global-user-selector').options.length === 3 &&
        !document.querySelector('.loading-block'));
      const index = JSON.parse(assets.get('data/catalog.json'));
      const paths = file === 'watch-next.html'
        ? index.libraries.map((entry) => entry.path)
        : [index.libraries[0].path, index.comparisonsPath];
      assert.deepEqual(new Set(requests), new Set(['/data/catalog.json', ...paths.map((name) => `/${name}`)]));
      const before = requests.length;
      await page.locator('#global-user-selector').selectOption('Peer A');
      await page.waitForFunction(() => !document.querySelector('.loading-block'));
      assert.deepEqual(requests.slice(before), file === 'watch-next.html' ? [] : [`/${index.libraries[1].path}`]);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
}

test('a failed production data file shows a readable mobile error and recovers in place', async () => {
  const { page, assets, errors } = await openPage('index.html', { directory: 'dist', mobile: true });
  try {
    await page.waitForSelector('.result-card');
    const index = JSON.parse(assets.get('data/catalog.json'));
    const pathname = index.libraries[0].path;
    const valid = assets.get(pathname);
    assets.delete(pathname);
    await page.reload();
    await page.waitForSelector('[role="alert"]');
    assert.match(await page.locator('[role="alert"]').textContent(), /No se pudo cargar la biblioteca solicitada \(HTTP 404\)/);
    assert.equal(await page.locator('.loading-block').count(), 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assets.set(pathname, valid);
    await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
    await page.waitForSelector('.result-card');
    assert.equal(await page.locator('[role="alert"]').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('split data preserves the legacy static API including duplicate keys, missing votes and user metadata', async () => {
  const data = {
    generatedAt: '2026-10-21T09:00:00Z',
    libraries: [
      {
        userName: 'Active', status: 'running', lastSyncedAt: '2026-10-20', count: 99,
        ratings: [
          { title: 'Shared', url: ' https://example.test/shared ', rating: 8, averageRating: null },
          { title: 'Title only', rating: null },
          { title: 'Other', url: 'https://example.test/other', rating: 7 }
        ]
      },
      {
        userName: ' Peer A ', status: 'failed', error: 'Sync failed',
        ratings: [
          { title: 'Shared', url: 'https://example.test/shared', rating: 10 },
          { title: 'Duplicate', url: 'https://example.test/shared', rating: null },
          { title: 'Title only', rating: '9', ratedAt: ' 2026-10-19 ' },
          { title: 'Other', url: 'https://example.test/other', rating: '' }
        ]
      },
      {
        userName: 'Peer B', ratings: [
          { title: 'Shared', url: 'https://example.test/shared', rating: '7.5', ratedAt: '2026-10-18' },
          { title: 'Other', url: 'https://example.test/other', rating: 11 }
        ]
      }
    ]
  };
  const snapshots = [];
  for (const directory of ['public', 'dist']) {
    const { page, errors } = await openStaticApi({ directory, data });
    try {
      snapshots.push(await page.evaluate(async () => {
        const urls = ['/api/config', '/api/library', '/api/library?userName=missing'];
        for (const name of ['Active', 'Peer A', 'Peer B']) {
          urls.push(`/api/library?userName=${encodeURIComponent(name)}`);
          urls.push(`/api/library?userName=${encodeURIComponent(name)}&otherVotes=false`);
        }
        return Promise.all(urls.map(async (url) => {
          const response = await fetch(url);
          return { status: response.status, payload: await response.json() };
        }));
      }));
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
  assert.deepEqual(snapshots[1], snapshots[0]);
  assert.deepEqual(snapshots[1][1].payload.ratings[0].otherVotes, [
    { userName: 'Peer B', rating: 7.5, ratedAt: '2026-10-18' }
  ]);
  assert.deepEqual(snapshots[1][1].payload.ratings[1].otherVotes, [
    { userName: 'Peer A', rating: 9, ratedAt: '2026-10-19' }
  ]);
  assert.equal(snapshots[1][1].payload.ratings[2].otherVotes.length, 0);
});

test('catalog-only requests stay small and concurrent library requests share cached downloads', async () => {
  const { page, requests, assets, errors } = await openStaticApi();
  try {
    await page.evaluate(async () => (await fetch('/api/config')).json());
    assert.deepEqual(requests, ['/data/catalog.json']);
    assert.equal(await page.evaluate(async () => (await fetch('/api/library?userName=missing')).status), 404);
    assert.deepEqual(requests, ['/data/catalog.json']);
    const index = JSON.parse(assets.get('data/catalog.json'));
    await page.evaluate(() => Promise.all(Array.from({ length: 8 }, async () =>
      (await fetch('/api/library?userName=Active&otherVotes=false')).json())));
    assert.deepEqual(requests, ['/data/catalog.json', `/${index.libraries[0].path}`]);
    const responses = await page.evaluate(() => Promise.all(Array.from({ length: 8 }, async () =>
      (await fetch('/api/library?userName=Active')).json())));
    assert.deepEqual(requests, ['/data/catalog.json', `/${index.libraries[0].path}`, `/${index.comparisonsPath}`]);
    assert.equal(responses[0].ratings[0].otherVotes.length, 2);
    assert(responses.every((response) => response.count === payload.libraries[0].ratings.length));
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

for (const kind of ['library', 'comparisons']) {
  test(`a malformed ${kind} download reports its error and can be retried`, async () => {
    const { page, requests, assets, errors } = await openStaticApi();
    try {
      const index = JSON.parse(assets.get('data/catalog.json'));
      const pathname = kind === 'library' ? index.libraries[0].path : index.comparisonsPath;
      const valid = assets.get(pathname);
      assets.set(pathname, 'broken JSON');
      await assert.rejects(page.evaluate(async () => (await fetch('/api/library?userName=Active')).json()),
        /JSON|Unexpected token/);
      assets.set(pathname, valid);
      const response = await page.evaluate(async () => (await fetch('/api/library?userName=Active')).json());
      assert.equal(response.count, payload.libraries[0].ratings.length);
      assert.equal(requests.filter((name) => name === `/${pathname}`).length, 2);
      assert.equal(requests.filter((name) => name === '/data/catalog.json').length, 1);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
}

test('HTTP failures are surfaced and do not poison the per-user cache', async () => {
  const { page, assets, errors } = await openStaticApi();
  try {
    const index = JSON.parse(assets.get('data/catalog.json'));
    const route = `**/${index.libraries[0].path}`;
    await page.route(route, (request) => request.fulfill({ status: 503, body: 'Unavailable' }));
    await assert.rejects(page.evaluate(async () =>
      (await fetch('/api/library?userName=Active&otherVotes=false')).json()), /HTTP 503/);
    await page.unroute(route);
    const response = await page.evaluate(async () =>
      (await fetch('/api/library?userName=Active&otherVotes=false')).json());
    assert.equal(response.count, payload.libraries[0].ratings.length);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('wrong-user data and incomplete comparison indexes fail explicitly and can recover', async () => {
  const { page, assets } = await openStaticApi();
  try {
    const index = JSON.parse(assets.get('data/catalog.json'));
    const pathname = index.libraries[0].path;
    const valid = assets.get(pathname);
    assets.set(pathname, JSON.stringify({ userName: 'Wrong user', ratings: [] }));
    await assert.rejects(page.evaluate(async () =>
      (await fetch('/api/library?userName=Active&otherVotes=false')).json()), /no son válidos/);
    assets.set(pathname, valid);
    const comparisons = assets.get(index.comparisonsPath);
    assets.set(index.comparisonsPath, '[]');
    await assert.rejects(page.evaluate(async () =>
      (await fetch('/api/library?userName=Active')).json()), /Faltan usuarios/);
    assets.set(index.comparisonsPath, comparisons);
    const response = await page.evaluate(async () => (await fetch('/api/library?userName=Active')).json());
    assert.equal(response.ratings[0].otherVotes.length, 2);
  } finally {
    await page.close();
  }
});

test('a deployment replacing data files refreshes the catalog once and reuses concurrent downloads', async () => {
  const { page, assets, requests, errors } = await openStaticApi();
  try {
    await page.evaluate(async () => (await fetch('/api/config')).json());
    const previous = JSON.parse(assets.get('data/catalog.json'));
    const next = structuredClone(payload);
    next.libraries[0].ratings[0].title = 'Updated title';
    const nextAssets = buildLibraryAssets(next);
    const nextIndex = JSON.parse(nextAssets.get('data/catalog.json'));
    assets.clear();
    nextAssets.forEach((value, key) => assets.set(key, value));
    const responses = await page.evaluate(() => Promise.all(Array.from({ length: 6 }, async () =>
      (await fetch('/api/library?userName=Active&otherVotes=false')).json())));
    assert(responses.every((response) => response.ratings[0].title === 'Updated title'));
    assert.equal(requests.filter((name) => name === '/data/catalog.json').length, 2);
    assert.equal(requests.filter((name) => name === `/${previous.libraries[0].path}`).length, 1);
    assert.equal(requests.filter((name) => name === `/${nextIndex.libraries[0].path}`).length, 1);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('a missing published file is retried only once, never replaced with an empty library', async () => {
  const { page, assets, requests } = await openStaticApi();
  try {
    const index = JSON.parse(assets.get('data/catalog.json'));
    assets.delete(index.libraries[0].path);
    await assert.rejects(page.evaluate(async () =>
      (await fetch('/api/library?userName=Active&otherVotes=false')).json()), /HTTP 404/);
    assert.equal(requests.filter((name) => name === '/data/catalog.json').length, 2);
    assert.equal(requests.filter((name) => name === `/${index.libraries[0].path}`).length, 2);
  } finally {
    await page.close();
  }
});

test('unsupported catalogs and unsafe asset paths fail before any data file is fetched', async () => {
  const { page, assets, requests, errors } = await openStaticApi();
  try {
    const original = assets.get('data/catalog.json');
    const index = JSON.parse(original);
    const invalid = [
      { ...index, format: 'unknown-version' },
      { ...index, libraries: null },
      ...['https://foreign.test/data.json', '../private.json', 'data/libraries/not-a-hash.json'].map((pathname) => ({
        ...index, libraries: [{ userName: 'Active', path: pathname }]
      }))
    ];
    for (const value of invalid) {
      assets.set('data/catalog.json', JSON.stringify(value));
      await assert.rejects(page.evaluate(async () => (await fetch('/api/config')).json()),
        /no (?:es|son) válid[oa]s?/);
    }
    assert(requests.every((name) => name === '/data/catalog.json'));
    assets.set('data/catalog.json', original);
    const config = await page.evaluate(async () => (await fetch('/api/config')).json());
    assert.equal(config.filmaffinity.users.length, 3);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

for (const file of ['index.html', 'watch-next.html', 'affinity.html', 'stats.html']) {
  for (const failed of [false, true]) {
    test(`${file} handles ${failed ? 'failed data loading' : 'an empty configuration'}`, async () => {
      const { page, errors } = await openPage(file, { failed, data: { libraries: [] } });
      try {
        await page.waitForFunction(() => document.querySelector('[role="alert"]'));
        assert.equal(await page.locator('.loading-block').count(), 0);
        const message = await page.locator('[role="alert"]').textContent();
        assert.match(message, failed ? /No se pudo cargar/ : /configurar usuarios/);
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });
  }
}

test('recommendations retain trailers, ignore missing FA ratings, and use a keyboard-modal dialog', async () => {
  const { page, errors } = await openPage('watch-next.html');
  try {
    await page.waitForSelector('.watch-next-card');
    await page.locator('#watch-next-min-fa-rating').selectOption('7.5');
    assert.equal(await page.locator('.watch-next-card').count(), 1);
    const button = page.locator('.trailer-button').first();
    assert.equal(await button.locator('xpath=ancestor::a').count(), 0);
    await button.click();
    assert.equal(await page.locator('#trailer-frame').getAttribute('src'),
      'https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1&rel=0&playsinline=1');
    assert(await page.locator('#trailer-modal').evaluate((dialog) => dialog.open));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'trailer-close');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#trailer-frame').getAttribute('src'), null);
    assert.equal(await page.locator('#trailer-modal').evaluate((dialog) => dialog.open), false);
    assert(await button.evaluate((element) => element === document.activeElement));
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('missing ratings stay missing in library comparisons and statistics', async () => {
  const data = { libraries: [
    { userName: 'Active', ratings: [{ title: 'Rated', rating: 8 }, { title: 'Unrated', rating: null }] },
    { userName: 'Peer A', ratings: [{ title: 'Rated', rating: null }] }
  ] };
  const { page } = await openPage('index.html', { data });
  try {
    await page.waitForSelector('.result-card');
    assert.deepEqual(await page.locator('.vote-pill').allTextContents(), ['8', '-']);
    assert.equal(await page.locator('.comparison-row').count(), 0);
    const response = await page.evaluate(async () => (await fetch('/api/library?userName=missing')).status);
    assert.equal(response, 404);
  } finally {
    await page.close();
  }
  const stats = await openPage('stats.html', { data });
  try {
    await stats.page.waitForFunction(() => document.querySelector('#stats-average-rating').textContent === '8.0');
    assert.equal(await stats.page.locator('#stats-total-votes').textContent(), '1');
    assert.equal(await stats.page.locator('rect.chart-item:not([role="img"])').count(), 0);
  } finally {
    await stats.page.close();
  }
});

test('date-only values retain their local calendar date and reject invalid days', async () => {
  const { page } = await openPage('sync.html');
  try {
    await page.addScriptTag({ path: path.join(__dirname, '..', 'public', 'site-utils.js') });
    const result = await page.evaluate(() => {
      const { parseFlexibleDate, toRating } = window.siteUtils;
      const iso = parseFlexibleDate('2026-10-07');
      return {
        day: iso.getDate(),
        spanish: parseFlexibleDate('Votada 7 de octubre de 2026').getDate(),
        invalid: parseFlexibleDate('2026-02-30'),
        ratings: [null, '', undefined, 'invalid', 0, 11, '8.5'].map(toRating)
      };
    });
    assert.deepEqual(result, { day: 7, spanish: 7, invalid: null, ratings: [null, null, null, null, null, null, 8.5] });
  } finally {
    await page.close();
  }
});

test('a delayed response cannot overwrite the current user', async () => {
  const { page } = await openPage('index.html');
  try {
    await page.waitForSelector('.result-card');
    await page.evaluate(() => {
      const original = window.fetch;
      window.pendingPeerResponse = new Promise((resolve) => { window.releasePeerResponse = resolve; });
      window.fetch = async (url, init) => {
        const response = await original(url, init);
        if (String(url).includes('userName=Peer%20A')) {
          await window.pendingPeerResponse;
        }
        return response;
      };
      const selector = document.querySelector('#global-user-selector');
      selector.value = 'Peer A';
      selector.dispatchEvent(new Event('change'));
      selector.value = 'Active';
      selector.dispatchEvent(new Event('change'));
    });

    await page.waitForSelector('.result-card');
    await page.evaluate(async () => {
      window.releasePeerResponse();
      await window.pendingPeerResponse;
    });
    assert.match(await page.locator('#results-title').textContent(), /Active/);
    await page.locator('#search-input').fill('Suggested film');
    assert.equal(await page.locator('.result-card').count(), 0);
  } finally {
    await page.close();
  }
});

test('static API loading can recover after a failed data request', async () => {
  const { page, errors } = await openPage('index.html', { failed: true });
  try {
    await page.waitForSelector('[role="alert"]');
    await page.route('**/data/libraries.json', (route) => route.fulfill({ json: payload }));
    const config = await page.evaluate(async () => (await fetch('/api/config')).json());
    assert.equal(config.filmaffinity.users.length, 3);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('posters use responsive WebP requests and preserve the original-image fallback', async () => {
  const { page } = await openPage('sync.html');
  try {
    await page.addScriptTag({ path: path.join(__dirname, '..', 'public', 'site-utils.js') });
    const result = await page.evaluate(() => {
      const image = {
        removeAttribute(name) { delete this[name]; },
        style: {},
        closest() { return null; }
      };
      window.siteUtils.setPosterSource(image, 'https://example.test/poster-msmall.jpg', { priority: true });
      const initial = { loading: image.loading, priority: image.fetchPriority, srcset: image.srcset };
      image.onerror();
      const proxyFallback = image.src;
      image.onerror();
      const directFallback = image.src;
      image.onerror();
      return { initial, proxyFallback, directFallback, hidden: image.style.visibility };
    });
    assert.equal(result.initial.loading, 'eager');
    assert.equal(result.initial.priority, 'high');
    assert.match(result.initial.srcset, /output=webp/);
    assert.match(result.initial.srcset, /600w/);
    assert.match(result.proxyFallback, /poster-msmall/);
    assert.match(result.proxyFallback, /^https:\/\/images\.weserv\.nl/);
    assert.equal(result.directFallback, 'https://example.test/poster-msmall.jpg');
    assert.equal(result.hidden, 'hidden');
  } finally {
    await page.close();
  }
});

test('static API interception leaves foreign origins, POSTs and unrelated paths untouched', async () => {
  const { page } = await openPage('index.html');
  try {
    await page.waitForSelector('.result-card');
    await page.route('**/api/**', (route) => route.fulfill({ json: { network: true } }));
    const responses = await page.evaluate(async () => {
      const requests = [
        fetch('/api/config', { method: 'POST' }),
        fetch('http://foreign.test/api/config'),
        fetch('/api/library-log')
      ];
      return Promise.all(requests.map(async (response) => (await response).json()));
    });
    assert.deepEqual(responses, [{ network: true }, { network: true }, { network: true }]);
  } finally {
    await page.close();
  }
});

test('library layout preserves columns and filter visibility at every breakpoint', async () => {
  const { page } = await openPage('index.html');
  try {
    await page.waitForSelector('.result-card');
    for (const width of [390, 560, 561, 760, 761, 920, 921, 1120, 1121, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const layout = await page.evaluate(() => {
        const style = (selector) => getComputedStyle(document.querySelector(selector));
        return {
          columns: style('#results').gridTemplateColumns.split(' ').length,
          sidebar: style('.sidebar-column').position,
          filters: style('#filter-sidebar').display,
          navigation: style('#top-nav').display
        };
      });
      assert.equal(layout.columns, width <= 760 ? 1 : width <= 920 ? 2 : width <= 1120 ? 3 : 4);
      assert.equal(layout.sidebar, width <= 1120 ? 'static' : 'sticky');
      assert.equal(layout.filters, width <= 760 ? 'none' : 'block');
      assert.equal(layout.navigation, width <= 760 ? 'none' : 'flex');
    }
  } finally {
    await page.close();
  }
});

test('reduced motion disables scrolling, animations and transitions on mobile and desktop', async () => {
  const { page } = await openPage('index.html');
  try {
    await page.waitForSelector('.result-card');
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      for (const reducedMotion of ['reduce', 'no-preference']) {
        await page.emulateMedia({ reducedMotion });
        const styles = await page.evaluate(() => {
          const spinner = document.createElement('div');
          spinner.className = 'loading-spinner';
          document.body.appendChild(spinner);
          const values = {
            scroll: getComputedStyle(document.documentElement).scrollBehavior,
            animation: getComputedStyle(spinner).animationName,
            transition: getComputedStyle(document.querySelector('.result-card')).transitionDuration
          };
          spinner.remove();
          return values;
        });
        if (reducedMotion === 'reduce') {
          assert.deepEqual(styles, { scroll: 'auto', animation: 'none', transition: '0s' });
        } else {
          assert.equal(styles.scroll, 'smooth');
          assert.equal(styles.animation, 'fa-spin');
          assert.notEqual(styles.transition, '0s');
        }
      }
    }
  } finally {
    await page.close();
  }
});

test('stylesheet has no duplicate rule blocks within the same media context', async () => {
  const { page } = await openPage('sync.html');
  try {
    const duplicates = await page.evaluate(() => {
      const seen = new Set();
      const duplicates = [];
      function visit(rules, context = '') {
        for (const rule of rules) {
          if (rule instanceof CSSStyleRule) {
            const key = `${context}:${rule.selectorText}`;
            if (seen.has(key)) duplicates.push(key);
            seen.add(key);
          } else if (rule.cssRules) {
            visit(rule.cssRules, `${context}/${rule.conditionText || rule.name}`);
          }
        }
      }
      visit(document.styleSheets[0].cssRules);
      return duplicates;
    });
    assert.deepEqual(duplicates, []);
  } finally {
    await page.close();
  }
});

const browsePages = [
  { file: 'index.html', prefix: '', card: '.result-card', results: '#results', sort: 'rating-desc' },
  {
    file: 'watch-next.html', prefix: 'watch-next-', card: '.watch-next-card',
    results: '#watch-next-results', sort: 'score-desc'
  }
];

for (const { file, prefix, card, results, sort } of browsePages) {
  test(`${file} round-trips all filters through reload and a shared URL`, async () => {
    const data = structuredClone(payload);
    for (const library of data.libraries) {
      for (const record of library.ratings) {
        record.averageRating = 8;
        record.ratedAt = new Date().toISOString();
      }
    }
    data.libraries[0].ratings.push({
      ...common[0], title: 'Common new', year: '2026', url: 'https://example.test/new'
    });
    const { page, errors } = await openPage(file, {
      data, query: 'userName=Active&keep=1#saved-view'
    });
    try {
      await page.waitForSelector(card);
      const controls = [
        ['min-rating', '8', 'minRating'],
        ['min-fa-rating', '7.5', 'minFaRating'],
        ['rated-window', '365', 'ratedWindow'],
        ['sort-by', sort, 'sort']
      ];
      if (prefix) {
        controls.push(
          ['year-filter', '2026', 'year'],
          ['min-score', '8', 'minScore'],
          ['min-support', '1', 'minSupport'],
          ['min-agreement', '0.8', 'minAgreement']
        );
      } else {
        await page.locator('#year-filter').selectOption('2025');
        await page.locator('#year-filter').selectOption('2026');
      }
      const search = prefix ? 'Suggested' : 'Common';
      await page.locator(`#${prefix}search-input`).fill(search);
      for (const [id, value] of controls) {
        await page.locator(`#${prefix}${id}`).selectOption(value);
      }
      await page.locator(`#${prefix}shared-only`).check();
      const saved = new URL(page.url());
      assert.equal(saved.searchParams.get('q'), search);
      assert.equal(saved.searchParams.get('sharedOnly'), '1');
      assert.equal(saved.searchParams.get('keep'), '1');
      assert.equal(saved.hash, '#saved-view');
      for (const [, value, param] of controls) assert.equal(saved.searchParams.get(param), value);
      if (!prefix) assert.deepEqual(saved.searchParams.getAll('year'), ['2025', '2026']);

      async function assertRestored(current) {
        await current.waitForSelector(card);
        assert.equal(await current.locator(`#${prefix}search-input`).inputValue(), search);
        for (const [id, value] of controls) {
          assert.equal(await current.locator(`#${prefix}${id}`).inputValue(), value);
        }
        assert(await current.locator(`#${prefix}shared-only`).isChecked());
        if (!prefix) {
          assert.deepEqual(await current.locator('.year-filter-chip > span').allTextContents(), ['2026', '2025']);
        }
      }

      await page.reload();
      await assertRestored(page);
      const shared = await openPage(file, { data, query: `${saved.search.slice(1)}${saved.hash}` });
      try {
        await assertRestored(shared.page);
        assert.deepEqual(shared.errors, []);
      } finally {
        await shared.page.close();
      }
      await page.locator('#global-user-selector').selectOption('Peer A');
      await page.waitForFunction(() => !document.querySelector('.loading-block'));
      assert.equal(new URL(page.url()).searchParams.get('userName'), 'Peer A');
      assert.equal(await page.locator(`#${prefix}search-input`).inputValue(), search);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  test(`${file} searches ignore case and composed or decomposed accents`, async () => {
    const data = structuredClone(payload);
    if (prefix) {
      for (const library of data.libraries.slice(1)) {
        library.ratings.at(-1).title = 'Amélie';
      }
    } else {
      data.libraries[0].ratings[0].title = 'Amélie';
    }
    const { page, errors } = await openPage(file, { data });
    try {
      await page.waitForSelector(card);
      for (const query of ['amelie', 'AMÉLIE', 'Ame\u0301lie']) {
        await page.locator(`#${prefix}search-input`).fill(query);
        assert.equal(await page.locator(card).count(), 1);
        assert.match(await page.locator(card).textContent(), /Amélie/);
      }
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  test(`${file} explains filtered-out results and clears every restriction on mobile`, async () => {
    const { page, errors } = await openPage(file, { mobile: true });
    try {
      await page.waitForSelector(card);
      await page.locator('#mobile-filter-toggle').click();
      const controls = [
        ['min-rating', '10', '0'],
        ['min-fa-rating', '8', '0'],
        ['rated-window', '30', 'all'],
        ['sort-by', 'title-asc', prefix ? 'year-desc' : 'recent']
      ];
      if (prefix) {
        controls.push(
          ['year-filter', '2026', 'all'],
          ['min-score', '8', '0'],
          ['min-support', '4', '1'],
          ['min-agreement', '0.9', '0']
        );
      } else {
        await page.locator('#year-filter').selectOption('2025');
      }
      for (const [id, value] of controls) {
        await page.locator(`#${prefix}${id}`).selectOption(value);
      }
      await page.locator(`#${prefix}shared-only`).check();
      await page.locator(`#${prefix}search-input`).fill('Nothing matches this');
      assert.equal(await page.locator(card).count(), 0);
      assert.match(await page.locator(`${results} .empty-state`).textContent(), /filtros actuales/);
      assert.doesNotMatch(await page.locator(`${results} .empty-state`).textContent(), /suficientes datos/);
      await page.locator(`${results} .empty-state button`).click();
      assert(await page.locator(card).count() > 0);
      assert.equal(await page.locator(`#${prefix}search-input`).inputValue(), '');
      assert.equal(await page.evaluate(() => document.activeElement.id), `${prefix}search-input`);
      assert.equal(await page.locator(`#${prefix}shared-only`).isChecked(), false);
      for (const [id, , defaultValue] of controls) {
        assert.equal(await page.locator(`#${prefix}${id}`).inputValue(), defaultValue);
      }
      if (!prefix) assert.equal(await page.locator('.year-filter-chip').count(), 0);
      assert.deepEqual([...new URL(page.url()).searchParams], prefix
        ? [['userName', 'Active'], ['minSupport', '1']] : [['userName', 'Active']]);
      await page.locator(`#${prefix}search-input`).fill('Another empty search');
      await page.locator(`#${prefix}clear-filters`).click();
      assert(await page.locator(card).count() > 0);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  test(`${file} normalizes invalid URL filters without dropping unrelated state`, async () => {
    const { page, errors } = await openPage(file, {
      query: 'userName=Active&minRating=oops&minFaRating=NaN&ratedWindow=-1&sort=bad&year=unknown&sharedOnly=wrong&minSupport=99&minScore=99&minAgreement=99&keep=1#saved'
    });
    try {
      await page.waitForSelector(card);
      const params = new URL(page.url()).searchParams;
      for (const name of ['minRating', 'minFaRating', 'ratedWindow', 'sort', 'year', 'sharedOnly']) {
        assert.equal(params.has(name), false);
      }
      if (prefix) {
        for (const name of ['minSupport', 'minScore', 'minAgreement']) assert.equal(params.has(name), false);
      }
      assert.equal(params.get('userName'), 'Active');
      assert.equal(params.get('keep'), '1');
      assert.equal(new URL(page.url()).hash, '#saved');
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
}

test('an empty library is not presented as a filter problem', async () => {
  const { page } = await openPage('index.html', {
    data: { libraries: [{ userName: 'Active', ratings: [] }] }
  });
  try {
    await page.waitForSelector('.empty-state');
    assert.match(await page.locator('.empty-state').textContent(), /no hay títulos guardados/);
    assert.equal(await page.locator('.empty-state button').count(), 0);
  } finally {
    await page.close();
  }
});

test('lack of recommendation data is distinct from filters hiding available suggestions', async () => {
  const { page } = await openPage('watch-next.html', {
    data: { libraries: [{ userName: 'Active', ratings: common }] }
  });
  try {
    await page.waitForSelector('.empty-state');
    assert.match(await page.locator('.empty-state').textContent(), /suficientes datos de afinidad/);
    assert.equal(await page.locator('.empty-state button').count(), 0);
  } finally {
    await page.close();
  }
});

test('clear recommendation filters reveals candidates below the initial support threshold', async () => {
  const data = { libraries: payload.libraries.slice(0, 2) };
  const { page } = await openPage('watch-next.html', { data });
  try {
    await page.waitForSelector('.empty-state button');
    assert.match(await page.locator('.empty-state').textContent(), /filtros actuales/);
    await page.locator('.empty-state button').click();
    assert.equal(await page.locator('.watch-next-card').count(), 1);
    assert.equal(await page.locator('#watch-next-min-support').inputValue(), '1');
    await page.reload();
    await page.waitForSelector('.watch-next-card');
    assert.equal(await page.locator('#watch-next-min-support').inputValue(), '1');
  } finally {
    await page.close();
  }
});

test('shared rating filters remain explicit when a library only has unrated titles', async () => {
  const { page } = await openPage('index.html', {
    data: { libraries: [{ userName: 'Active', ratings: [{ title: 'Unrated', rating: null }] }] },
    query: 'userName=Active&minRating=8'
  });
  try {
    await page.waitForSelector('.empty-state button');
    assert.equal(await page.locator('#min-rating').inputValue(), '8');
    assert.equal(new URL(page.url()).searchParams.get('minRating'), '8');
    await page.locator('.empty-state button').click();
    assert.equal(await page.locator('.result-card').count(), 1);
    assert.equal(await page.locator('#min-rating').inputValue(), '0');
  } finally {
    await page.close();
  }
});

for (const directory of ['public', 'dist']) {
  test(`${directory} explains estimated and actual recommendation ratings without changing the calculation`, async () => {
    const data = structuredClone(payload);
    data.libraries[2].ratings = [
      ...common.map((record) => ({ ...record, rating: 5 })),
      { ...suggestion, rating: 7, averageRating: 8 }
    ];
    const { page, errors } = await openPage('watch-next.html', { data, directory });
    try {
      await page.waitForSelector('.watch-next-card');
      assert.equal(await page.locator('.watch-next-score').textContent(), 'Estimada 8.20/10');
      assert.deepEqual(await page.locator('.watch-next-chip').allTextContents(), [
        '👥 Recomendada por 2 usuarios',
        '⭐ Su nota media: 8.0/10',
        '🤝 80 títulos en común contigo, de media'
      ]);
      assert.equal(await page.locator('.watch-next-rationale').textContent(),
        'Gustos más parecidos: Peer A (100% de afinidad; le dio 9/10).');
      assert.doesNotMatch(await page.locator('body').textContent(), /\b(?:Score|Soporte|Solidez)\b/);
      assert.equal(await page.getByLabel('Nota estimada mínima', { exact: true }).getAttribute('id'),
        'watch-next-min-score');
      const summary = page.locator('.recommendation-help summary');
      await summary.focus();
      await page.keyboard.press('Enter');
      assert(await page.locator('.recommendation-help').evaluate((details) => details.open));
      assert.match(await page.locator('#recommendation-estimate-help').textContent(), /no un voto tuyo/);
      assert.match(await page.locator('#recommendation-affinity-help').textContent(), /no la probabilidad/);
      for (const width of [390, 560, 561, 760, 761, 920, 921, 1120, 1121, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        if (width <= 760 && await page.locator('#mobile-filter-toggle').getAttribute('aria-expanded') === 'false') {
          await page.locator('#mobile-filter-toggle').click();
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      }
      assert.equal(await page.locator('#watch-next-sort-by').inputValue(), 'year-desc');
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  for (const { file, prefix, card } of browsePages) {
    test(`${directory}/${file} shares trailer playback, unavailable states, dismissal and focus restoration`, async () => {
      const data = structuredClone(payload);
      const unsafeTitle = '<img src=x onerror="window.trailerInjected=true"> & "quoted"';
      const missing = {
        ...suggestion, title: unsafeTitle, ratedAt: new Date().toISOString(), trailerVideoId: ''
      };
      const explicitEmbed = 'https://www.youtube-nocookie.com/embed/zyxwvutsrqp?rel=0';
      const available = {
        ...suggestion, title: 'Explicit trailer', url: 'https://example.test/explicit',
        ratedAt: new Date().toISOString(), trailerEmbedUrl: explicitEmbed
      };
      if (prefix) {
        for (const library of data.libraries.slice(1)) {
          library.ratings[library.ratings.length - 1] = { ...missing };
          library.ratings.push({ ...available });
        }
      } else {
        data.libraries[0].ratings.push(missing, available);
      }
      const { page, errors } = await openPage(file, { data, directory });
      try {
        await page.waitForSelector(card);
        const missingButton = page.locator(card).filter({ hasText: unsafeTitle }).locator('.trailer-button');
        await missingButton.click();
        assert.equal(await page.locator('#trailer-title').textContent(), `${unsafeTitle} (2026)`);
        assert.equal(await page.locator('#trailer-title img').count(), 0);
        assert.equal(await page.evaluate(() => window.trailerInjected), undefined);
        assert(await page.locator('#trailer-unavailable').isVisible());
        assert.equal(await page.locator('#trailer-modal').getAttribute('aria-describedby'), 'trailer-unavailable');
        assert.equal(await page.locator('#trailer-frame').isVisible(), false);
        assert.equal(await page.locator('#trailer-frame').getAttribute('src'), null);
        assert.equal(await page.locator('#trailer-frame').getAttribute('srcdoc'), null);
        await page.keyboard.press('Escape');
        assert(await missingButton.evaluate((button) => button === document.activeElement));

        const availableButton = page.locator(card).filter({ hasText: 'Explicit trailer' }).locator('.trailer-button');
        for (const method of ['button', 'escape', 'backdrop', 'native']) {
          await availableButton.click();
          assert(await page.locator('#trailer-frame').isVisible());
          assert.equal(await page.locator('#trailer-frame').getAttribute('src'), explicitEmbed);
          assert.equal(await page.locator('#trailer-unavailable').isVisible(), false);
          assert.equal(await page.locator('#trailer-modal').getAttribute('aria-describedby'), null);
          assert(await page.locator('body').evaluate((body) => body.classList.contains('modal-open')));
          await page.keyboard.press('Tab');
          assert(await page.locator('#trailer-modal').evaluate((dialog) => dialog.contains(document.activeElement)));
          if (method === 'button') {
            await page.locator('#trailer-close').click();
          } else if (method === 'escape') {
            // Embedded-player key events stay in its document; Escape belongs to the dialog controls.
            await page.locator('#trailer-close').focus();
            await page.keyboard.press('Escape');
          } else if (method === 'backdrop') {
            await page.locator('#trailer-modal').click({ position: { x: 3, y: 3 } });
          } else {
            await page.locator('#trailer-modal').evaluate((dialog) => dialog.close());
          }
          assert.equal(await page.locator('#trailer-modal').evaluate((dialog) => dialog.open), false, method);
          await page.waitForFunction(() => {
            const dialog = document.getElementById('trailer-modal');
            return !dialog.open && dialog.hidden && !document.getElementById('trailer-frame').hasAttribute('src');
          }, null, { timeout: 5000 });
          assert.equal(await page.locator('body').evaluate((body) => body.classList.contains('modal-open')), false);
          assert(await availableButton.evaluate((button) => button === document.activeElement));
        }
        await availableButton.click();
        await page.evaluate(() => {
          document.getElementById('trailer-modal').close();
          document.querySelector('[aria-label="Ver trailer de Explicit trailer"]').click();
        });
        await page.evaluate(() => new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }));
        assert(await page.locator('#trailer-modal').evaluate((dialog) => dialog.open));
        assert.equal(await page.locator('#trailer-frame').getAttribute('src'), explicitEmbed);
        await page.locator('#trailer-close').click();
        await missingButton.click();
        assert(await page.locator('#trailer-unavailable').isVisible());
        assert.equal(await page.locator('#trailer-frame').getAttribute('src'), null);
        await page.keyboard.press('Escape');
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });

    test(`${directory}/${file} shares mobile filters and respects Escape priority`, async () => {
      const { page, errors } = await openPage(file, { directory, mobile: true });
      try {
        await page.waitForSelector(card);
        const toggle = page.locator('#mobile-filter-toggle');
        await toggle.click();
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
        assert.match(await toggle.textContent(), /Ocultar filtros/);
        assert(await page.locator('#filter-sidebar').isVisible());
        await toggle.click();
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        assert.match(await toggle.textContent(), /Mostrar filtros/);
        assert.equal(await page.locator('#filter-sidebar').isVisible(), false);
        await toggle.click();
        await page.locator('#nav-menu-toggle').click();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#nav-menu-toggle').getAttribute('aria-expanded'), 'false');
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'nav-menu-toggle');
        await page.keyboard.press('Escape');
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'mobile-filter-toggle');
        await toggle.click();
        await page.locator('.trailer-button').first().click();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#trailer-modal').evaluate((dialog) => dialog.open), false);
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
        await page.keyboard.press('Escape');
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });
  }
}
