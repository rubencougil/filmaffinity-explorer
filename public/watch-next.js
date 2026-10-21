const {
  parseFlexibleDate, toRating, setPosterSource, normalizeSearch, createFilterState, renderEmptyState,
  createTrailerDialog, initializeUserSelector, updateUserNavigation
} = window.siteUtils;
const PAGE_SIZE = 20;

const elements = {
  userSelector: document.querySelector('#global-user-selector'),
  searchInput: document.querySelector('#watch-next-search-input'),
  minRating: document.querySelector('#watch-next-min-rating'),
  yearFilter: document.querySelector('#watch-next-year-filter'),
  minFaRating: document.querySelector('#watch-next-min-fa-rating'),
  ratedWindow: document.querySelector('#watch-next-rated-window'),
  minScore: document.querySelector('#watch-next-min-score'),
  minSupport: document.querySelector('#watch-next-min-support'),
  minAgreement: document.querySelector('#watch-next-min-agreement'),
  sortBy: document.querySelector('#watch-next-sort-by'),
  sharedOnly: document.querySelector('#watch-next-shared-only'),
  clearFilters: document.querySelector('#watch-next-clear-filters'),
  status: document.querySelector('#watch-next-status'),
  meta: document.querySelector('#watch-next-meta'),
  results: document.querySelector('#watch-next-results'),
  scrollStatus: document.querySelector('#watch-next-scroll-status'),
  template: document.querySelector('#watch-next-template'),
};

const trailerDialog = createTrailerDialog();
let configuredUsers = [];
let selectedUserName = '';
let allRecommendations = [];

const filterState = createFilterState({
  q: elements.searchInput,
  year: elements.yearFilter,
  minRating: elements.minRating,
  minFaRating: elements.minFaRating,
  ratedWindow: elements.ratedWindow,
  minScore: elements.minScore,
  minSupport: elements.minSupport,
  minAgreement: elements.minAgreement,
  sort: elements.sortBy,
  sharedOnly: elements.sharedOnly
});

const pagination = window.createScrollPagination({
  sentinel: elements.scrollStatus,
  pageSize: PAGE_SIZE,
  renderBatch: renderRecommendations,
  updateMeta(shown, total) {
    const availablePeers = configuredUsers.filter((user) => user.name !== selectedUserName).length;
    elements.meta.textContent = allRecommendations.length
      ? `${total ? 1 : 0}-${shown} de ${total} recomendaciones · ${allRecommendations.length} totales · ${availablePeers} usuarios comparados`
      : `0 recomendaciones · ${availablePeers} usuarios comparados`;
  }
});

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.style.color = isError ? 'var(--fa-error)' : '';
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
    rating: toRating(record.rating),
    averageRating: toRating(record.averageRating),
    ratedAt: String(record.ratedAt || '').trim(),
    url: String(record.url || '').trim(),
    posterUrl: String(record.posterUrl || '').trim(),
    trailerVideoId: String(record.trailerVideoId || '').trim(),
    trailerEmbedUrl: String(record.trailerEmbedUrl || '').trim()
  };
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
          trailerVideoId: peerRecord.trailerVideoId,
          trailerEmbedUrl: peerRecord.trailerEmbedUrl,
          weightedScore: 0,
          totalWeight: 0,
          supportUsers: [],
          overlapAvg: 0
        };
        current.trailerVideoId ||= peerRecord.trailerVideoId;
        current.trailerEmbedUrl ||= peerRecord.trailerEmbedUrl;

        current.weightedScore += scoreContribution;
        current.totalWeight += affinity.weight;
        current.supportUsers.push({
          userName: peerName,
          rating: peerRecord.rating,
          averageRating: Number.isFinite(peerRecord.averageRating) ? peerRecord.averageRating : null,
          ratedAt: peerRecord.ratedAt || '',
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
      const faValues = item.supportUsers
        .map((support) => support.averageRating)
        .filter((value) => Number.isFinite(value));
      const supportAvgFaRating = faValues.length
        ? faValues.reduce((sum, value) => sum + value, 0) / faValues.length
        : null;
      const mostRecentSupportVoteAt = item.supportUsers
        .map((support) => parseFlexibleDate(support.ratedAt))
        .filter(Boolean)
        .sort((a, b) => b.getTime() - a.getTime())[0] || null;
      const overlapAvg = supportCount ? item.overlapAvg / supportCount : 0;
      const strongestSupport = [...item.supportUsers].sort((a, b) => b.agreement - a.agreement)[0];
      const rankScore = predicted + supportCount * 0.18 + supportAvgRating * 0.02;

      return {
        ...item,
        predicted,
        supportCount,
        supportAvgRating,
        supportAvgFaRating,
        mostRecentSupportVoteAt,
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
    });
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
  const query = normalizeSearch(elements.searchInput.value);
  const minRating = Number(elements.minRating?.value || 0);
  const selectedYear = elements.yearFilter.value || 'all';
  const minFaRating = Number(elements.minFaRating?.value || 0);
  const ratedWindowDays = Number(elements.ratedWindow?.value || 0);
  const minScore = Number(elements.minScore?.value || 0);
  const minSupport = Number(elements.minSupport?.value || 2);
  const minAgreement = Number(elements.minAgreement?.value || 0);
  const sortBy = String(elements.sortBy?.value || 'year-desc');
  const sharedOnly = Boolean(elements.sharedOnly?.checked);
  const now = Date.now();

  const filtered = allRecommendations.filter((item) => {
    const yearMatch = selectedYear === 'all' || String(item.year || '').trim() === selectedYear;
    const titleMatch = !query || normalizeSearch(item.title).includes(query);
    const ratingMatch = !minRating || Number(item.supportAvgRating || 0) >= minRating;
    const faMatch = !minFaRating || Number(item.supportAvgFaRating || -Infinity) >= minFaRating;
    const windowMatch =
      !ratedWindowDays ||
      (item.mostRecentSupportVoteAt &&
        now - item.mostRecentSupportVoteAt.getTime() <= ratedWindowDays * 24 * 60 * 60 * 1000);
    const scoreMatch = !minScore || Number(item.predicted || 0) >= minScore;
    const supportMatch = Number(item.supportCount || 0) >= minSupport;
    const agreementMatch =
      !minAgreement || Number(item.strongestSupport?.agreement || 0) >= minAgreement;
    const sharedMatch = !sharedOnly || Number(item.supportCount || 0) > 1;
    return (
      yearMatch &&
      titleMatch &&
      ratingMatch &&
      faMatch &&
      windowMatch &&
      scoreMatch &&
      supportMatch &&
      agreementMatch &&
      sharedMatch
    );
  });

  filtered.sort((a, b) => {
    if (sortBy === 'score-desc') {
      return Number(b.predicted || 0) - Number(a.predicted || 0) || a.title.localeCompare(b.title);
    }
    if (sortBy === 'support-desc') {
      return (
        Number(b.supportCount || 0) - Number(a.supportCount || 0) ||
        Number(b.predicted || 0) - Number(a.predicted || 0) ||
        a.title.localeCompare(b.title)
      );
    }
    if (sortBy === 'agreement-desc') {
      return (
        Number(b.strongestSupport?.agreement || 0) - Number(a.strongestSupport?.agreement || 0) ||
        Number(b.predicted || 0) - Number(a.predicted || 0) ||
        a.title.localeCompare(b.title)
      );
    }
    if (sortBy === 'year-desc') {
      const yearDiff = getYearSortValue(b.year) - getYearSortValue(a.year);
      return yearDiff || Number(b.predicted || 0) - Number(a.predicted || 0) || a.title.localeCompare(b.title);
    }
    if (sortBy === 'title-asc') {
      return a.title.localeCompare(b.title);
    }
    return Number(b.rankScore || 0) - Number(a.rankScore || 0) || a.title.localeCompare(b.title);
  });

  return filtered;
}

function applyYearFilterAndRender() {
  filterState.save();
  pagination.reset(getFilteredRecommendations());
}

function clearFilters() {
  filterState.reset();
  elements.minSupport.value = '1';
  applyYearFilterAndRender();
  elements.searchInput.focus();
}

function renderRecommendations(items, startRank = 1, append = false) {
  if (!append) {
    elements.results.innerHTML = '';
  }

  if (!items.length) {
    renderEmptyState(elements.results, allRecommendations.length
      ? 'No hay recomendaciones para la búsqueda y los filtros actuales.'
      : 'No hay suficientes datos de afinidad para generar recomendaciones útiles todavía.',
    allRecommendations.length ? clearFilters : null);
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach((item, index) => {
    const node = elements.template.content.firstElementChild.cloneNode(true);
    const posterLink = node.querySelector('.watch-next-poster-link');
    const poster = node.querySelector('.watch-next-poster');
    const chips = node.querySelector('.watch-next-chips');

    node.querySelector('.watch-next-score').textContent = `Estimada ${item.predicted.toFixed(2)}/10`;
    node.querySelector('.watch-next-title').textContent = `${startRank + index}. ${item.title}`;
    node.querySelector('.watch-next-year').textContent = item.year || '';
    node.querySelector('.watch-next-year').hidden = !item.year;
    node.querySelector('.watch-next-rationale').textContent =
      item.strongestSupport
        ? `Gustos más parecidos: ${item.strongestSupport.userName} (${Math.round(item.strongestSupport.agreement * 100)}% de afinidad; le dio ${item.strongestSupport.rating}/10).`
        : 'Sin una comparación principal disponible.';

    poster.alt = item.title ? `Poster de ${item.title}` : 'Poster';
    posterLink.setAttribute('aria-label', `Ver ${item.title} en FilmAffinity`);
    if (item.posterUrl) {
      posterLink.classList.remove('is-empty');
      setPosterSource(poster, item.posterUrl, { priority: !append && index === 0 });
    } else {
      posterLink.classList.add('is-empty');
      poster.removeAttribute('src');
      poster.style.visibility = 'hidden';
    }

    if (item.url) {
      posterLink.href = item.url;
    } else {
      posterLink.removeAttribute('href');
      posterLink.style.pointerEvents = 'none';
    }

    const trailerButton = document.createElement('button');
    trailerButton.type = 'button';
    trailerButton.className = 'trailer-button';
    trailerButton.textContent = '▶';
    trailerButton.setAttribute('aria-label', `Ver trailer de ${item.title}`);
    trailerButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      trailerDialog.open(item);
    });
    node.querySelector('.poster-wrap').appendChild(trailerButton);

    const chipsData = [
      `👥 Recomendada por ${item.supportCount} usuario${item.supportCount === 1 ? '' : 's'}`,
      `⭐ Su nota media: ${item.supportAvgRating.toFixed(1)}/10`,
      `🤝 ${Math.round(item.overlapAvg)} títulos en común contigo, de media`
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
  const config = await initializeUserSelector(elements.userSelector);
  configuredUsers = config.users;
  selectedUserName = config.userName;
}

async function loadRecommendations() {
  return runRecommendationsLoad(async (isCurrent) => {
    pagination.pause();
    allRecommendations = [];
    elements.results.innerHTML = '';
    elements.results.appendChild(createLoader('Calculando recomendaciones...'));
    setStatus('Calculando recomendaciones...');
    if (!selectedUserName) await loadConfig();
    if (!isCurrent()) return;
    if (!selectedUserName) throw new Error('Falta configurar usuarios en config.json.');

    const userNames = configuredUsers.map((user) => user.name);
    const responses = await Promise.all(
      userNames.map((userName) =>
        fetch(`/api/library?userName=${encodeURIComponent(userName)}&otherVotes=false`).then(async (response) => ({
          userName,
          ok: response.ok,
          payload: await response.json()
        }))
      )
    );
    if (!isCurrent()) return;
    const failed = responses.find((entry) => !entry.ok);
    if (failed) throw new Error(failed.payload.error || `No se pudo cargar la biblioteca de ${failed.userName}.`);

    const librariesByUser = new Map(
      responses.map((entry) => [
        entry.userName,
        (Array.isArray(entry.payload.ratings) ? entry.payload.ratings : []).map(normalizeRecord)
      ])
    );

    const recommendations = buildRecommendations(selectedUserName, librariesByUser);
    allRecommendations = recommendations;
    updateYearFilterOptions(recommendations);
    filterState.restore();

    if (!recommendations.length) {
      setStatus('No se encontraron sugerencias con la señal de afinidad actual.');
    } else {
      setStatus('Recomendaciones actualizadas.');
    }

    applyYearFilterAndRender();
  });
}

elements.userSelector.addEventListener('change', () => {
  selectedUserName = elements.userSelector.value;
  updateUserNavigation(selectedUserName);
  loadRecommendations();
});
elements.clearFilters.addEventListener('click', clearFilters);
elements.yearFilter.addEventListener('change', () => {
  applyYearFilterAndRender();
});
if (elements.searchInput) {
  elements.searchInput.addEventListener('input', () => {
    applyYearFilterAndRender();
  });
}
if (elements.minRating) {
  elements.minRating.addEventListener('change', () => {
    applyYearFilterAndRender();
  });
}
if (elements.minFaRating) {
  elements.minFaRating.addEventListener('change', () => {
    applyYearFilterAndRender();
  });
}
if (elements.ratedWindow) {
  elements.ratedWindow.addEventListener('change', () => {
    applyYearFilterAndRender();
  });
}
if (elements.minScore) {
  elements.minScore.addEventListener('change', () => {
    applyYearFilterAndRender();
  });
}
if (elements.minSupport) {
  elements.minSupport.addEventListener('change', () => {
    applyYearFilterAndRender();
  });
}
if (elements.minAgreement) {
  elements.minAgreement.addEventListener('change', () => {
    applyYearFilterAndRender();
  });
}
if (elements.sortBy) {
  elements.sortBy.addEventListener('change', () => {
    applyYearFilterAndRender();
  });
}
if (elements.sharedOnly) {
  elements.sharedOnly.addEventListener('change', () => {
    applyYearFilterAndRender();
  });
}

const runRecommendationsLoad = window.siteUtils.createLatestLoader(elements.status, (error) => {
  window.siteUtils.showError(error, elements.status, [elements.results], loadRecommendations);
  elements.meta.textContent = '';
});
loadRecommendations();
