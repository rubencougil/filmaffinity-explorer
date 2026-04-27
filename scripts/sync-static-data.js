const fs = require('fs');
const path = require('path');
const { syncFilmaffinity } = require('../sync-filmaffinity');
const { resolveYoutubeTrailer } = require('../trailer-resolver');

const ROOT_DIR = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');
const OUTPUT_DIR = path.join(ROOT_DIR, 'public', 'data');
const OUTPUT_CONFIG_PATH = path.join(OUTPUT_DIR, 'config.json');
const OUTPUT_LIBRARIES_PATH = path.join(OUTPUT_DIR, 'libraries.json');

function readJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.max(1, limit) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function enrichTrailerData(libraries, { concurrency = 4 } = {}) {
  const trailerCache = new Map();
  let resolvedCount = 0;
  let missingCount = 0;
  const enrichedLibraries = [];

  for (const library of libraries) {
    const ratings = Array.isArray(library?.ratings) ? library.ratings : [];
    const enrichedRatings = await mapWithConcurrency(ratings, concurrency, async (rating) => {
      const title = String(rating?.title || '').trim();
      const year = String(rating?.year || '').trim();
      const existingVideoId = String(rating?.trailerVideoId || '').trim();

      if (existingVideoId || !title) {
        if (!existingVideoId) {
          missingCount += 1;
        }
        return rating;
      }

      const cacheKey = `${title}::${year}`;
      if (!trailerCache.has(cacheKey)) {
        const resolved = await resolveYoutubeTrailer({ title, year }).catch(() => null);
        trailerCache.set(cacheKey, resolved || null);
      }

      const trailer = trailerCache.get(cacheKey);
      if (!trailer) {
        missingCount += 1;
        return rating;
      }

      resolvedCount += 1;
      return {
        ...rating,
        trailerVideoId: trailer.videoId,
        trailerEmbedUrl: trailer.embedUrl,
        trailerSource: 'youtube'
      };
    });

    enrichedLibraries.push({
      ...library,
      ratings: enrichedRatings
    });
  }

  return {
    libraries: enrichedLibraries,
    resolvedCount,
    missingCount
  };
}

function normalizeUsers(config) {
  const users = Array.isArray(config?.filmaffinity?.users) ? config.filmaffinity.users : [];
  const unique = new Map();

  users.forEach((user) => {
    const name = String(user?.name || '').trim();
    const userId = String(user?.userId || '').trim();
    if (!name || !userId) {
      return;
    }
    const key = `${name}::${userId}`;
    if (!unique.has(key)) {
      unique.set(key, { name, userId });
    }
  });

  return [...unique.values()];
}

async function main() {
  const config = readJson(CONFIG_PATH, {});
  const users = normalizeUsers(config);

  if (!users.length) {
    throw new Error('No users found in config.json under filmaffinity.users');
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const previousLibrariesPayload = readJson(OUTPUT_LIBRARIES_PATH, { libraries: [] });
  const previousByName = new Map(
    (Array.isArray(previousLibrariesPayload?.libraries) ? previousLibrariesPayload.libraries : []).map((entry) => [
      String(entry?.userName || '').trim(),
      entry
    ])
  );

  const generatedAt = new Date().toISOString();
  const libraries = [];

  for (const user of users) {
    const previous = previousByName.get(user.name);
    const existingRatings = Array.isArray(previous?.ratings) ? previous.ratings : [];

    console.log(`\\n[${user.name}] Starting sync...`);
    const result = await syncFilmaffinity({
      source: user.userId,
      existingRatings,
      onProgress(message) {
        console.log(`[${user.name}] ${message}`);
      }
    });

    libraries.push({
      userName: user.name,
      userId: user.userId,
      ratings: Array.isArray(result?.ratings) ? result.ratings : [],
      count: Number(result?.count) || (Array.isArray(result?.ratings) ? result.ratings.length : 0),
      status: 'completed',
      error: null,
      lastSyncedAt: new Date().toISOString()
    });

    console.log(`[${user.name}] Done: ${libraries.at(-1).count} ratings.`);
  }

  const defaultUser = String(config?.filmaffinity?.defaultUser || '').trim();
  const outputConfig = {
    filmaffinity: {
      configured: true,
      defaultUser: users.some((user) => user.name === defaultUser) ? defaultUser : users[0].name,
      users
    },
    generatedAt
  };

  const outputLibraries = {
    generatedAt,
    libraries
  };

  console.log('\nResolving trailer metadata for static playback...');
  const trailerResult = await enrichTrailerData(libraries, { concurrency: 4 });
  outputLibraries.libraries = trailerResult.libraries;

  writeJson(OUTPUT_CONFIG_PATH, outputConfig);
  writeJson(OUTPUT_LIBRARIES_PATH, outputLibraries);

  console.log('\\nStatic data updated:');
  console.log(`- ${path.relative(ROOT_DIR, OUTPUT_CONFIG_PATH)}`);
  console.log(`- ${path.relative(ROOT_DIR, OUTPUT_LIBRARIES_PATH)}`);
  console.log(
    `- Trailers resolved: ${trailerResult.resolvedCount}, missing or unchanged: ${trailerResult.missingCount}`
  );
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
