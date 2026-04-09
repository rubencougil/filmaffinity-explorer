const PAGE_SIZE = 24;
const SELECTED_USER_KEY = 'filmaffinity-browser-selected-user';
const USER_QUERY_KEY = 'userName';

const elements = {
  searchInput: document.querySelector('#search-input'),
  minRating: document.querySelector('#min-rating'),
  yearFilter: document.querySelector('#year-filter'),
  minFaRating: document.querySelector('#min-fa-rating'),
  ratedWindow: document.querySelector('#rated-window'),
  sortBy: document.querySelector('#sort-by'),
  sharedOnly: document.querySelector('#shared-only'),
  userSelector: document.querySelector('#global-user-selector'),
  navLinks: Array.from(document.querySelectorAll('[data-nav-target]')),
  resultsTitle: document.querySelector('#results-title'),
  results: document.querySelector('#results'),
  resultsMeta: document.querySelector('#results-meta'),
  pagination: document.querySelector('#pagination'),
  prevPage: document.querySelector('#prev-page'),
  nextPage: document.querySelector('#next-page'),
  pageInfo: document.querySelector('#page-info'),
  importStatus: document.querySelector('#import-status'),
  resultTemplate: document.querySelector('#result-template'),
};

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

let library = [];
let currentPage = 1;
let configuredUsers = [];
let selectedUserName = '';

function updateNavLinks() {
  const userParam = selectedUserName ? `?${USER_QUERY_KEY}=${encodeURIComponent(selectedUserName)}` : '';
  const byTarget = {
    home: `index.html${userParam}`,
    stats: `stats.html${userParam}`,
    affinity: `affinity.html${userParam}`,
    watchnext: `watch-next.html${userParam}`
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
}

function createLoader(message = 'Cargando...') {
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

function showLibraryLoader(message = 'Cargando biblioteca...') {
  elements.results.innerHTML = '';
  elements.results.appendChild(createLoader(message));
  elements.resultsMeta.textContent = 'Cargando datos...';
  elements.pagination.hidden = true;
}

function saveLibrary(records) {
  library = records;
  currentPage = 1;
  render();
}

function normalizeRecord(record) {
  return {
    title: String(record.title || '').trim(),
    year: String(record.year || '').trim(),
    rating: Number.isFinite(Number(record.rating)) ? Number(record.rating) : null,
    averageRating: Number.isFinite(Number(record.averageRating)) ? Number(record.averageRating) : null,
    ratedAt: String(record.ratedAt || '').trim(),
    url: String(record.url || '').trim(),
    posterUrl: String(record.posterUrl || '').trim(),
    otherVotes: Array.isArray(record.otherVotes) ? record.otherVotes : []
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

function parseFlexibleDate(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  const spanishMatch = text
    .toLowerCase()
    .match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i);

  if (!spanishMatch) {
    return null;
  }

  const day = Number(spanishMatch[1]);
  const monthName = spanishMatch[2]
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const year = Number(spanishMatch[3]);
  const month = SPANISH_MONTHS[monthName];

  if (month === undefined) {
    return null;
  }

  return new Date(year, month, day);
}

function dedupeRecords(records) {
  const seen = new Set();
  const normalized = [];

  for (const rawRecord of records) {
    const record = normalizeRecord(rawRecord);
    if (!record.title) {
      continue;
    }

    const key = record.url || `${record.title}|${record.rating || ''}|${record.ratedAt || ''}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(record);
  }

  return normalized.sort((a, b) => {
    const aDate = parseFlexibleDate(a.ratedAt);
    const bDate = parseFlexibleDate(b.ratedAt);
    const dateDiff = (bDate ? bDate.getTime() : 0) - (aDate ? aDate.getTime() : 0);
    if (dateDiff !== 0) {
      return dateDiff;
    }

    return a.title.localeCompare(b.title);
  });
}

function formatDate(value) {
  if (!value) {
    return 'Fecha no disponible';
  }

  const parsed = parseFlexibleDate(value);
  if (!parsed) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(parsed);
}

function setStatus(message, isError = false) {
  elements.importStatus.textContent = message;
  elements.importStatus.style.color = isError ? 'var(--fa-error)' : '';
}

function getYearSortValue(yearText) {
  const match = String(yearText || '').match(/\d{4}/);
  return match ? Number(match[0]) : Number.NEGATIVE_INFINITY;
}

function updateYearFilterOptions(records) {
  const previousValue = elements.yearFilter.value || 'all';
  const years = [...new Set(records.map((record) => String(record.year || '').trim()).filter(Boolean))]
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

function updateSelectedUserLabel() {
  elements.resultsTitle.textContent = selectedUserName
    ? `🎬 Votaciones de ${selectedUserName}`
    : '🎬 Votaciones del usuario seleccionado';
}

function buildTrailerQuery(title, year) {
  return [title, year, 'trailer'].filter(Boolean).join(' ');
}

function openTrailer(record) {
  const safeTitle = String(record?.title || '').trim() || 'Trailer';
  const safeYear = String(record?.year || '').trim();
  window.open(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(buildTrailerQuery(safeTitle, safeYear))}`,
    '_blank',
    'noopener,noreferrer'
  );
}

function renderResults(records) {
  elements.results.innerHTML = '';

  if (!records.length) {
    const emptyState = document.createElement('p');
    emptyState.className = 'status-text';
    emptyState.textContent = library.length
      ? 'No hay resultados para los filtros actuales.'
      : 'Todavía no hay títulos cargados para este usuario. Ve a la pestaña Sync para actualizar.';
    elements.results.appendChild(emptyState);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const record of records) {
    const node = elements.resultTemplate.content.firstElementChild.cloneNode(true);
    const posterLink = node.querySelector('.poster-link');
    const poster = node.querySelector('.result-poster');
    const comparisonList = node.querySelector('.comparison-list');
    const yearNode = node.querySelector('.result-year');
    const averageNode = node.querySelector('.fa-average-pill');
    node.querySelector('.vote-pill').textContent = record.rating ?? '-';
    if (Number.isFinite(record.averageRating)) {
      averageNode.textContent = `FA ${record.averageRating.toFixed(1)}`;
    } else {
      averageNode.remove();
    }
    yearNode.textContent = record.year || '';
    yearNode.hidden = !record.year;
    node.querySelector('.result-title').textContent = record.title;
    node.querySelector('.result-date').textContent = `Votada: ${formatDate(record.ratedAt)}`;

    posterLink.href = record.url || '#';
    poster.alt = record.title ? `Poster for ${record.title}` : 'Film poster';

    const trailerButton = document.createElement('button');
    trailerButton.type = 'button';
    trailerButton.className = 'trailer-button';
    trailerButton.textContent = '▶';
    trailerButton.setAttribute('aria-label', `Ver trailer de ${record.title}`);
    trailerButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openTrailer(record);
    });
    posterLink.appendChild(trailerButton);

    if (record.posterUrl) {
      posterLink.classList.remove('is-empty');
      setPosterSource(poster, record.posterUrl);
    } else {
      posterLink.classList.add('is-empty');
      poster.removeAttribute('src');
      poster.alt = '';
      poster.style.visibility = 'hidden';
    }

    if (!record.url) {
      posterLink.removeAttribute('href');
      posterLink.style.pointerEvents = 'none';
    }

    for (const vote of record.otherVotes) {
      const row = document.createElement('div');
      row.className = 'comparison-row';

      const user = document.createElement('span');
      user.className = 'comparison-user';
      user.textContent = vote.userName;

      const value = document.createElement('span');
      value.className = 'comparison-value';
      const otherRating = Number(vote.rating);
      const currentRating = Number(record.rating);
      let marker = '';

      if (Number.isFinite(otherRating) && Number.isFinite(currentRating)) {
        if (otherRating > currentRating) {
          marker = '↑';
          value.classList.add('is-higher');
        } else if (otherRating < currentRating) {
          marker = '↓';
          value.classList.add('is-lower');
        }
      }

      value.textContent = marker ? `${marker} ${vote.rating}` : String(vote.rating);

      row.append(user, value);
      comparisonList.appendChild(row);
    }

    fragment.appendChild(node);
  }

  elements.results.appendChild(fragment);
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

function filterRecords() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const minRating = Number(elements.minRating.value);
  const selectedYear = elements.yearFilter.value || 'all';
  const minFaRating = Number(elements.minFaRating?.value || 0);
  const ratedWindowDays = Number(elements.ratedWindow?.value || 0);
  const sortBy = String(elements.sortBy?.value || 'recent');
  const sharedOnly = Boolean(elements.sharedOnly.checked);
  const now = Date.now();

  const filtered = library.filter((record) => {
    const haystack = `${record.title} ${record.year} ${record.url}`.toLowerCase();
    const queryMatch = !query || haystack.includes(query);
    const ratingMatch = !minRating || (record.rating ?? -Infinity) >= minRating;
    const yearMatch = selectedYear === 'all' || record.year === selectedYear;
    const faMatch = !minFaRating || (record.averageRating ?? -Infinity) >= minFaRating;
    const parsedDate = parseFlexibleDate(record.ratedAt);
    const windowMatch =
      !ratedWindowDays ||
      (parsedDate && now - parsedDate.getTime() <= ratedWindowDays * 24 * 60 * 60 * 1000);
    const sharedMatch = !sharedOnly || record.otherVotes.length > 0;
    return queryMatch && ratingMatch && yearMatch && faMatch && windowMatch && sharedMatch;
  });

  filtered.sort((a, b) => {
    if (sortBy === 'rating-desc') {
      return (b.rating ?? -Infinity) - (a.rating ?? -Infinity) || a.title.localeCompare(b.title);
    }
    if (sortBy === 'rating-asc') {
      return (a.rating ?? Infinity) - (b.rating ?? Infinity) || a.title.localeCompare(b.title);
    }
    if (sortBy === 'fa-desc') {
      return (
        (b.averageRating ?? -Infinity) - (a.averageRating ?? -Infinity) ||
        a.title.localeCompare(b.title)
      );
    }
    if (sortBy === 'fa-asc') {
      return (
        (a.averageRating ?? Infinity) - (b.averageRating ?? Infinity) ||
        a.title.localeCompare(b.title)
      );
    }
    if (sortBy === 'year-desc') {
      const diff = getYearSortValue(b.year) - getYearSortValue(a.year);
      return diff || a.title.localeCompare(b.title);
    }
    if (sortBy === 'year-asc') {
      const diff = getYearSortValue(a.year) - getYearSortValue(b.year);
      return diff || a.title.localeCompare(b.title);
    }
    if (sortBy === 'title-asc') {
      return a.title.localeCompare(b.title);
    }
    const aDate = parseFlexibleDate(a.ratedAt);
    const bDate = parseFlexibleDate(b.ratedAt);
    return (bDate ? bDate.getTime() : 0) - (aDate ? aDate.getTime() : 0) || a.title.localeCompare(b.title);
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const startIndex = filtered.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const endIndex = Math.min(currentPage * PAGE_SIZE, filtered.length);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  elements.resultsMeta.textContent = filtered.length
    ? `${startIndex}-${endIndex} de ${filtered.length} resultado${filtered.length === 1 ? '' : 's'} · ${library.length} votaci${library.length === 1 ? 'ón guardada' : 'ones guardadas'}.`
    : `0 resultados · ${library.length} votaci${library.length === 1 ? 'ón guardada' : 'ones guardadas'}.`;

  updateSelectedUserLabel();
  renderResults(visible);
  renderPagination(filtered.length);
}

function render() {
  filterRecords();
}

async function loadLibraryForSelectedUser() {
  if (!selectedUserName) {
    return;
  }

  showLibraryLoader(`Cargando la biblioteca del usuario ${selectedUserName}...`);
  const response = await fetch(`/api/library?userName=${encodeURIComponent(selectedUserName)}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'No se pudo cargar la biblioteca.');
  }

  const records = dedupeRecords(payload.ratings || []);
  updateYearFilterOptions(records);
  saveLibrary(records);

  const hasAnyPersonalRating = records.some(
    (record) => record.rating !== null && record.rating !== undefined
  );
  if (!hasAnyPersonalRating && Number(elements.minRating.value) > 0) {
    elements.minRating.value = '0';
    render();
    setStatus(
      `La biblioteca de ${selectedUserName} no incluye nota personal en los datos actuales. Mostrando todos los titulos.`
    );
    return;
  }

  if (payload.status === 'running') {
    setStatus(`Sincronización en marcha para ${selectedUserName}.`);
  } else if (payload.lastSyncedAt) {
    setStatus(`Última sincronización de ${selectedUserName}: ${formatDate(payload.lastSyncedAt)}.`);
  } else if (payload.status === 'failed') {
    setStatus(payload.error || `La sincronización falló para ${selectedUserName}.`, true);
  } else if (payload.status === 'idle') {
    setStatus(`Todavía no hay datos guardados para ${selectedUserName}. Ve a Sync para sincronizar.`);
  } else {
    setStatus(`Biblioteca cargada para ${selectedUserName}.`);
  }
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

  for (const user of configuredUsers) {
    const option = document.createElement('option');
    option.value = user.name;
    option.textContent = user.name;
    elements.userSelector.appendChild(option);
  }

  if (selected) {
    selectedUserName = selected.name;
    elements.userSelector.value = selected.name;
    localStorage.setItem(SELECTED_USER_KEY, selected.name);
  } else {
    selectedUserName = '';
  }

  updateQueryString();
  updateNavLinks();
  updateSelectedUserLabel();
}

elements.searchInput.addEventListener('input', () => {
  currentPage = 1;
  render();
});
elements.minRating.addEventListener('change', () => {
  currentPage = 1;
  render();
});
elements.yearFilter.addEventListener('change', () => {
  currentPage = 1;
  render();
});
if (elements.minFaRating) {
  elements.minFaRating.addEventListener('change', () => {
    currentPage = 1;
    render();
  });
}
if (elements.ratedWindow) {
  elements.ratedWindow.addEventListener('change', () => {
    currentPage = 1;
    render();
  });
}
if (elements.sortBy) {
  elements.sortBy.addEventListener('change', () => {
    currentPage = 1;
    render();
  });
}
elements.sharedOnly.addEventListener('change', () => {
  currentPage = 1;
  render();
});
  elements.userSelector.addEventListener('change', () => {
  selectedUserName = elements.userSelector.value;
  localStorage.setItem(SELECTED_USER_KEY, selectedUserName);
  updateQueryString();
  updateNavLinks();
  currentPage = 1;
  library = [];
  showLibraryLoader(`Cargando la biblioteca del usuario ${selectedUserName}...`);
  setStatus(`Usuario activo: ${selectedUserName}. Cargando biblioteca...`);
  loadLibraryForSelectedUser().catch((error) => {
    setStatus(error.message || 'No se pudo cargar la biblioteca.', true);
  });
});
elements.prevPage.addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage -= 1;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});
elements.nextPage.addEventListener('click', () => {
  currentPage += 1;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

async function boot() {
  showLibraryLoader('Cargando biblioteca...');
  await loadConfig();
  if (selectedUserName) {
    await loadLibraryForSelectedUser();
  } else {
    setStatus('Falta configurar usuarios en config.json.', true);
  }
}

boot();
