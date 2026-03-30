const path = require('path');
const https = require('https');
const { chromium } = require('playwright');

const BASE_URL = 'https://www.filmaffinity.com/es/userratings.php';
const MAX_PAGES = 200;
const HEADLESS_WAIT_MS = 3 * 60 * 1000;
const MANUAL_WAIT_MS = 10 * 60 * 1000;
const TARGET_GENRE_FILTERS = [
  { code: 'AC', label: 'Acción' },
  { code: 'AN', label: 'Animación' },
  { code: 'AV', label: 'Aventuras' },
  { code: 'BE', label: 'Bélico' },
  { code: 'C-F', label: 'Ciencia ficción' },
  { code: 'F-N', label: 'Cine negro' },
  { code: 'CO', label: 'Comedia' },
  { code: 'DESC', label: 'Desconocido' },
  { code: 'DO', label: 'Documental' },
  { code: 'DR', label: 'Drama' },
  { code: 'FAN', label: 'Fantástico' },
  { code: 'INF', label: 'Infantil' },
  { code: 'INT', label: 'Intriga' },
  { code: 'MU', label: 'Musical' },
  { code: 'RO', label: 'Romance' },
  { code: 'TV_SE', label: 'Serie de TV' },
  { code: 'TE', label: 'Terror' },
  { code: 'TH', label: 'Thriller' },
  { code: 'WE', label: 'Western' }
];

const SPANISH_MONTHS = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  setiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractUserId(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  const fromUrl = text.match(/[?&]user_id=(\d+)/i);
  if (fromUrl) {
    return fromUrl[1];
  }

  const directDigits = text.match(/^\d+$/);
  return directDigits ? directDigits[0] : '';
}

function buildRatingsUrl(userId, pageNumber = 1, options = {}) {
  const {
    orderBy = 'rating-date',
    view = 'list',
    filterBy = ''
  } = options;

  const url = new URL(BASE_URL);
  url.searchParams.set('user_id', String(userId || '').trim());
  url.searchParams.set('orderby', orderBy);
  url.searchParams.set('chv', view);
  url.searchParams.set('p', String(pageNumber));

  if (filterBy) {
    url.searchParams.set('filterby', filterBy);
  }

  return url.toString();
}

function buildRequestHeaders() {
  return {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
  };
}

function buildProfileDir(userId) {
  return path.join(__dirname, '.playwright', `filmaffinity-profile-${userId}`);
}

function buildChallengeMessage(title, bodyText) {
  const text = `${title || ''}\n${bodyText || ''}`.toLowerCase();

  if (/too many request|too many requests/.test(text)) {
    return 'Filmaffinity está devolviendo "Too many requests" y bloquea temporalmente el scraping.';
  }

  if (/security verification|performing security verification|just a moment/.test(text)) {
    return 'Filmaffinity está mostrando una verificación de seguridad y no deja acceder todavía a las votaciones.';
  }

  if (/captcha|turnstile|cloudflare/.test(text)) {
    return 'Filmaffinity está pidiendo un challenge o CAPTCHA y eso impide leer la información.';
  }

  return '';
}

function isChallengeErrorMessage(message) {
  return /too many requests|security verification|just a moment|captcha|turnstile|cloudflare/i.test(
    String(message || '')
  );
}

async function detectChallenge(page) {
  const title = await page.title().catch(() => '');
  const bodyText = await page.textContent('body').catch(() => '');
  const challengeMessage = buildChallengeMessage(title, bodyText);

  if (!challengeMessage) {
    return null;
  }

  return {
    title,
    message: challengeMessage
  };
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: buildRequestHeaders() }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          body
        });
      });
    });

    req.on('error', reject);
  });
}

async function checkFilmaffinityAccess({ source }) {
  const userId = extractUserId(source);
  if (!userId) {
    throw new Error('Enter a valid Filmaffinity user ID or ratings URL.');
  }

  const { statusCode, body } = await fetchText(buildRatingsUrl(userId, 1));
  const challengeMessage = buildChallengeMessage('', body);

  if (challengeMessage || statusCode === 403 || statusCode === 429) {
    return {
      ok: false,
      status: 'blocked',
      message: challengeMessage || 'Filmaffinity está bloqueando temporalmente el acceso.'
    };
  }

  if (/movie-card|fa-avg-rat-box|data-movie-id/i.test(body)) {
    return {
      ok: true,
      status: 'available',
      message: 'La página de votaciones parece accesible en este momento.'
    };
  }

  return {
    ok: false,
    status: 'unknown',
    message: 'No se pudo confirmar el acceso a Filmaffinity con seguridad.'
  };
}

function parseSpanishDate(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/^votada\s+/i, '')
    .trim();

  if (!normalized) {
    return '';
  }

  const explicitYearMatch = normalized.match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i);
  const partialMatch = normalized.match(/(\d{1,2})\s+de\s+([a-záéíóú]+)/i);
  const dateMatch = explicitYearMatch || partialMatch;

  if (!dateMatch) {
    return normalized;
  }

  const day = Number(dateMatch[1]);
  const monthKey = dateMatch[2]
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const month = SPANISH_MONTHS[monthKey];

  if (month === undefined) {
    return normalized;
  }

  const now = new Date();
  let year = explicitYearMatch ? Number(explicitYearMatch[3]) : now.getFullYear();
  const guessedDate = new Date(year, month, day);

  if (!explicitYearMatch && guessedDate.getTime() > now.getTime()) {
    year -= 1;
  }

  const finalDate = new Date(year, month, day);
  const isoMonth = String(finalDate.getMonth() + 1).padStart(2, '0');
  const isoDay = String(finalDate.getDate()).padStart(2, '0');
  return `${finalDate.getFullYear()}-${isoMonth}-${isoDay}`;
}

function getItemKey(item) {
  return String(item?.url || item?.filmId || item?.title || '').trim();
}

async function dismissCookieBanner(page) {
  const acceptButtons = [
    page.getByRole('button', { name: /acepto/i }),
    page.getByRole('button', { name: /agree/i }),
    page.locator('button:has-text("ACEPTO")')
  ];

  for (const button of acceptButtons) {
    try {
      if (await button.first().isVisible({ timeout: 250 })) {
        await button.first().click({ force: true });
        await page.waitForTimeout(500);
        return true;
      }
    } catch (error) {
      // Ignore missing or detached cookie prompts.
    }
  }

  return false;
}

async function waitForRatingsPage(page, userId, onProgress, options = {}) {
  const {
    allowManualChallengeBypass = false,
    timeoutMs = HEADLESS_WAIT_MS
  } = options;
  const deadline = Date.now() + timeoutMs;
  let reportedChallenge = false;
  let manualHintShown = false;

  while (Date.now() < deadline) {
    await dismissCookieBanner(page);

    const cardCount = await page.locator('.movie-card[data-movie-id], .card[data-movie-id]').count();
    if (cardCount > 0) {
      return;
    }

    const challenge = await detectChallenge(page);
    if (challenge && !reportedChallenge) {
      onProgress(`Aviso: ${challenge.message}`);
      reportedChallenge = true;
    }

    if (challenge) {
      if (!allowManualChallengeBypass) {
        throw new Error(challenge.message);
      }

      if (!manualHintShown) {
        onProgress(
          'Filmaffinity ha mostrado un challenge. Completa la verificacion en la ventana de Chrome y espera; la sincronizacion continuara automaticamente.'
        );
        manualHintShown = true;
      }
      await sleep(2000);
      continue;
    }

    if (!page.url().includes('userratings.php')) {
      onProgress('Returning to your Filmaffinity ratings page...');
      await page.goto(buildRatingsUrl(userId, 1), { waitUntil: 'domcontentloaded', timeout: 60000 });
    }

    const bodyText = await page.textContent('body').catch(() => '');
    if (/no se encontraron votaciones|no ratings/i.test(bodyText || '')) {
      return;
    }

    await sleep(2000);
  }

  throw new Error(
    allowManualChallengeBypass
      ? 'Tiempo agotado esperando la verificacion manual de Filmaffinity.'
      : 'Timed out waiting for the Filmaffinity ratings page to become available.'
  );
}

async function scrapeCurrentPage(page) {
  return page.evaluate((todayIso) => {
    function normalizeNumber(text) {
      const normalized = String(text || '')
        .trim()
        .replace(',', '.')
        .replace(/[^\d.]/g, '');
      const value = Number.parseFloat(normalized);
      return Number.isFinite(value) ? value : null;
    }

    function normalizePosterUrl(card) {
      const image = card.querySelector('img');
      const srcset = image?.getAttribute('data-srcset') || image?.getAttribute('srcset') || '';
      if (srcset) {
        const bestEntry = srcset
          .split(',')
          .map((entry) => entry.trim())
          .map((entry) => {
            const [url = '', descriptor = ''] = entry.split(/\s+/, 2);
            const numeric = Number.parseInt(descriptor.replace(/[^\d]/g, ''), 10);
            return {
              url,
              score: Number.isFinite(numeric) ? numeric : 0,
              isWidth: descriptor.endsWith('w'),
              isDensity: descriptor.endsWith('x')
            };
          })
          .filter((entry) => entry.url)
          .sort((a, b) => {
            if (a.score !== b.score) {
              return b.score - a.score;
            }
            if (a.isWidth !== b.isWidth) {
              return a.isWidth ? -1 : 1;
            }
            if (a.isDensity !== b.isDensity) {
              return a.isDensity ? -1 : 1;
            }
            return 0;
          })[0];

        if (bestEntry?.url) {
          return bestEntry.url;
        }
      }

      const src = image?.getAttribute('src') || '';
      return src && !src.includes('/images/empty.gif') ? src : '';
    }

    function normalizeTitle(card) {
      const link =
        card.querySelector('.mc-title a[href*="/es/film"]') ||
        card.querySelector('a.card-body[href*="/es/film"]');
      return (
        link?.getAttribute('title')?.trim() ||
        link?.textContent?.trim() ||
        link?.querySelector('img')?.getAttribute('alt')?.trim() ||
        ''
      );
    }

    return [...document.querySelectorAll('.movie-card[data-movie-id], .card[data-movie-id]')].map((card) => {
      const rowBlock =
        card.closest('.row.mb-4') ||
        card.closest('.fa-card')?.parentElement?.closest('.row') ||
        card.closest('.row');
      const link =
        card.querySelector('.mc-title a[href*="/es/film"]') ||
        card.querySelector('a.card-body[href*="/es/film"]');
      const ratingText =
        card.querySelector('.fa-user-rat-box')?.textContent?.trim() ||
        rowBlock?.querySelector('.col-2 .fa-user-rat-box')?.textContent?.trim() ||
        rowBlock?.querySelector('.fa-user-rat-box')?.textContent?.trim() ||
        card.querySelector('.avgrat-box')?.textContent?.trim() ||
        '';
      const avgText = card.querySelector('.fa-avg-rat-box .avg')?.textContent?.trim() || '';
      const yearText = card.querySelector('.mc-year')?.textContent?.trim() || '';
      const ratedText =
        card.closest('.fa-content-card')?.querySelector('.card-header')?.textContent?.trim() ||
        card.querySelector('.header-pg small')?.textContent?.trim() ||
        '';

      return {
        filmId: card.getAttribute('data-movie-id') || '',
        title: normalizeTitle(card),
        year: yearText,
        rating: Number.parseInt(ratingText, 10) || null,
        averageRating: normalizeNumber(avgText),
        ratedAtRaw: ratedText,
        ratedAt: ratedText,
        url: link?.href || '',
        posterUrl: normalizePosterUrl(card),
        scrapedAt: todayIso
      };
    });
  }, new Date().toISOString().slice(0, 10));
}

async function readFilteredCount(page) {
  return page.evaluate(() => {
    const text = document.querySelector('.active-filter .count')?.textContent || '';
    const match = String(text).match(/\d{1,3}(?:[.\s]\d{3})*|\d+/);
    const normalized = String(match?.[0] || '').replace(/[.\s]/g, '');
    const value = Number.parseInt(normalized, 10);
    return Number.isFinite(value) ? value : 0;
  });
}

async function ensureRatingsPageIsReady(page, userId, onProgress, allowManualChallengeBypass) {
  await dismissCookieBanner(page);
  const challenge = await detectChallenge(page);
  if (!challenge) {
    return;
  }

  onProgress(`Aviso: ${challenge.message}`);
  if (!allowManualChallengeBypass) {
    throw new Error(challenge.message);
  }

  await waitForRatingsPage(page, userId, onProgress, {
    allowManualChallengeBypass: true,
    timeoutMs: MANUAL_WAIT_MS
  });
}

async function enrichGenresFromFilters(page, userId, items, onProgress, options = {}) {
  const { allowManualChallengeBypass = false } = options;

  if (!Array.isArray(items) || !items.length) {
    return;
  }

  const recordsByKey = new Map();
  for (const item of items) {
    const key = getItemKey(item);
    if (!key) {
      continue;
    }
    recordsByKey.set(key, item);
  }

  const targetFilters = TARGET_GENRE_FILTERS;

  if (!targetFilters.length) {
    onProgress('No se han detectado filtros de género compatibles en FilmAffinity.');
    return;
  }

  onProgress(
    `Enriqueciendo géneros (${targetFilters.map((item) => item.label).join(', ')})...`
  );

  for (const filter of targetFilters) {
    const seenSignatures = new Set();
    const filterBy = `genre:${filter.code}`;

    await page.goto(buildRatingsUrl(userId, 1, { filterBy }), {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await ensureRatingsPageIsReady(page, userId, onProgress, allowManualChallengeBypass);

    const total = await readFilteredCount(page);
    if (!total) {
      continue;
    }

    onProgress(`Género ${filter.label}: ${total} títulos detectados.`);

    const totalPages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(total / 50)));
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      if (pageNumber > 1) {
        await page.goto(buildRatingsUrl(userId, pageNumber, { filterBy }), {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });
        await ensureRatingsPageIsReady(page, userId, onProgress, allowManualChallengeBypass);
        await page.waitForTimeout(800);
      }

      const pageItems = (await scrapeCurrentPage(page)).filter((item) => item.title && item.url);
      if (!pageItems.length) {
        break;
      }

      const pageSignature = `${pageItems[0]?.filmId || 'none'}:${pageItems.length}:${pageItems.at(-1)?.filmId || 'none'}`;
      if (seenSignatures.has(pageSignature)) {
        break;
      }
      seenSignatures.add(pageSignature);

      for (const filteredItem of pageItems) {
        const key = getItemKey(filteredItem);
        const target = recordsByKey.get(key);
        if (!target) {
          continue;
        }
        if (!Array.isArray(target.genres)) {
          target.genres = [];
        }
        if (!target.genres.includes(filter.label)) {
          target.genres.push(filter.label);
        }
      }
    }
  }

  for (const item of items) {
    if (!Array.isArray(item.genres)) {
      item.genres = [];
      continue;
    }
    item.genres = [...new Set(item.genres)].sort((a, b) => a.localeCompare(b, 'es'));
  }
}

async function launchContext(userId, options = {}) {
  const { headless = true } = options;
  const context = await chromium.launchPersistentContext(buildProfileDir(userId), {
    channel: 'chrome',
    headless,
    viewport: { width: 1440, height: 1600 }
  });

  return context;
}

async function collectRatings(context, userId, onProgress, options = {}) {
  const { allowManualChallengeBypass = false } = options;
  const page = context.pages()[0] || (await context.newPage());
  const items = [];
  const seenKeys = new Set();
  const seenPageSignatures = new Set();

  await page.goto(buildRatingsUrl(userId, 1), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForRatingsPage(page, userId, onProgress, {
    allowManualChallengeBypass,
    timeoutMs: allowManualChallengeBypass ? MANUAL_WAIT_MS : HEADLESS_WAIT_MS
  });

  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
    onProgress(`Reading ratings page ${pageNumber}...`);
    if (pageNumber > 1) {
      await page.goto(buildRatingsUrl(userId, pageNumber), {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      await dismissCookieBanner(page);
      await page.waitForTimeout(1200);
    }

    const challenge = await detectChallenge(page);
    if (challenge) {
      onProgress(`Aviso: ${challenge.message}`);
      if (!allowManualChallengeBypass) {
        throw new Error(challenge.message);
      }

      await waitForRatingsPage(page, userId, onProgress, {
        allowManualChallengeBypass: true,
        timeoutMs: MANUAL_WAIT_MS
      });
    }

    const pageItems = (await scrapeCurrentPage(page))
      .map((item) => ({
        ...item,
        ratedAt: parseSpanishDate(item.ratedAt)
      }))
      .filter((item) => item.title && item.url);

    if (!pageItems.length) {
      break;
    }

    const pageSignature = `${pageItems[0]?.filmId || 'none'}:${pageItems.length}:${pageItems.at(-1)?.filmId || 'none'}`;
    if (seenPageSignatures.has(pageSignature)) {
      break;
    }
    seenPageSignatures.add(pageSignature);

    for (const item of pageItems) {
      const key = item.url || item.filmId || item.title;
      if (seenKeys.has(key)) {
        continue;
      }

      seenKeys.add(key);
      items.push(item);
    }
  }

  await enrichGenresFromFilters(page, userId, items, onProgress, {
    allowManualChallengeBypass
  });

  onProgress(`Imported ${items.length} ratings from Filmaffinity.`);

  return {
    userId,
    count: items.length,
    ratings: items
  };
}

async function syncFilmaffinity({ source, onProgress = () => {} }) {
  const userId = extractUserId(source);
  if (!userId) {
    throw new Error('Enter a valid Filmaffinity user ID or ratings URL.');
  }

  let context = null;

  try {
    onProgress('Opening headless Chrome and connecting to Filmaffinity...');
    context = await launchContext(userId, { headless: true });
    return await collectRatings(context, userId, onProgress, {
      allowManualChallengeBypass: false
    });
  } catch (error) {
    const message = String(error?.message || '');
    if (!isChallengeErrorMessage(message)) {
      throw error;
    }

    onProgress(`Aviso: Filmaffinity está bloqueando el acceso automático. ${message}`);
    onProgress(
      'Reintentando en Chrome visible para verificacion manual (mismo perfil persistente)...'
    );

    if (context) {
      await context.close().catch(() => {});
      context = null;
    }

    context = await launchContext(userId, { headless: false });
    return await collectRatings(context, userId, onProgress, {
      allowManualChallengeBypass: true
    });
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

module.exports = {
  syncFilmaffinity,
  checkFilmaffinityAccess
};
