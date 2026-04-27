const https = require('https');

function buildTrailerQuery(title, year) {
  return [title, year, 'trailer'].filter(Boolean).join(' ');
}

function fetchRemoteText(url, redirectsLeft = 4) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
        }
      },
      (res) => {
        const location = res.headers.location;
        const code = Number(res.statusCode || 0);
        if (location && code >= 300 && code < 400 && redirectsLeft > 0) {
          const nextUrl = new URL(location, url).toString();
          resolve(fetchRemoteText(nextUrl, redirectsLeft - 1));
          return;
        }

        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: code,
            body
          });
        });
      }
    );

    req.on('error', reject);
  });
}

function extractYoutubeVideoId(searchHtml) {
  const ids = [];
  const matcher = /"videoId":"([a-zA-Z0-9_-]{11})"/g;
  let match = matcher.exec(searchHtml);
  while (match) {
    const candidate = String(match[1] || '').trim();
    if (candidate && !ids.includes(candidate)) {
      ids.push(candidate);
    }
    match = matcher.exec(searchHtml);
  }
  return ids[0] || '';
}

async function resolveYoutubeTrailer({ title, year, query }) {
  const searchQuery = String(query || buildTrailerQuery(title, year) || '').trim();
  const queryValue = searchQuery;
  if (!queryValue) {
    return null;
  }

  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(queryValue)}`;
  const result = await fetchRemoteText(searchUrl);

  if (result.statusCode >= 400 || !result.body) {
    return null;
  }

  const videoId = extractYoutubeVideoId(result.body);
  if (!videoId) {
    return null;
  }

  return {
    query: queryValue,
    videoId,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`
  };
}

module.exports = {
  buildTrailerQuery,
  extractYoutubeVideoId,
  resolveYoutubeTrailer
};
