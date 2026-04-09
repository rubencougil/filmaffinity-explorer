const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { syncFilmaffinity, checkFilmaffinityAccess } = require('./sync-filmaffinity');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const CONFIG_PATH = path.join(__dirname, 'config.json');
const DATA_DIR = path.join(__dirname, 'data', 'libraries');
const jobs = new Map();
const latestLibraries = new Map();
const activeSyncs = new Map();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function sendFile(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500, {
        'Content-Type': 'text/plain; charset=utf-8'
      });
      res.end(error.code === 'ENOENT' ? 'Not found' : 'Internal server error');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex'
    });
    res.end(data);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex'
  });
  res.end(JSON.stringify(payload));
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

async function handleGetYoutubeTrailer(req, res, reqUrl) {
  const url = new URL(reqUrl, `http://${HOST}:${PORT}`);
  const query = String(url.searchParams.get('q') || '').trim().slice(0, 180);

  if (!query) {
    sendJson(res, 400, { error: 'Missing query' });
    return;
  }

  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const result = await fetchRemoteText(searchUrl);
    if (result.statusCode >= 400 || !result.body) {
      sendJson(res, 502, { error: 'Failed to reach YouTube search' });
      return;
    }

    const videoId = extractYoutubeVideoId(result.body);
    if (!videoId) {
      sendJson(res, 404, { error: 'No trailer found' });
      return;
    }

    sendJson(res, 200, {
      query,
      videoId,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`
    });
  } catch (error) {
    sendJson(res, 500, { error: 'Could not resolve trailer video' });
  }
}

function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function normalizeConfiguredUsers(config) {
  const users = Array.isArray(config?.filmaffinity?.users)
    ? config.filmaffinity.users
    : [];

  const normalized = users
    .map((user) => ({
      name: String(user?.name || '').trim(),
      userId: String(user?.userId || '').trim()
    }))
    .filter((user) => user.name && user.userId);

  if (normalized.length) {
    return normalized;
  }

  const legacyUserId = String(config?.filmaffinity?.userId || '').trim();
  return legacyUserId ? [{ name: 'Cuenta principal', userId: legacyUserId }] : [];
}

function getConfiguredUser(config, requestedName = '', requestedUserId = '') {
  const users = normalizeConfiguredUsers(config);

  if (requestedName) {
    const byName = users.find((user) => user.name === requestedName);
    if (byName) {
      return byName;
    }
  }

  if (requestedUserId) {
    const byId = users.find((user) => user.userId === requestedUserId);
    if (byId) {
      return byId;
    }
  }

  const defaultName = String(config?.filmaffinity?.defaultUser || '').trim();
  return users.find((user) => user.name === defaultName) || users[0] || null;
}

function slugifyUserName(userName) {
  return String(userName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'user';
}

function getLibraryFilePath(userName) {
  return path.join(DATA_DIR, `${slugifyUserName(userName)}.json`);
}

function collectRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function updateJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }

  Object.assign(job, patch);
}

function appendJobLog(jobId, message) {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }

  job.log.push({
    message,
    timestamp: new Date().toISOString()
  });
}

function getLibraryState(userName) {
  return latestLibraries.get(userName) || {
    userName,
    userId: '',
    ratings: [],
    count: 0,
    lastSyncedAt: null,
    status: 'idle',
    lastJobId: null,
    error: null
  };
}

function loadPersistedLibrary(user) {
  const filePath = getLibraryFilePath(user.name);

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      userName: user.name,
      userId: user.userId,
      ratings: Array.isArray(parsed.ratings) ? parsed.ratings : [],
      count: Number(parsed.count) || (Array.isArray(parsed.ratings) ? parsed.ratings.length : 0),
      lastSyncedAt: String(parsed.lastSyncedAt || '').trim() || null,
      status: 'completed',
      lastJobId: null,
      error: null
    };
  } catch (error) {
    return null;
  }
}

function persistLibrary(userName) {
  const state = getLibraryState(userName);
  const payload = {
    userName: state.userName,
    userId: state.userId,
    count: state.count,
    lastSyncedAt: state.lastSyncedAt,
    ratings: state.ratings || []
  };

  ensureDataDir();
  fs.writeFileSync(getLibraryFilePath(userName), JSON.stringify(payload, null, 2));
}

function setLibraryState(userName, patch) {
  const current = getLibraryState(userName);
  latestLibraries.set(userName, {
    ...current,
    ...patch
  });
}

function startSyncForUser(configuredUser) {
  const source = String(configuredUser?.userId || '').trim();
  const userName = String(configuredUser?.name || '').trim();

  if (!source || !userName) {
    return null;
  }

  const existing = activeSyncs.get(userName);
  if (existing && existing.status === 'running') {
    return existing.jobId;
  }

  const jobId = randomUUID();
  jobs.set(jobId, {
    id: jobId,
    status: 'running',
    createdAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: null,
    userName,
    log: []
  });

  activeSyncs.set(userName, {
    jobId,
    source,
    userName,
    status: 'running'
  });

  setLibraryState(userName, {
    userId: source,
    status: 'running',
    lastJobId: jobId,
    error: null
  });

  appendJobLog(jobId, `Starting Filmaffinity sync for ${userName}...`);

  syncFilmaffinity({
    source,
    existingRatings: getLibraryState(userName).ratings || [],
    onProgress(message) {
      appendJobLog(jobId, message);
    }
  })
    .then((result) => {
      updateJob(jobId, {
        status: 'completed',
        finishedAt: new Date().toISOString(),
        result
      });
      activeSyncs.set(userName, {
        jobId,
        source,
        userName,
        status: 'completed'
      });
      setLibraryState(userName, {
        userId: source,
        ratings: result.ratings || [],
        count: result.count || 0,
        lastSyncedAt: new Date().toISOString(),
        status: 'completed',
        lastJobId: jobId,
        error: null
      });
      persistLibrary(userName);
      appendJobLog(jobId, `Sync finished with ${result.count} imported ratings.`);
    })
    .catch((error) => {
      updateJob(jobId, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: error.message || 'Sync failed'
      });
      activeSyncs.set(userName, {
        jobId,
        source,
        userName,
        status: 'failed'
      });
      setLibraryState(userName, {
        userId: source,
        status: 'failed',
        lastJobId: jobId,
        error: error.message || 'Sync failed'
      });
      appendJobLog(jobId, `Sync failed: ${error.message || 'Unknown error'}`);
    });

  return jobId;
}

async function handleStartSync(req, res) {
  try {
    const rawBody = await collectRequestBody(req);
    const body = rawBody ? JSON.parse(rawBody) : {};
    const config = readConfig();
    const configuredUser = getConfiguredUser(
      config,
      String(body.userName || '').trim(),
      String(body.userId || body.source || '').trim()
    );
    const source = String(configuredUser?.userId || '').trim();
    const userName = String(configuredUser?.name || '').trim();

    if (!source) {
      sendJson(res, 400, { error: 'Missing source' });
      return;
    }

    const existing = activeSyncs.get(userName);
    if (existing && existing.status === 'running') {
      sendJson(res, 200, { jobId: existing.jobId, reused: true, userName });
      return;
    }
    const jobId = startSyncForUser({ name: userName, userId: source });
    sendJson(res, 202, { jobId, userName });
  } catch (error) {
    sendJson(res, 400, { error: 'Invalid request body' });
  }
}

function handleGetSyncJob(req, res, pathname) {
  const jobId = pathname.split('/').pop();
  const job = jobs.get(jobId);

  if (!job) {
    sendJson(res, 404, { error: 'Job not found' });
    return;
  }

  sendJson(res, 200, job);
}

function handleGetConfig(req, res) {
  const config = readConfig();
  const users = normalizeConfiguredUsers(config);
  const selected = getConfiguredUser(config);

  sendJson(res, 200, {
    filmaffinity: {
      configured: users.length > 0,
      defaultUser: selected?.name || '',
      users
    }
  });
}

async function handleCheckAccess(req, res, reqUrl) {
  const url = new URL(reqUrl, `http://${HOST}:${PORT}`);
  const config = readConfig();
  const configuredUser = getConfiguredUser(
    config,
    String(url.searchParams.get('userName') || '').trim(),
    String(url.searchParams.get('userId') || '').trim()
  );

  if (!configuredUser) {
    sendJson(res, 404, { error: 'User not found' });
    return;
  }

  try {
    const result = await checkFilmaffinityAccess({ source: configuredUser.userId });
    sendJson(res, 200, {
      userName: configuredUser.name,
      userId: configuredUser.userId,
      ...result
    });
  } catch (error) {
    sendJson(res, 500, {
      userName: configuredUser.name,
      userId: configuredUser.userId,
      ok: false,
      status: 'error',
      message: error.message || 'No se pudo comprobar el acceso a Filmaffinity.'
    });
  }
}

function handleGetLibrary(req, res, reqUrl) {
  const url = new URL(reqUrl, `http://${HOST}:${PORT}`);
  const config = readConfig();
  const users = normalizeConfiguredUsers(config);
  const configuredUser = getConfiguredUser(
    config,
    String(url.searchParams.get('userName') || '').trim(),
    String(url.searchParams.get('userId') || '').trim()
  );

  if (!configuredUser) {
    sendJson(res, 404, { error: 'User not found' });
    return;
  }

  const state = getLibraryState(configuredUser.name);
  const job = state.lastJobId ? jobs.get(state.lastJobId) : null;
  const ratings = (state.ratings || []).map((rating) => {
    const key = String(rating.url || rating.title || '').trim();
    const otherVotes = users
      .filter((user) => user.name !== configuredUser.name)
      .map((user) => {
        const otherState = getLibraryState(user.name);
        const match = (otherState.ratings || []).find(
          (item) => String(item.url || item.title || '').trim() === key
        );

        if (!match || !Number.isFinite(Number(match.rating))) {
          return null;
        }

        return {
          userName: user.name,
          rating: Number(match.rating),
          ratedAt: String(match.ratedAt || '').trim()
        };
      })
      .filter(Boolean);

    return {
      ...rating,
      otherVotes
    };
  });

  sendJson(res, 200, {
    userName: configuredUser.name,
    userId: configuredUser.userId,
    ratings,
    count: ratings.length,
    status: state.status || 'idle',
    error: state.error || null,
    lastSyncedAt: state.lastSyncedAt || null,
    job: job
      ? {
          id: job.id,
          status: job.status,
          log: job.log || []
        }
      : null
  });
}

const server = http.createServer((req, res) => {
  const requestPath = decodeURIComponent((req.url || '/').split('?')[0]);

  if (req.method === 'GET' && requestPath === '/api/config') {
    handleGetConfig(req, res);
    return;
  }

  if (req.method === 'GET' && requestPath === '/api/access-check') {
    handleCheckAccess(req, res, req.url || '/api/access-check');
    return;
  }

  if (req.method === 'POST' && requestPath === '/api/sync') {
    handleStartSync(req, res);
    return;
  }

  if (req.method === 'GET' && requestPath === '/api/library') {
    handleGetLibrary(req, res, req.url || '/api/library');
    return;
  }

  if (req.method === 'GET' && requestPath === '/api/youtube-trailer') {
    handleGetYoutubeTrailer(req, res, req.url || '/api/youtube-trailer');
    return;
  }

  if (req.method === 'GET' && requestPath.startsWith('/api/sync/')) {
    handleGetSyncJob(req, res, requestPath);
    return;
  }

  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safePath === '/' ? 'index.html' : safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (!error && stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    } else if (error) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    sendFile(res, filePath);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Filmaffinity Browser running at http://${HOST}:${PORT}`);

  const config = readConfig();
  ensureDataDir();

  for (const user of normalizeConfiguredUsers(config)) {
    const persisted = loadPersistedLibrary(user);
    if (persisted) {
      latestLibraries.set(user.name, persisted);
    } else {
      latestLibraries.set(user.name, {
        userName: user.name,
        userId: user.userId,
        ratings: [],
        count: 0,
        lastSyncedAt: null,
        status: 'idle',
        lastJobId: null,
        error: null
      });
    }
  }
});
