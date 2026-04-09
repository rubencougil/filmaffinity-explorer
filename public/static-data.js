(function () {
  const CONFIG_PATH = 'data/config.json';
  const LIBRARIES_PATH = 'data/libraries.json';

  let loaded = null;

  function toUrl(pathname) {
    return new URL(pathname, window.location.href).toString();
  }

  async function loadStaticFiles() {
    if (loaded) {
      return loaded;
    }

    loaded = (async () => {
      const librariesRes = await fetch(toUrl(LIBRARIES_PATH));
      if (!librariesRes.ok) {
        throw new Error('No se pudo cargar data/libraries.json');
      }

      const librariesPayload = await librariesRes.json();
      const libraries = Array.isArray(librariesPayload?.libraries)
        ? librariesPayload.libraries
        : [];
      const usersFromLibraries = libraries
        .map((entry) => ({
          name: String(entry?.userName || '').trim(),
          userId: String(entry?.userId || '').trim()
        }))
        .filter((user) => user.name && user.userId);

      let configPayload = null;
      try {
        const configRes = await fetch(toUrl(CONFIG_PATH));
        if (configRes.ok) {
          configPayload = await configRes.json();
        }
      } catch (error) {
        // Fallback handled below.
      }

      const configUsers = Array.isArray(configPayload?.filmaffinity?.users)
        ? configPayload.filmaffinity.users
        : [];
      const users = configUsers.length ? configUsers : usersFromLibraries;
      if (!configPayload || !configUsers.length) {
        configPayload = {
          filmaffinity: {
            configured: users.length > 0,
            defaultUser: users[0]?.name || '',
            users
          },
          generatedAt: String(librariesPayload?.generatedAt || '')
        };
      }

      return {
        configPayload,
        librariesPayload,
        users,
        libraries,
        byName: new Map(libraries.map((entry) => [String(entry.userName || '').trim(), entry]))
      };
    })();

    return loaded;
  }

  function createJsonResponse(payload, status) {
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        }
      })
    );
  }

  function resolveRequestedUser(searchParams, users) {
    const requestedName = String(searchParams.get('userName') || '').trim();
    const requestedUserId = String(searchParams.get('userId') || '').trim();

    if (requestedName) {
      return users.find((user) => String(user.name || '').trim() === requestedName) || null;
    }

    if (requestedUserId) {
      return users.find((user) => String(user.userId || '').trim() === requestedUserId) || null;
    }

    return users[0] || null;
  }

  function buildLibraryResponse(selectedUser, state, users, byName) {
    const selectedName = String(selectedUser?.name || '').trim();
    const ratings = (state?.ratings || []).map((rating) => {
      const key = String(rating.url || rating.title || '').trim();
      const otherVotes = users
        .filter((user) => String(user.name || '').trim() !== selectedName)
        .map((user) => {
          const otherState = byName.get(String(user.name || '').trim());
          const match = (otherState?.ratings || []).find(
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

    return {
      userName: selectedUser.name,
      userId: selectedUser.userId,
      ratings,
      count: ratings.length,
      status: state?.status || 'completed',
      error: state?.error || null,
      lastSyncedAt: state?.lastSyncedAt || null,
      job: null
    };
  }

  async function searchVideoId(q) {
    const encoded = encodeURIComponent(q);
    const apis = [
      {
        url: `https://pipedapi.kavin.rocks/search?q=${encoded}&filter=videos`,
        extract(data) {
          const item = Array.isArray(data?.items)
            ? data.items.find((i) => typeof i.url === 'string' && i.url.includes('watch?v='))
            : null;
          if (!item) return null;
          const m = item.url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
          return m ? m[1] : null;
        }
      },
      {
        url: `https://iv.datura.network/api/v1/search?q=${encoded}&type=video`,
        extract(data) {
          const item = Array.isArray(data) ? data.find((i) => i.videoId) : null;
          return item ? item.videoId : null;
        }
      },
      {
        url: `https://invidious.nerdvpn.de/api/v1/search?q=${encoded}&type=video`,
        extract(data) {
          const item = Array.isArray(data) ? data.find((i) => i.videoId) : null;
          return item ? item.videoId : null;
        }
      }
    ];

    for (const api of apis) {
      try {
        const res = await originalFetch(api.url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) continue;
        const data = await res.json();
        const videoId = api.extract(data);
        if (videoId) return videoId;
      } catch {
        // try next
      }
    }

    return null;
  }

  async function handleStaticApi(urlObj) {
    const staticData = await loadStaticFiles();

    if (urlObj.pathname.endsWith('/api/config')) {
      return createJsonResponse(staticData.configPayload, 200);
    }

    if (urlObj.pathname.endsWith('/api/library')) {
      const selectedUser = resolveRequestedUser(urlObj.searchParams, staticData.users);
      if (!selectedUser) {
        return createJsonResponse({ error: 'User not found' }, 404);
      }

      const state =
        staticData.byName.get(String(selectedUser.name || '').trim()) ||
        {
          userName: selectedUser.name,
          userId: selectedUser.userId,
          ratings: [],
          count: 0,
          status: 'idle',
          error: null,
          lastSyncedAt: null
        };

      return createJsonResponse(
        buildLibraryResponse(selectedUser, state, staticData.users, staticData.byName),
        200
      );
    }

    if (urlObj.pathname.endsWith('/api/youtube-trailer')) {
      const q = String(urlObj.searchParams.get('q') || '').trim();
      if (!q) {
        return createJsonResponse({ error: 'Missing query' }, 400);
      }

      const videoId = await searchVideoId(q);
      if (!videoId) {
        return createJsonResponse({ error: 'No trailer found' }, 404);
      }

      const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`;
      return createJsonResponse({ query: q, videoId, embedUrl }, 200);
    }

    return null;
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function patchedFetch(input, init) {
    const requestUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : String(input && input.url ? input.url : '');

    if (
      requestUrl.includes('/api/config') ||
      requestUrl.includes('/api/library') ||
      requestUrl.includes('/api/youtube-trailer')
    ) {
      const urlObj = new URL(requestUrl, window.location.href);
      const response = await handleStaticApi(urlObj);
      if (response) {
        return response;
      }
    }

    return originalFetch(input, init);
  };
})();
