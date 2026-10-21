const {
  parseFlexibleDate, toRating, setPosterSource, normalizeSearch, createFilterState, renderEmptyState,
  createTrailerDialog, initializeUserSelector, updateUserNavigation
} = window.siteUtils;
const PAGE_SIZE = 24;

const elements = {
  searchInput: document.querySelector('#search-input'),
  minRating: document.querySelector('#min-rating'),
  yearFilter: document.querySelector('#year-filter'),
  yearFilterChips: document.querySelector('#year-filter-chips'),
  minFaRating: document.querySelector('#min-fa-rating'),
  ratedWindow: document.querySelector('#rated-window'),
  sortBy: document.querySelector('#sort-by'),
  sharedOnly: document.querySelector('#shared-only'),
  clearFilters: document.querySelector('#clear-filters'),
  userSelector: document.querySelector('#global-user-selector'),
  resultsTitle: document.querySelector('#results-title'),
  results: document.querySelector('#results'),
  resultsMeta: document.querySelector('#results-meta'),
  scrollStatus: document.querySelector('#scroll-status'),
  importStatus: document.querySelector('#import-status'),
  resultTemplate: document.querySelector('#result-template'),
};

const trailerDialog = createTrailerDialog();
let library = [];
let selectedYears = new Set(new URLSearchParams(window.location.search).getAll('year'));
let selectedUserName = '';

const filterState = createFilterState({
  q: elements.searchInput,
  minRating: elements.minRating,
  minFaRating: elements.minFaRating,
  ratedWindow: elements.ratedWindow,
  sort: elements.sortBy,
  sharedOnly: elements.sharedOnly
});

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
    rating: toRating(record.rating),
    averageRating: toRating(record.averageRating),
    ratedAt: String(record.ratedAt || '').trim(),
    url: String(record.url || '').trim(),
    posterUrl: String(record.posterUrl || '').trim(),
    trailerVideoId: String(record.trailerVideoId || '').trim(),
    trailerEmbedUrl: String(record.trailerEmbedUrl || '').trim(),
    otherVotes: Array.isArray(record.otherVotes) ? record.otherVotes : []
  };
}

function getRatingToneClass(value) {
  const rating = toRating(value);
  if (rating === null) {
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
    renderEmptyState(elements.results, library.length
      ? 'No hay resultados para la búsqueda y los filtros actuales.'
      : 'Todavía no hay títulos guardados para este usuario. Sincroniza su biblioteca para empezar.',
    library.length ? clearFilters : null);
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
    posterLink.setAttribute('aria-label', `Ver ${record.title} en FilmAffinity`);
    poster.alt = record.title ? `Poster for ${record.title}` : 'Film poster';

    const trailerButton = document.createElement('button');
    trailerButton.type = 'button';
    trailerButton.className = 'trailer-button';
    trailerButton.textContent = '▶';
    trailerButton.setAttribute('aria-label', `Ver trailer de ${record.title}`);
    trailerButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      trailerDialog.open(record);
    });
    node.querySelector('.poster-wrap').appendChild(trailerButton);

    if (record.posterUrl) {
      posterLink.classList.remove('is-empty');
      setPosterSource(poster, record.posterUrl, { priority: !append && fragment.childElementCount === 0 });
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
      const currentRating = record.rating;
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
  const query = normalizeSearch(elements.searchInput.value);
  const minRating = Number(elements.minRating.value);
  const minFaRating = Number(elements.minFaRating?.value || 0);
  const ratedWindowDays = Number(elements.ratedWindow?.value || 0);
  const sortBy = String(elements.sortBy?.value || 'recent');
  const sharedOnly = Boolean(elements.sharedOnly.checked);
  const now = Date.now();

  const filtered = library.filter((record) => {
    const haystack = normalizeSearch(`${record.title} ${record.year} ${record.url}`);
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
  filterState.save({ year: [...selectedYears].sort() });
  filterRecords();
}

function clearFilters() {
  filterState.reset();
  selectedYears.clear();
  updateYearFilterOptions(library, { keepSelection: true });
  render();
  elements.searchInput.focus();
}

async function loadLibraryForSelectedUser() {
  return runLibraryLoad(async (isCurrent) => {
    library = [];
    showLibraryLoader();
    setStatus('Cargando biblioteca...');
    if (!selectedUserName) await loadConfig();
    if (!isCurrent()) return;
    if (!selectedUserName) throw new Error('Falta configurar usuarios en config.json.');

    const response = await fetch(`/api/library?userName=${encodeURIComponent(selectedUserName)}`);
    const payload = await response.json();
    if (!isCurrent()) return;
    if (!response.ok) throw new Error(payload.error || 'No se pudo cargar la biblioteca.');

    const records = dedupeRecords(payload.ratings || []);
    updateYearFilterOptions(records, { keepSelection: true });
    saveLibrary(records);

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
  });
}

async function loadConfig() {
  const config = await initializeUserSelector(elements.userSelector);
  selectedUserName = config.userName;
  updateSelectedUserLabel();
}

elements.clearFilters.addEventListener('click', clearFilters);
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
  updateUserNavigation(selectedUserName);
  loadLibraryForSelectedUser();
});

const runLibraryLoad = window.siteUtils.createLatestLoader(elements.importStatus, (error) => {
  window.siteUtils.showError(error, elements.importStatus, [elements.results], loadLibraryForSelectedUser);
  elements.resultsMeta.textContent = '';
});
filterState.restore();
loadLibraryForSelectedUser();
