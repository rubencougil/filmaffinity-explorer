const {
  parseFlexibleDate, toRating, setPosterSource, initializeUserSelector, updateUserNavigation
} = window.siteUtils;
const COMPARE_QUERY_KEY = 'compareUser';

const elements = {
  status: document.querySelector('#affinity-status'),
  userSelector: document.querySelector('#global-user-selector'),
  peerSelector: document.querySelector('#affinity-peer-selector'),
  content: document.querySelector('#affinity-content')
};

let configuredUsers = [];
let selectedUserName = '';
let selectedPeerName = '';
let library = [];
let libraryLoaded = false;

function updateQueryString() {
  updateUserNavigation(selectedUserName, { [COMPARE_QUERY_KEY]: selectedPeerName });
}

function createLoader(message = 'Cargando afinidad...') {
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

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.style.color = isError ? 'var(--fa-error)' : '';
}

function normalizeRecord(record) {
  return {
    title: String(record.title || '').trim(),
    rating: toRating(record.rating),
    ratedAt: String(record.ratedAt || '').trim(),
    date: parseFlexibleDate(record.ratedAt),
    url: String(record.url || '').trim(),
    posterUrl: String(record.posterUrl || '').trim(),
    otherVotes: Array.isArray(record.otherVotes) ? record.otherVotes : []
  };
}

function formatDate(value, options = {}) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat('es-ES', options).format(value);
}

function formatVoteTooltip(userName, ratedAt) {
  const date = parseFlexibleDate(ratedAt);
  if (!date) {
    return `Votación de ${userName}`;
  }

  return `Votación de ${userName}: ${formatDate(date, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })}`;
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

  records.forEach((rawRecord) => {
    const record = normalizeRecord(rawRecord);
    if (!record.title) {
      return;
    }

    const key = `${record.title}|${record.rating || ''}|${record.url || ''}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    normalized.push(record);
  });

  return normalized;
}

function describeCompatibility(score) {
  if (!Number.isFinite(score)) {
    return 'Sin base de comparación';
  }
  if (score >= 85) {
    return 'Muy alta';
  }
  if (score >= 70) {
    return 'Alta';
  }
  if (score >= 55) {
    return 'Media';
  }
  if (score >= 40) {
    return 'Baja';
  }
  return 'Muy baja';
}

function describeConfidence(overlap) {
  if (overlap >= 120) {
    return 'Alta';
  }
  if (overlap >= 50) {
    return 'Media';
  }
  if (overlap >= 15) {
    return 'Baja';
  }
  return 'Muy baja';
}

function getAffinityTone(score) {
  if (!Number.isFinite(score)) {
    return 'is-unknown';
  }
  if (score >= 85) {
    return 'is-excellent';
  }
  if (score >= 70) {
    return 'is-high';
  }
  if (score >= 55) {
    return 'is-medium';
  }
  return 'is-low';
}

function buildAffinityData(records, peerName) {
  const items = records.flatMap((record) => {
    if (!Number.isFinite(record.rating)) {
      return [];
    }

    const peerVote = record.otherVotes.find(
      (vote) => vote.userName === peerName && toRating(vote.rating) !== null
    );
    if (!peerVote) {
      return [];
    }

    const peerRating = Number(peerVote.rating);
    return [
      {
        title: record.title,
        url: record.url,
        posterUrl: record.posterUrl,
        date: record.date,
        mineRatedAt: record.ratedAt,
        mine: record.rating,
        theirs: peerRating,
        theirsRatedAt: String(peerVote.ratedAt || '').trim(),
        theirsDate: parseFlexibleDate(peerVote.ratedAt),
        diff: Math.abs(record.rating - peerRating)
      }
    ];
  });

  const overlapCount = items.length;
  const totalGap = items.reduce((sum, item) => sum + item.diff, 0);
  const avgGap = overlapCount ? totalGap / overlapCount : null;
  const exactMatches = items.filter((item) => item.diff === 0).length;
  const exactRate = overlapCount ? Math.round((exactMatches / overlapCount) * 100) : null;
  const agreementScore = overlapCount
    ? Math.round((items.reduce((sum, item) => sum + (1 - item.diff / 9), 0) / overlapCount) * 100)
    : null;
  const strongDisagreements = items.filter((item) => item.diff >= 4).length;

  const bias = overlapCount
    ? items.reduce((sum, item) => sum + (item.mine - item.theirs), 0) / overlapCount
    : null;
  const meanMine = overlapCount
    ? items.reduce((sum, item) => sum + item.mine, 0) / overlapCount
    : null;
  const meanTheirs = overlapCount
    ? items.reduce((sum, item) => sum + item.theirs, 0) / overlapCount
    : null;
  const covariance = overlapCount
    ? items.reduce((sum, item) => sum + (item.mine - meanMine) * (item.theirs - meanTheirs), 0)
    : null;
  const varianceMine = overlapCount
    ? items.reduce((sum, item) => sum + (item.mine - meanMine) ** 2, 0)
    : null;
  const varianceTheirs = overlapCount
    ? items.reduce((sum, item) => sum + (item.theirs - meanTheirs) ** 2, 0)
    : null;
  const pearson =
    overlapCount && varianceMine > 0 && varianceTheirs > 0
      ? Number((covariance / Math.sqrt(varianceMine * varianceTheirs)).toFixed(2))
      : null;

  const sortByPeerDateDescThenTitle = (a, b) => {
    const timeA =
      a.theirsDate instanceof Date && !Number.isNaN(a.theirsDate.getTime())
        ? a.theirsDate.getTime()
        : -Infinity;
    const timeB =
      b.theirsDate instanceof Date && !Number.isNaN(b.theirsDate.getTime())
        ? b.theirsDate.getTime()
        : -Infinity;
    return timeB - timeA || a.title.localeCompare(b.title);
  };

  const topAgreements = [...items]
    .sort((a, b) => a.diff - b.diff || a.title.localeCompare(b.title))
    .slice(0, 10)
    .sort(sortByPeerDateDescThenTitle);
  const disagreements = [...items]
    .sort((a, b) => b.diff - a.diff || a.title.localeCompare(b.title))
    .slice(0, 10)
    .sort(sortByPeerDateDescThenTitle);

  return {
    peerName,
    overlapCount,
    avgGap,
    exactMatches,
    exactRate,
    agreementScore,
    strongDisagreements,
    bias,
    pearson,
    topAgreements,
    disagreements
  };
}

function renderAgreementList(titleText, entries, { positive = false } = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'affinity-list-block';
  const title = document.createElement('p');
  title.className = `agreement-list-title${positive ? ' agreement-list-title-good' : ''}`;
  title.textContent = titleText;
  wrapper.appendChild(title);

  const list = document.createElement('ol');
  list.className = `agreement-list${positive ? ' agreement-list-good' : ''}`;

  entries.forEach((entry) => {
    const li = document.createElement('li');
    li.className = 'agreement-item';
    if (!positive) {
      if (entry.diff >= 6) {
        li.classList.add('is-gap-severe');
      } else if (entry.diff >= 4) {
        li.classList.add('is-gap-strong');
      }
    }

    if (entry.posterUrl) {
      const thumb = document.createElement('img');
      thumb.className = 'agreement-thumb';
      setPosterSource(thumb, entry.posterUrl, { thumbnail: true });
      thumb.alt = `Portada de ${entry.title}`;
      thumb.loading = 'lazy';
      li.appendChild(thumb);
    } else {
      const thumbFallback = document.createElement('span');
      thumbFallback.className = 'agreement-thumb-fallback';
      thumbFallback.textContent = '🎞️';
      li.appendChild(thumbFallback);
    }

    const main = document.createElement('div');
    main.className = 'agreement-main';

    const titleRow = document.createElement('div');
    titleRow.className = 'agreement-title-row';

    const film = document.createElement(entry.url ? 'a' : 'span');
    film.className = 'agreement-film';
    film.textContent = entry.title;
    if (entry.url) {
      film.href = entry.url;
      film.target = '_blank';
      film.rel = 'noreferrer';
    }
    titleRow.appendChild(film);

    const side = document.createElement('div');
    side.className = 'agreement-side';

    if (entry.date instanceof Date && !Number.isNaN(entry.date.getTime())) {
      const dateChip = document.createElement('span');
      dateChip.className = 'agreement-date';
      dateChip.textContent = formatDate(entry.date, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
      side.appendChild(dateChip);
    }

    const meta = document.createElement('div');
    meta.className = 'agreement-meta';

    const mineRating = document.createElement('span');
    mineRating.className = `agreement-rating has-tooltip ${getRatingToneClass(entry.mine)}`.trim();
    mineRating.textContent = `Tú ${entry.mine}`;
    mineRating.dataset.tooltip = formatVoteTooltip(selectedUserName, entry.mineRatedAt);
    mineRating.setAttribute('aria-label', mineRating.dataset.tooltip);

    const peerRating = document.createElement('span');
    peerRating.className = `agreement-rating has-tooltip ${getRatingToneClass(entry.theirs)}`.trim();
    peerRating.textContent = `${selectedPeerName} ${entry.theirs}`;
    peerRating.dataset.tooltip = formatVoteTooltip(selectedPeerName, entry.theirsRatedAt);
    peerRating.setAttribute('aria-label', peerRating.dataset.tooltip);

    meta.append(mineRating, peerRating);

    side.appendChild(meta);
    titleRow.appendChild(side);

    main.append(titleRow);
    li.appendChild(main);
    list.appendChild(li);
  });

  wrapper.appendChild(list);
  return wrapper;
}

function createMetricCard(label, value, hint = '') {
  const card = document.createElement('article');
  card.className = 'affinity-kpi-card';

  const labelNode = document.createElement('span');
  labelNode.className = 'affinity-kpi-label';
  labelNode.textContent = label;

  const valueNode = document.createElement('strong');
  valueNode.className = 'affinity-kpi-value';
  valueNode.textContent = value;

  card.append(labelNode, valueNode);

  if (hint) {
    const hintNode = document.createElement('span');
    hintNode.className = 'affinity-kpi-hint';
    hintNode.textContent = hint;
    card.appendChild(hintNode);
  }

  return card;
}

function renderAffinity() {
  elements.content.innerHTML = '';

  if (!selectedPeerName) {
    const empty = document.createElement('p');
    empty.className = 'status-text';
    empty.textContent = 'No hay otro usuario disponible para comparar.';
    elements.content.appendChild(empty);
    setStatus('Agrega al menos dos usuarios en config.json para usar esta vista.');
    return;
  }

  const affinity = buildAffinityData(library, selectedPeerName);
  const tone = getAffinityTone(affinity.agreementScore);
  const card = document.createElement('article');
  card.className = `overlap-card agreement-card affinity-summary-card ${tone}`;

  const user = document.createElement('span');
  user.className = 'overlap-user';
  user.textContent = `👤 ${selectedUserName} vs ${selectedPeerName}`;
  card.appendChild(user);

  const metrics = document.createElement('div');
  metrics.className = 'agreement-metrics';

  const heroMetric = document.createElement('div');
  heroMetric.className = 'affinity-hero-metric';

  const heroValue = document.createElement('strong');
  heroValue.className = 'affinity-hero-value';
  heroValue.textContent =
    affinity.agreementScore === null ? '--' : `${affinity.agreementScore}%`;

  const heroLabel = document.createElement('span');
  heroLabel.className = 'affinity-hero-label';
  heroLabel.textContent =
    affinity.agreementScore === null
      ? 'Sin datos para estimar compatibilidad'
      : `Compatibilidad ${describeCompatibility(affinity.agreementScore)}`;

  heroMetric.append(heroValue, heroLabel);

  const summaryBlock = document.createElement('div');
  summaryBlock.className = 'affinity-summary-block';

  const summary = document.createElement('p');
  summary.className = 'agreement-summary';
  summary.textContent =
    affinity.agreementScore === null
      ? 'Se necesitan más títulos en común para medir afinidad.'
      : `Afinidad ${describeCompatibility(affinity.agreementScore)} entre ambos usuarios.`;
  summaryBlock.appendChild(summary);

  if (affinity.overlapCount < 15) {
    const sampleNote = document.createElement('p');
    sampleNote.className = 'affinity-sample-note is-warning';
    sampleNote.textContent =
      'Muestra pequeña: interpreta la compatibilidad con cautela hasta tener más títulos en común.';
    summaryBlock.appendChild(sampleNote);
  } else {
    const sampleNote = document.createElement('p');
    sampleNote.className = 'affinity-sample-note is-ok';
    sampleNote.textContent =
      `Muestra suficiente para leer la señal: ${describeConfidence(affinity.overlapCount)} confianza.`;
    summaryBlock.appendChild(sampleNote);
  }

  const chips = document.createElement('div');
  chips.className = 'agreement-chips';

  const overlapChip = document.createElement('span');
  overlapChip.className = 'agreement-chip';
  overlapChip.textContent = `🎬 En común: ${affinity.overlapCount}`;

  const gapChip = document.createElement('span');
  gapChip.className = 'agreement-chip';
  gapChip.textContent = `📏 Gap medio: ${affinity.avgGap === null ? '-' : affinity.avgGap.toFixed(2)}`;

  const exactChip = document.createElement('span');
  exactChip.className = 'agreement-chip';
  exactChip.textContent = `✅ Exactas: ${affinity.exactMatches}`;

  const exactRateChip = document.createElement('span');
  exactRateChip.className = 'agreement-chip';
  exactRateChip.textContent = `📌 Exactitud: ${affinity.exactRate ?? '-'}%`;

  const confidenceChip = document.createElement('span');
  confidenceChip.className = 'agreement-chip';
  confidenceChip.textContent = `🧪 Confianza: ${describeConfidence(affinity.overlapCount)}`;

  const biasChip = document.createElement('span');
  biasChip.className = 'agreement-chip';
  if (affinity.bias === null) {
    biasChip.textContent = '↕️ Sesgo: -';
  } else if (affinity.bias > 0.2) {
    biasChip.textContent = `⬆️ Sesgo: usuario activo +${affinity.bias.toFixed(2)}`;
  } else if (affinity.bias < -0.2) {
    biasChip.textContent = `⬇️ Sesgo: ${selectedPeerName} +${Math.abs(affinity.bias).toFixed(2)}`;
  } else {
    biasChip.textContent = '↔️ Sesgo: equilibrado';
  }

  const corrChip = document.createElement('span');
  corrChip.className = 'agreement-chip';
  corrChip.textContent = `📈 Correlación: ${affinity.pearson ?? '-'}`;

  const disagreementChip = document.createElement('span');
  disagreementChip.className = 'agreement-chip';
  disagreementChip.textContent = `⚠️ Desacuerdos fuertes: ${affinity.strongDisagreements}`;

  chips.append(
    overlapChip,
    gapChip,
    exactChip,
    exactRateChip,
    confidenceChip,
    biasChip,
    corrChip,
    disagreementChip
  );
  metrics.append(heroMetric, summaryBlock, chips);
  card.appendChild(metrics);
  elements.content.appendChild(card);

  const kpiGrid = document.createElement('div');
  kpiGrid.className = 'affinity-kpi-grid';
  kpiGrid.append(
    createMetricCard(
      'Títulos en común',
      String(affinity.overlapCount),
      `Confianza ${describeConfidence(affinity.overlapCount)}`
    ),
    createMetricCard(
      'Coincidencias exactas',
      affinity.exactRate === null ? '-' : `${affinity.exactRate}%`,
      `${affinity.exactMatches} títulos`
    ),
    createMetricCard(
      'Correlación',
      affinity.pearson === null ? '-' : String(affinity.pearson),
      'Escala -1 a 1'
    ),
    createMetricCard(
      'Gap medio',
      affinity.avgGap === null ? '-' : affinity.avgGap.toFixed(2),
      'Menor es mejor'
    ),
    createMetricCard(
      'Desacuerdos fuertes',
      String(affinity.strongDisagreements),
      'Diferencia de 4+ puntos'
    )
  );
  elements.content.appendChild(kpiGrid);

  const listsGrid = document.createElement('div');
  listsGrid.className = 'affinity-lists-grid';

  if (affinity.topAgreements.length) {
    listsGrid.appendChild(
      renderAgreementList('💚 Donde mejor encajáis', affinity.topAgreements, { positive: true })
    );
  }
  if (affinity.disagreements.length) {
    listsGrid.appendChild(renderAgreementList('⚡ Donde más discrepáis', affinity.disagreements));
  }

  if (listsGrid.childElementCount > 0) {
    elements.content.appendChild(listsGrid);
  }

  setStatus(
    affinity.overlapCount
      ? `Comparativa activa: ${selectedUserName} vs ${selectedPeerName}.`
      : `No hay títulos compartidos suficientes entre ${selectedUserName} y ${selectedPeerName}.`
  );
}

function populatePeerSelector(preferredPeer = '') {
  const peers = configuredUsers
    .map((user) => user.name)
    .filter((name) => name !== selectedUserName);

  elements.peerSelector.innerHTML = '';

  if (!peers.length) {
    selectedPeerName = '';
    return;
  }

  peers.forEach((peerName) => {
    const option = document.createElement('option');
    option.value = peerName;
    option.textContent = peerName;
    elements.peerSelector.appendChild(option);
  });

  selectedPeerName = peers.includes(preferredPeer) ? preferredPeer : peers[0];
  elements.peerSelector.value = selectedPeerName;
}

async function loadConfig() {
  const queryPeer = new URLSearchParams(window.location.search).get(COMPARE_QUERY_KEY) || '';
  const config = await initializeUserSelector(elements.userSelector);
  configuredUsers = config.users;
  selectedUserName = config.userName;
  if (!selectedUserName) {
    selectedPeerName = '';
    updateQueryString();
    return;
  }
  populatePeerSelector(queryPeer);
  updateQueryString();
}

async function loadLibrary() {
  return runLibraryLoad(async (isCurrent) => {
    libraryLoaded = false;
    library = [];
    elements.content.innerHTML = '';
    elements.content.appendChild(createLoader('Cargando afinidad...'));
    setStatus('Cargando afinidad...');
    if (!selectedUserName) await loadConfig();
    if (!isCurrent()) return;
    if (!selectedUserName) throw new Error('Falta configurar usuarios en config.json.');

    const response = await fetch(`/api/library?userName=${encodeURIComponent(selectedUserName)}`);
    const payload = await response.json();
    if (!isCurrent()) return;
    if (!response.ok) throw new Error(payload.error || 'No se pudo cargar la biblioteca.');
    library = dedupeRecords(payload.ratings || []);
    libraryLoaded = true;

    renderAffinity();
  });
}

elements.userSelector.addEventListener('change', () => {
  selectedUserName = elements.userSelector.value;
  const previousPeer = selectedPeerName;
  populatePeerSelector(previousPeer);
  updateQueryString();
  loadLibrary();
});

elements.peerSelector.addEventListener('change', () => {
  selectedPeerName = elements.peerSelector.value;
  updateQueryString();
  if (libraryLoaded) renderAffinity();
});

const runLibraryLoad = window.siteUtils.createLatestLoader(elements.status, (error) => {
  window.siteUtils.showError(error, elements.status, [elements.content], loadLibrary);
});
loadLibrary();
