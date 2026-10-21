(function () {
  const LIBRARIES_PATH = document.querySelector('link[data-library-index]')?.getAttribute('href') ||
    'data/libraries.json';
  const DATA_ASSET_PATTERN = /^data\/(?:libraries|comparisons)\/[a-f0-9]{64}\.json$/;

  let loaded = null;
  const assets = new Map();

  function toUrl(pathname) {
    return new URL(pathname, window.location.href).toString();
  }

  async function readJson(pathname, options) {
    const response = await fetch(toUrl(pathname), options);
    if (!response.ok) {
      const label = pathname === LIBRARIES_PATH ? 'el catálogo de bibliotecas'
        : pathname.startsWith('data/comparisons/') ? 'las comparaciones entre usuarios'
          : 'la biblioteca solicitada';
      const error = new Error(`No se pudo cargar ${label} (HTTP ${response.status}).`);
      error.status = response.status;
      error.dataPath = pathname;
      throw error;
    }
    return response.json();
  }

  function cachedAsset(pathname, load) {
    if (!assets.has(pathname)) {
      assets.set(pathname, load().catch((error) => {
        assets.delete(pathname);
        throw error;
      }));
    }
    return assets.get(pathname);
  }

  function loadStaticFiles() {
    if (loaded) {
      return loaded;
    }

    loaded = (async () => {
      const librariesPayload = await readJson(LIBRARIES_PATH, { cache: 'no-cache' });
      const split = librariesPayload?.format === 'filmaffinity-split-v1';
      if (!Array.isArray(librariesPayload?.libraries) ||
          (librariesPayload.format !== undefined && !split)) {
        throw new Error('El formato de los datos de la biblioteca no es válido.');
      }
      const libraries = librariesPayload.libraries;
      if (split && (!DATA_ASSET_PATTERN.test(librariesPayload.comparisonsPath) ||
          libraries.some((entry) => !DATA_ASSET_PATTERN.test(entry?.path)))) {
        throw new Error('Las rutas de los datos de la biblioteca no son válidas.');
      }

      const users = libraries
        .map((entry) => ({
          name: String(entry?.userName || '').trim()
        }))
        .filter((user) => user.name);

      const ratingsByUser = split ? null : new Map(libraries.map((entry) => [
        String(entry.userName || '').trim(),
        new Map((entry.ratings || []).map((rating) => [
          String(rating.url || rating.title || '').trim(),
          rating
        ]))
      ]));
      const configPayload = {
        filmaffinity: {
          configured: users.length > 0,
          defaultUser: users[0]?.name || '',
          users
        },
        generatedAt: String(librariesPayload?.generatedAt || '')
      };

      return {
        configPayload,
        split,
        comparisonsPath: librariesPayload.comparisonsPath,
        users,
        ratingsByUser,
        byName: new Map(libraries.map((entry) => [String(entry.userName || '').trim(), entry]))
      };
    })().catch((error) => {
      loaded = null;
      throw error;
    });
    return loaded;
  }

  function loadLibrary(staticData, selectedUser, cache = 'default') {
    const entry = staticData.byName.get(selectedUser.name);
    if (!staticData.split) return Promise.resolve(entry);
    return cachedAsset(entry.path, async () => {
      const library = await readJson(entry.path, { cache });
      if (String(library?.userName || '').trim() !== selectedUser.name ||
          !Array.isArray(library?.ratings)) {
        throw new Error(`Los datos de la biblioteca de ${selectedUser.name} no son válidos.`);
      }
      return library;
    });
  }

  function loadComparisons(staticData, cache = 'default') {
    if (!staticData.split) return Promise.resolve(staticData.ratingsByUser);
    return cachedAsset(staticData.comparisonsPath, async () => {
      const comparisons = await readJson(staticData.comparisonsPath, { cache });
      if (!Array.isArray(comparisons) || comparisons.some((entry) =>
        !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' ||
        !Array.isArray(entry[1]) || entry[1].some((vote) =>
          !Array.isArray(vote) || vote.length !== 3 || typeof vote[0] !== 'string'))) {
        throw new Error('Los datos de comparación no son válidos.');
      }
      const index = new Map(comparisons.map(([name, votes]) => [
        name,
        new Map(votes.map(([key, rating, ratedAt]) => [key, { rating, ratedAt }]))
      ]));
      if (staticData.users.some((user) => !index.has(user.name))) {
        throw new Error('Faltan usuarios en los datos de comparación.');
      }
      return index;
    });
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

    if (requestedName) {
      return users.find((user) => String(user.name || '').trim() === requestedName) || null;
    }

    return users[0] || null;
  }

  function buildLibraryResponse(selectedUser, state, users, ratingsByUser, includeOtherVotes) {
    const selectedName = String(selectedUser?.name || '').trim();
    const ratings = includeOtherVotes ? (state?.ratings || []).map((rating) => {
      const key = String(rating.url || rating.title || '').trim();
      const otherVotes = users
        .filter((user) => String(user.name || '').trim() !== selectedName)
        .map((user) => {
          const match = ratingsByUser.get(String(user.name || '').trim())?.get(key);

          if (!match || window.siteUtils.toRating(match.rating) === null) {
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
    }) : (state?.ratings || []);

    return {
      userName: selectedUser.name,
      userId: '',
      ratings,
      count: ratings.length,
      status: state?.status || 'completed',
      error: state?.error || null,
      lastSyncedAt: state?.lastSyncedAt || null,
      job: null
    };
  }

  async function handleStaticApi(urlObj, retry = true) {
    const snapshot = loadStaticFiles();
    const staticData = await snapshot;

    if (urlObj.pathname.endsWith('/api/config')) {
      return createJsonResponse(staticData.configPayload, 200);
    }

    if (urlObj.pathname.endsWith('/api/library')) {
      const selectedUser = resolveRequestedUser(urlObj.searchParams, staticData.users);
      if (!selectedUser) {
        return createJsonResponse({ error: 'User not found' }, 404);
      }

      const includeOtherVotes = urlObj.searchParams.get('otherVotes') !== 'false';
      try {
        const cache = retry ? 'default' : 'reload';
        const [state, ratingsByUser] = await Promise.all([
          loadLibrary(staticData, selectedUser, cache),
          includeOtherVotes ? loadComparisons(staticData, cache) : null
        ]);
        return createJsonResponse(
          buildLibraryResponse(selectedUser, state, staticData.users, ratingsByUser, includeOtherVotes),
          200
        );
      } catch (error) {
        if (!retry || !staticData.split || error.status !== 404 ||
            !DATA_ASSET_PATTERN.test(error.dataPath)) throw error;
        if (loaded === snapshot) {
          console.warn('No se encontró un archivo de datos; comprobando el catálogo actualizado.');
          loaded = null;
        }
        return handleStaticApi(urlObj, false);
      }
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

    const urlObj = new URL(requestUrl, window.location.href);
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (urlObj.origin === window.location.origin && method === 'GET' &&
        ['/api/config', '/api/library'].includes(urlObj.pathname)) {
      const response = await handleStaticApi(urlObj);
      if (response) {
        return response;
      }
    }

    return originalFetch(input, init);
  };
})();
