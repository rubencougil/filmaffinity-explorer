const path = require('path');
const https = require('https');
const { chromium } = require('playwright');

const BASE_URL = 'https://www.filmaffinity.com/es/userratings.php';
const MAX_PAGES = 200;
const HEADLESS_WAIT_MS = 3 * 60 * 1000;
const MANUAL_WAIT_MS = 10 * 60 * 1000;
const PAGE_SIZE = 50;
const PAGE_DELAY_MS = 900;
const PAGE_DELAY_JITTER_MS = 500;
const EARLY_STOP_PAGES_WITHOUT_NEW = 2;

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

function getPageDelayMs() {
  return PAGE_DELAY_MS + Math.floor(Math.random() * PAGE_DELAY_JITTER_MS);
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

function normalizeExistingRatingRecord(record) {
  return {
    ...record,
    title: String(record?.title || '').trim(),
    year: String(record?.year || '').trim(),
    rating: Number.isFinite(Number(record?.rating)) ? Number(record.rating) : null,
    averageRating: Number.isFinite(Number(record?.averageRating))
      ? Number(record.averageRating)
      : null,
    ratedAt: String(record?.ratedAt || '').trim(),
    url: String(record?.url || '').trim(),
    posterUrl: String(record?.posterUrl || '').trim(),
    filmId: String(record?.filmId || '').trim()
  };
}

function sortRatingsByRecent(records) {
  return records.sort((a, b) => {
    const aDate = parseSpanishDate(a?.ratedAt);
    const bDate = parseSpanishDate(b?.ratedAt);
    const aTime = aDate ? new Date(aDate).getTime() : 0;
    const bTime = bDate ? new Date(bDate).getTime() : 0;
    if (bTime !== aTime) {
      return bTime - aTime;
    }
    return String(a?.title || '').localeCompare(String(b?.title || ''));
  });
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
  const {
    allowManualChallengeBypass = false,
    existingRatings = []
  } = options;
  const page = context.pages()[0] || (await context.newPage());
  const mergedByKey = new Map();
  const seenKeys = new Set();
  const seenPageSignatures = new Set();
  const newKeysInThisRun = new Set();
  const existingKeys = new Set();
  let pagesWithoutNew = 0;

  for (const existingRecord of existingRatings) {
    const normalized = normalizeExistingRatingRecord(existingRecord);
    const key = getItemKey(normalized);
    if (!key) {
      continue;
    }
    mergedByKey.set(key, normalized);
    existingKeys.add(key);
  }

  if (existingKeys.size) {
    onProgress(`Biblioteca cache detectada: ${existingKeys.size} títulos. Activando sync incremental.`);
  }

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
      await page.waitForTimeout(getPageDelayMs());
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

    let newOnPage = 0;
    for (const item of pageItems) {
      const key = getItemKey(item);
      if (seenKeys.has(key)) {
        continue;
      }

      seenKeys.add(key);
      const previous = mergedByKey.get(key);
      mergedByKey.set(key, {
        ...previous,
        ...item
      });

      if (!existingKeys.has(key)) {
        newOnPage += 1;
        newKeysInThisRun.add(key);
      }
    }

    if (existingKeys.size) {
      if (newOnPage === 0) {
        pagesWithoutNew += 1;
      } else {
        pagesWithoutNew = 0;
      }

      if (pagesWithoutNew >= EARLY_STOP_PAGES_WITHOUT_NEW && pageNumber >= 2) {
        onProgress('No se detectan votos nuevos en páginas recientes. Finalizando sync incremental.');
        break;
      }
    }
  }

  const mergedItems = sortRatingsByRecent([...mergedByKey.values()]);
  if (!newKeysInThisRun.size) {
    onProgress('No hay títulos nuevos. Finalizando sync incremental.');
  }

  onProgress(`Imported ${mergedItems.length} ratings from Filmaffinity.`);

  return {
    userId,
    count: mergedItems.length,
    ratings: mergedItems
  };
}

async function syncFilmaffinity({ source, existingRatings = [], onProgress = () => {} }) {
  const userId = extractUserId(source);
  if (!userId) {
    throw new Error('Enter a valid Filmaffinity user ID or ratings URL.');
  }

  let context = null;

  try {
    onProgress('Opening headless Chrome and connecting to Filmaffinity...');
    context = await launchContext(userId, { headless: true });
    return await collectRatings(context, userId, onProgress, {
      allowManualChallengeBypass: false,
      existingRatings
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
      allowManualChallengeBypass: true,
      existingRatings
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
