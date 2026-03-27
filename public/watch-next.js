const PAGE_SIZE = 20;
const SELECTED_USER_KEY = 'filmaffinity-browser-selected-user';
const USER_QUERY_KEY = 'userName';

const elements = {
  userSelector: document.querySelector('#global-user-selector'),
  navLinks: Array.from(document.querySelectorAll('[data-nav-target]')),
  pageTitle: document.querySelector('#watch-next-title'),
  pageSubtitle: document.querySelector('#watch-next-subtitle'),
  yearFilter: document.querySelector('#watch-next-year-filter'),
  status: document.querySelector('#watch-next-status'),
  meta: document.querySelector('#watch-next-meta'),
  results: document.querySelector('#watch-next-results'),
  pagination: document.querySelector('#watch-next-pagination'),
  prevPage: document.querySelector('#watch-next-prev-page'),
  nextPage: document.querySelector('#watch-next-next-page'),
  pageInfo: document.querySelector('#watch-next-page-info'),
  template: document.querySelector('#watch-next-template')
};

let configuredUsers = [];
let selectedUserName = '';
let allRecommendations = [];
let currentPage = 1;

function updateNavLinks() {
  const userParam = selectedUserName ? `?${USER_QUERY_KEY}=${encodeURIComponent(selectedUserName)}` : '';
  const byTarget = {
    home: `/${userParam}`,
    stats: `/stats.html${userParam}`,
    sync: `/sync.html${userParam}`,
    watchnext: `/watch-next.html${userParam}`
  };

  elements.navLinks.forEach((link) => {
    const target = link.dataset.navTarget;
    if (!target || !byTarget[target]) {
      return;
    }
    link.href = byTarget[target];
  });
}

function updateQueryString() {
  const url = new URL(window.location.href);
  if (selectedUserName) {
    url.searchParams.set(USER_QUERY_KEY, selectedUserName);
  } else {
    url.searchParams.delete(USER_QUERY_KEY);
  }
  window.history.replaceState({}, '', url);
  updateNavLinks();
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.style.color = isError ? '#8a1f11' : '';
}

function getYearSortValue(yearText) {
  const match = String(yearText || '').match(/\d{4}/);
  return match ? Number(match[0]) : Number.NEGATIVE_INFINITY;
}

function createLoader(message = 'Cargando recomendaciones...') {
  const wrapper = document.createElement('div');
  wrapper.className = 'loading-block';

  const spinner = document.createElement('div');
  spinner.className = 'loading-spinner';
  spinner.setAttribute('aria-hidden', 'true');

  const text = document.createElement('p');
  text.className = 'loading-text';
  text.textContent = message;

  wrapper.append(spinner, text);
  return wrapper;
}

function normalizeRecord(record) {
  return {
    title: String(record.title || '').trim(),
    year: String(record.year || '').trim(),
    rating: Number.isFinite(Number(record.rating)) ? Number(record.rating) : null,
    url: String(record.url || '').trim(),
    posterUrl: String(record.posterUrl || '').trim()
  };
}

function getPosterCandidates(url) {
  const source = String(url || '').trim();
  if (!source) {
    return [];
  }

  const candidates = [];
  const pushUnique = (value) => {
    if (value && !candidates.includes(value)) {
      candidates.push(value);
    }
  };

  if (source.includes('-msmall.')) {
    pushUnique(source.replace('-msmall.', '-large.'));
    pushUnique(source.replace('-msmall.', '-mmed.'));
    pushUnique(source.replace('-msmall.', '-med.'));
  }

  pushUnique(source);
  return candidates;
}

function setPosterSource(imageNode, posterUrl) {
  const candidates = getPosterCandidates(posterUrl);
  if (!candidates.length) {
    imageNode.removeAttribute('src');
    return;
  }

  let currentIndex = 0;
  const applyNextCandidate = () => {
    if (currentIndex >= candidates.length) {
      imageNode.removeAttribute('src');
      imageNode.onerror = null;
      imageNode.onload = null;
      return;
    }
    imageNode.src = candidates[currentIndex];
  };

  imageNode.onerror = () => {
    currentIndex += 1;
    applyNextCandidate();
  };
  imageNode.onload = () => {
    imageNode.onerror = null;
    imageNode.onload = null;
  };

  applyNextCandidate();
}

function makeKey(record) {
  return String(record.url || record.title || '').trim().toLowerCase();
}

function getAffinityMetrics(activeRecords, peerRecords) {
  const activeByKey = new Map(activeRecords.map((record) => [makeKey(record), record]));
  const sharedPairs = [];

  peerRecords.forEach((record) => {
    const key = makeKey(record);
    const active = activeByKey.get(key);
    if (!active || !Number.isFinite(active.rating) || !Number.isFinite(record.rating)) {
      return;
    }
    sharedPairs.push({
      mine: active.rating,
      theirs: record.rating,
      diff: Math.abs(active.rating - record.rating)
    });
  });

  if (!sharedPairs.length) {
    return {
      overlap: 0,
      agreement: 0,
      confidence: 0,
      weight: 0
    };
  }

  const agreement =
    sharedPairs.reduce((sum, pair) => sum + (1 - pair.diff / 9), 0) / sharedPairs.length;
  const confidence = Math.min(1, sharedPairs.length / 80);
  return {
    overlap: sharedPairs.length,
    agreement,
    confidence,
    weight: agreement * confidence
  };
}

function buildRecommendations(activeUserName, librariesByUser) {
  const activeRecords = librariesByUser.get(activeUserName) || [];
  const activeSeen = new Set(activeRecords.map((record) => makeKey(record)).filter(Boolean));

  const candidates = new Map();

  configuredUsers
    .map((user) => user.name)
    .filter((userName) => userName !== activeUserName)
    .forEach((peerName) => {
      const peerRecords = librariesByUser.get(peerName) || [];
      const affinity = getAffinityMetrics(activeRecords, peerRecords);
      if (affinity.weight < 0.1 || affinity.overlap < 10) {
        return;
      }

      peerRecords.forEach((peerRecord) => {
        if (!Number.isFinite(peerRecord.rating) || peerRecord.rating < 6) {
          return;
        }

        const key = makeKey(peerRecord);
        if (!key || activeSeen.has(key)) {
          return;
        }

        const scoreContribution = affinity.weight * peerRecord.rating;
        const current = candidates.get(key) || {
          key,
          title: peerRecord.title,
          year: peerRecord.year,
          url: peerRecord.url,
          posterUrl: peerRecord.posterUrl,
          weightedScore: 0,
          totalWeight: 0,
          supportUsers: [],
          overlapAvg: 0
        };

        current.weightedScore += scoreContribution;
        current.totalWeight += affinity.weight;
        current.supportUsers.push({
          userName: peerName,
          rating: peerRecord.rating,
          overlap: affinity.overlap,
          agreement: affinity.agreement
        });
        current.overlapAvg += affinity.overlap;

        candidates.set(key, current);
      });
    });

  return [...candidates.values()]
    .map((item) => {
      const predicted = item.totalWeight ? item.weightedScore / item.totalWeight : 0;
      const supportCount = item.supportUsers.length;
      const supportAvgRating = supportCount
        ? item.supportUsers.reduce((sum, support) => sum + support.rating, 0) / supportCount
        : 0;
      const overlapAvg = supportCount ? item.overlapAvg / supportCount : 0;
      const strongestSupport = [...item.supportUsers].sort((a, b) => b.agreement - a.agreement)[0];
      const rankScore = predicted + supportCount * 0.18 + supportAvgRating * 0.02;

      return {
        ...item,
        predicted,
        supportCount,
        supportAvgRating,
        overlapAvg,
        strongestSupport,
        rankScore
      };
    })
    .sort((a, b) => {
      const yearDiff = getYearSortValue(b.year) - getYearSortValue(a.year);
      if (yearDiff !== 0) {
        return yearDiff;
      }
      const scoreDiff = b.rankScore - a.rankScore;
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return a.title.localeCompare(b.title);
    })
    .slice(0, 80);
}

function updateYearFilterOptions(items) {
  const previousValue = elements.yearFilter.value || 'all';
  const years = [...new Set(items.map((item) => String(item.year || '').trim()).filter(Boolean))]
    .sort((a, b) => {
      const diff = getYearSortValue(b) - getYearSortValue(a);
      return diff !== 0 ? diff : b.localeCompare(a);
    });

  elements.yearFilter.innerHTML = '';
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = 'Todos los años';
  elements.yearFilter.appendChild(allOption);

  years.forEach((year) => {
    const option = document.createElement('option');
    option.value = year;
    option.textContent = year;
    elements.yearFilter.appendChild(option);
  });

  const canKeepCurrent = previousValue !== 'all' && years.includes(previousValue);
  elements.yearFilter.value = canKeepCurrent ? previousValue : 'all';
}

function getFilteredRecommendations() {
  const selectedYear = elements.yearFilter.value || 'all';
  return selectedYear === 'all'
    ? allRecommendations
    : allRecommendations.filter((item) => String(item.year || '').trim() === selectedYear);
}

function renderPagination(totalResults) {
  const totalPages = Math.max(1, Math.ceil(totalResults / PAGE_SIZE));

  if (totalResults <= PAGE_SIZE) {
    elements.pagination.hidden = true;
    elements.pageInfo.textContent = '';
    return;
  }

  elements.pagination.hidden = false;
  elements.prevPage.disabled = currentPage <= 1;
  elements.nextPage.disabled = currentPage >= totalPages;
  elements.pageInfo.textContent = `Página ${currentPage} de ${totalPages}`;
}

function applyYearFilterAndRender() {
  const filtered = getFilteredRecommendations();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const startIndex = filtered.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const endIndex = Math.min(currentPage * PAGE_SIZE, filtered.length);
  const visible =
    filtered.length > 0
      ? filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
      : [];

  const availablePeers = configuredUsers.filter((user) => user.name !== selectedUserName).length;
  elements.meta.textContent = allRecommendations.length
    ? `${startIndex}-${endIndex} de ${filtered.length} recomendaciones · ${allRecommendations.length} totales · ${availablePeers} usuarios comparados`
    : `0 recomendaciones · ${availablePeers} usuarios comparados`;

  renderRecommendations(visible, startIndex);
  renderPagination(filtered.length);
}

function renderRecommendations(items, startRank = 1) {
  elements.results.innerHTML = '';

  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'status-text';
    empty.textContent =
      'No hay suficientes datos de afinidad para generar recomendaciones útiles todavía.';
    elements.results.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach((item, index) => {
    const node = elements.template.content.firstElementChild.cloneNode(true);
    const posterLink = node.querySelector('.watch-next-poster-link');
    const poster = node.querySelector('.watch-next-poster');
    const chips = node.querySelector('.watch-next-chips');

    node.querySelector('.watch-next-score').textContent = `Score ${item.predicted.toFixed(2)}`;
    node.querySelector('.watch-next-title').textContent = `${startRank + index}. ${item.title}`;
    node.querySelector('.watch-next-year').textContent = item.year || '';
    node.querySelector('.watch-next-year').hidden = !item.year;
    node.querySelector('.watch-next-rationale').textContent =
      item.strongestSupport
        ? `Mejor señal: ${item.strongestSupport.userName} (${Math.round(item.strongestSupport.agreement * 100)}% afinidad, nota ${item.strongestSupport.rating}).`
        : 'Sin señal principal.';

    poster.alt = item.title ? `Poster de ${item.title}` : 'Poster';
    if (item.posterUrl) {
      setPosterSource(poster, item.posterUrl);
    } else {
      poster.removeAttribute('src');
      poster.style.visibility = 'hidden';
    }

    if (item.url) {
      posterLink.href = item.url;
    } else {
      posterLink.removeAttribute('href');
      posterLink.style.pointerEvents = 'none';
    }

    const chipsData = [
      `👥 Soporte: ${item.supportCount} usuario${item.supportCount === 1 ? '' : 's'}`,
      `⭐ Nota media soporte: ${item.supportAvgRating.toFixed(1)}`,
      `🧪 Solidez media: ${Math.round(item.overlapAvg)} títulos en común`
    ];

    chipsData.forEach((text) => {
      const chip = document.createElement('span');
      chip.className = 'watch-next-chip';
      chip.textContent = text;
      chips.appendChild(chip);
    });

    fragment.appendChild(node);
  });

  elements.results.appendChild(fragment);
}

async function loadConfig() {
  const response = await fetch('/api/config');
  const payload = await response.json();
  configuredUsers = Array.isArray(payload?.filmaffinity?.users) ? payload.filmaffinity.users : [];
  const queryUser = new URLSearchParams(window.location.search).get(USER_QUERY_KEY) || '';
  const savedUser = localStorage.getItem(SELECTED_USER_KEY) || '';
  const defaultUser = String(payload?.filmaffinity?.defaultUser || '').trim();
  const selected =
    configuredUsers.find((user) => user.name === queryUser) ||
    configuredUsers.find((user) => user.name === savedUser) ||
    configuredUsers.find((user) => user.name === defaultUser) ||
    configuredUsers[0];

  elements.userSelector.innerHTML = '';
  configuredUsers.forEach((user) => {
    const option = document.createElement('option');
    option.value = user.name;
    option.textContent = user.name;
    elements.userSelector.appendChild(option);
  });

  if (selected) {
    selectedUserName = selected.name;
    elements.userSelector.value = selected.name;
    localStorage.setItem(SELECTED_USER_KEY, selected.name);
  } else {
    selectedUserName = '';
  }

  updateQueryString();
}

async function loadRecommendations() {
  if (!selectedUserName) {
    setStatus('No hay usuario seleccionado.', true);
    return;
  }

  elements.results.innerHTML = '';
  elements.results.appendChild(createLoader('Calculando recomendaciones...'));
  setStatus(`Calculando recomendaciones para ${selectedUserName}...`);

  const userNames = configuredUsers.map((user) => user.name);
  const responses = await Promise.all(
    userNames.map((userName) =>
      fetch(`/api/library?userName=${encodeURIComponent(userName)}`).then(async (response) => ({
        userName,
        ok: response.ok,
        payload: await response.json()
      }))
    )
  );

  const librariesByUser = new Map(
    responses
      .filter((entry) => entry.ok)
      .map((entry) => [
        entry.userName,
        (Array.isArray(entry.payload.ratings) ? entry.payload.ratings : []).map(normalizeRecord)
      ])
  );

  const recommendations = buildRecommendations(selectedUserName, librariesByUser);
  allRecommendations = recommendations;
  currentPage = 1;
  updateYearFilterOptions(recommendations);

  elements.pageTitle.textContent = `🍿 Qué ver · ${selectedUserName}`;
  elements.pageSubtitle.textContent =
    'Sugerencias calculadas con afinidad entre usuarios y títulos no vistos por el usuario activo.';

  if (!recommendations.length) {
    setStatus('No se encontraron sugerencias con la señal de afinidad actual.');
  } else {
    setStatus('Recomendaciones actualizadas.');
  }

  applyYearFilterAndRender();
}

elements.userSelector.addEventListener('change', () => {
  selectedUserName = elements.userSelector.value;
  localStorage.setItem(SELECTED_USER_KEY, selectedUserName);
  updateQueryString();
  loadRecommendations().catch((error) => {
    setStatus(error.message || 'No se pudieron calcular recomendaciones.', true);
  });
});

elements.yearFilter.addEventListener('change', () => {
  currentPage = 1;
  applyYearFilterAndRender();
});

elements.prevPage.addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage -= 1;
    applyYearFilterAndRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

elements.nextPage.addEventListener('click', () => {
  currentPage += 1;
  applyYearFilterAndRender();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

async function boot() {
  await loadConfig();
  if (!selectedUserName) {
    setStatus('Falta configurar usuarios en config.json.', true);
    return;
  }
  await loadRecommendations();
}

boot().catch((error) => {
  setStatus(error.message || 'Error inicializando la página Qué ver.', true);
});
