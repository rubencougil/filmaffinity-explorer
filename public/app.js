const PAGE_SIZE = 24;
const SELECTED_USER_KEY = 'filmaffinity-browser-selected-user';
const USER_QUERY_KEY = 'userName';

const elements = {
  searchInput: document.querySelector('#search-input'),
  minRating: document.querySelector('#min-rating'),
  yearFilter: document.querySelector('#year-filter'),
  yearFilterChips: document.querySelector('#year-filter-chips'),
  minFaRating: document.querySelector('#min-fa-rating'),
  ratedWindow: document.querySelector('#rated-window'),
  sortBy: document.querySelector('#sort-by'),
  sharedOnly: document.querySelector('#shared-only'),
  userSelector: document.querySelector('#global-user-selector'),
  navLinks: Array.from(document.querySelectorAll('[data-nav-target]')),
  resultsTitle: document.querySelector('#results-title'),
  results: document.querySelector('#results'),
  resultsMeta: document.querySelector('#results-meta'),
  scrollStatus: document.querySelector('#scroll-status'),
  importStatus: document.querySelector('#import-status'),
  resultTemplate: document.querySelector('#result-template'),
  trailerModal: document.querySelector('#trailer-modal'),
  trailerFrame: document.querySelector('#trailer-frame'),
  trailerClose: document.querySelector('#trailer-close'),
  trailerTitle: document.querySelector('#trailer-title'),
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
let selectedYears = new Set();
let configuredUsers = [];
let selectedUserName = '';

const pagination = window.createScrollPagination({
  sentinel: elements.scrollStatus,
  pageSize: PAGE_SIZE,
  renderBatch: (records, startRank, append) => renderResults(records, append),
  updateMeta(shown, total) {
    elements.resultsMeta.textContent = total
      ? `1-${shown} de ${total} resultado${total === 1 ? '' : 's'} · ${library.length} votaci${library.length === 1 ? 'ón guardada' : 'ones guardadas'}.`
      : `0 resultados · ${library.length} votaci${library.length === 1 ? 'ón guardada' : 'ones guardadas'}.`;
  }
});

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
  pagination.pause();
  elements.results.innerHTML = '';
  elements.results.appendChild(createLoader(message));
  elements.resultsMeta.textContent = 'Cargando datos...';
}

function saveLibrary(records) {
  library = records;
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
    trailerVideoId: String(record.trailerVideoId || '').trim(),
    trailerEmbedUrl: String(record.trailerEmbedUrl || '').trim(),
    otherVotes: Array.isArray(record.otherVotes) ? record.otherVotes : []
  };
}

function getRatingToneClass(value) {
  const rating = Number(value);
  if (!Number.isFinite(rating)) {
    return '';
  }

  if (rating <= 3) {
    return 'rating-tone-low';
  }

  if (rating <= 6) {
    return 'rating-tone-mid';
  }

  return 'rating-tone-high';
}

function getImageProxyUrl(url) {
  return `https://images.weserv.nl/?url=${encodeURIComponent(url)}`;
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

  const directCandidates = [];
  const pushUniqueDirect = (value) => {
    if (value && !directCandidates.includes(value)) {
      directCandidates.push(value);
    }
  };

  if (source.includes('-msmall.')) {
    pushUniqueDirect(source.replace('-msmall.', '-large.'));
    pushUniqueDirect(source.replace('-msmall.', '-mmed.'));
    pushUniqueDirect(source.replace('-msmall.', '-med.'));
  }

  pushUniqueDirect(source);

  // Filmaffinity's image CDN sends Cross-Origin-Resource-Policy: same-origin,
  // which browsers block regardless of our own page's policy. Route the
  // request through a public image proxy so it's fetched server-side and
  // re-served without that restriction. Keep the direct URL as a fallback.
  directCandidates.forEach((directUrl) => {
    pushUnique(getImageProxyUrl(directUrl));
  });
  directCandidates.forEach((directUrl) => {
    pushUnique(directUrl);
  });

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

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case '\'':
        return '&#39;';
      default:
        return character;
    }
  });
}

function buildTrailerEmbedUrl(record) {
  const explicitEmbedUrl = String(record?.trailerEmbedUrl || '').trim();
  if (explicitEmbedUrl) {
    return explicitEmbedUrl;
  }

  const videoId = String(record?.trailerVideoId || '').trim();
  if (!videoId) {
    return '';
  }

  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&playsinline=1`;
}

function closeTrailerModal() {
  if (!elements.trailerModal) {
    return;
  }

  elements.trailerFrame.removeAttribute('src');
  elements.trailerFrame.removeAttribute('srcdoc');
  elements.trailerModal.hidden = true;
  document.body.classList.remove('modal-open');
}

function openTrailer(record) {
  if (!elements.trailerModal || !elements.trailerFrame || !elements.trailerTitle) {
    return;
  }

  const safeTitle = String(record?.title || '').trim() || 'Trailer';
  const safeYear = String(record?.year || '').trim();
  const embedUrl = buildTrailerEmbedUrl(record);

  elements.trailerTitle.textContent = safeYear ? `${safeTitle} (${safeYear})` : safeTitle;
  elements.trailerFrame.removeAttribute('src');
  elements.trailerFrame.removeAttribute('srcdoc');

  if (embedUrl) {
    elements.trailerFrame.src = embedUrl;
  } else {
    elements.trailerFrame.srcdoc = `<!doctype html><html lang="es"><head><meta charset="utf-8" /><style>body{font-family:system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0;text-align:center;padding:24px}p{max-width:28rem;line-height:1.5}</style></head><body><p>No hemos podido resolver el tráiler de <strong>${escapeHtml(safeTitle)}</strong> todavía.</p><p>Vuelve a sincronizar la biblioteca para completar los videoId pendientes.</p></body></html>`;
  }

  elements.trailerModal.hidden = false;
  document.body.classList.add('modal-open');
  elements.trailerClose?.focus();
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

function renderYearFilterChips() {
  if (!elements.yearFilterChips) {
    return;
  }
  elements.yearFilterChips.innerHTML = '';
  const years = [...selectedYears].sort((a, b) => getYearSortValue(b) - getYearSortValue(a));
  elements.yearFilterChips.hidden = years.length === 0;

  years.forEach((year) => {
    const chip = document.createElement('span');
    chip.className = 'year-filter-chip';

    const label = document.createElement('span');
    label.textContent = year;

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'year-filter-chip-remove';
    removeButton.setAttribute('aria-label', `Quitar el año ${year} del filtro`);
    removeButton.textContent = '✕';
    removeButton.addEventListener('click', () => {
      selectedYears.delete(year);
      renderYearFilterChips();
      updateYearFilterOptions(library, { keepSelection: true });
      render();
    });

    chip.append(label, removeButton);
    elements.yearFilterChips.appendChild(chip);
  });
}

function updateYearFilterOptions(records, { keepSelection = false } = {}) {
  if (!keepSelection) {
    selectedYears.clear();
  } else {
    const availableYears = new Set(
      records.map((record) => String(record.year || '').trim()).filter(Boolean)
    );
    selectedYears = new Set([...selectedYears].filter((year) => availableYears.has(year)));
  }

  const years = [...new Set(records.map((record) => String(record.year || '').trim()).filter(Boolean))]
    .filter((year) => !selectedYears.has(year))
    .sort((a, b) => {
      const diff = getYearSortValue(b) - getYearSortValue(a);
      return diff !== 0 ? diff : b.localeCompare(a);
    });

  elements.yearFilter.innerHTML = '';
  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = 'Añadir año…';
  elements.yearFilter.appendChild(placeholderOption);

  years.forEach((year) => {
    const option = document.createElement('option');
    option.value = year;
    option.textContent = year;
    elements.yearFilter.appendChild(option);
  });

  elements.yearFilter.value = '';
  renderYearFilterChips();
}

function updateSelectedUserLabel() {
  elements.resultsTitle.textContent = selectedUserName
    ? `🎬 Votaciones de ${selectedUserName}`
    : '🎬 Votaciones del usuario seleccionado';
}

function renderResults(records, append = false) {
  if (!append) {
    elements.results.innerHTML = '';
  }

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
    const votePill = node.querySelector('.vote-pill');
    votePill.textContent = record.rating ?? '-';
    const voteToneClass = getRatingToneClass(record.rating);
    if (voteToneClass) {
      votePill.classList.add(voteToneClass);
    }
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

      const otherToneClass = getRatingToneClass(otherRating);
      if (otherToneClass) {
        value.classList.add(otherToneClass);
      }
      value.textContent = marker ? `${marker} ${vote.rating}` : String(vote.rating);

      row.append(user, value);
      comparisonList.appendChild(row);
    }

    fragment.appendChild(node);
  }

  elements.results.appendChild(fragment);
}

function filterRecords() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const minRating = Number(elements.minRating.value);
  const minFaRating = Number(elements.minFaRating?.value || 0);
  const ratedWindowDays = Number(elements.ratedWindow?.value || 0);
  const sortBy = String(elements.sortBy?.value || 'recent');
  const sharedOnly = Boolean(elements.sharedOnly.checked);
  const now = Date.now();

  const filtered = library.filter((record) => {
    const haystack = `${record.title} ${record.year} ${record.url}`.toLowerCase();
    const queryMatch = !query || haystack.includes(query);
    const ratingMatch = !minRating || (record.rating ?? -Infinity) >= minRating;
    const yearMatch = selectedYears.size === 0 || selectedYears.has(String(record.year || '').trim());
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

  updateSelectedUserLabel();
  pagination.reset(filtered);
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
  render();
});
elements.minRating.addEventListener('change', () => {
  render();
});
elements.yearFilter.addEventListener('change', () => {
  const value = elements.yearFilter.value;
  if (!value) {
    return;
  }
  selectedYears.add(value);
  updateYearFilterOptions(library, { keepSelection: true });
  render();
});
if (elements.minFaRating) {
  elements.minFaRating.addEventListener('change', () => {
    render();
  });
}
if (elements.ratedWindow) {
  elements.ratedWindow.addEventListener('change', () => {
    render();
  });
}
if (elements.sortBy) {
  elements.sortBy.addEventListener('change', () => {
    render();
  });
}
elements.sharedOnly.addEventListener('change', () => {
  render();
});
elements.userSelector.addEventListener('change', () => {
  selectedUserName = elements.userSelector.value;
  localStorage.setItem(SELECTED_USER_KEY, selectedUserName);
  updateQueryString();
  updateNavLinks();
  library = [];
  showLibraryLoader(`Cargando la biblioteca del usuario ${selectedUserName}...`);
  setStatus(`Usuario activo: ${selectedUserName}. Cargando biblioteca...`);
  loadLibraryForSelectedUser().catch((error) => {
    setStatus(error.message || 'No se pudo cargar la biblioteca.', true);
  });
});
elements.trailerClose?.addEventListener('click', closeTrailerModal);
elements.trailerModal?.addEventListener('click', (event) => {
  if (event.target === elements.trailerModal) {
    closeTrailerModal();
  }
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && elements.trailerModal && !elements.trailerModal.hidden) {
    closeTrailerModal();
  }
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

(function initMobileFilterToggle() {
  const toggle = document.getElementById('mobile-filter-toggle');
  const sidebar = document.getElementById('filter-sidebar');
  if (!toggle || !sidebar) return;
  toggle.addEventListener('click', () => {
    const isOpen = sidebar.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.querySelector('.mobile-filter-toggle-label').textContent = isOpen
      ? '✕ Ocultar filtros'
      : '🔧 Mostrar filtros';
  });
}());
