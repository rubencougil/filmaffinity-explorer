const fs = require('fs');
const path = require('path');
const { resolveYoutubeTrailer } = require('../trailer-resolver');

const FILE_PATH = path.join(__dirname, '..', 'public', 'data', 'libraries.json');

function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  }

  return Promise.all(Array.from({ length: Math.max(1, limit) }, () => worker())).then(() => results);
}

async function main() {
  const payload = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
  const libraries = Array.isArray(payload.libraries) ? payload.libraries : [];
  const total = libraries.reduce(
    (sum, library) => sum + (Array.isArray(library.ratings) ? library.ratings.length : 0),
    0
  );

  const cache = new Map();
  let seen = 0;
  let resolved = 0;
  let missing = 0;

  const enrichedLibraries = [];

  for (const library of libraries) {
    const ratings = Array.isArray(library.ratings) ? library.ratings : [];
    const enrichedRatings = await mapWithConcurrency(ratings, 4, async (rating) => {
      seen += 1;
      if (seen % 100 === 0) {
        console.log(`processed ${seen}/${total} | resolved ${resolved} | missing ${missing}`);
      }

      const title = String(rating?.title || '').trim();
      const year = String(rating?.year || '').trim();
      const existingVideoId = String(rating?.trailerVideoId || '').trim();

      if (existingVideoId || !title) {
        if (!existingVideoId) {
          missing += 1;
        }
        return rating;
      }

      const key = `${title}::${year}`;
      if (!cache.has(key)) {
        cache.set(key, await resolveYoutubeTrailer({ title, year }).catch(() => null));
      }

      const trailer = cache.get(key);
      if (!trailer) {
        missing += 1;
        return rating;
      }

      resolved += 1;
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

  payload.libraries = enrichedLibraries;
  fs.writeFileSync(FILE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`done | resolved ${resolved} | missing ${missing}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
