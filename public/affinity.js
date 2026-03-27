const SELECTED_USER_KEY = 'filmaffinity-browser-selected-user';
const USER_QUERY_KEY = 'userName';
const COMPARE_QUERY_KEY = 'compareUser';

const elements = {
  title: document.querySelector('#affinity-title'),
  subtitle: document.querySelector('#affinity-subtitle'),
  status: document.querySelector('#affinity-status'),
  userSelector: document.querySelector('#global-user-selector'),
  peerSelector: document.querySelector('#affinity-peer-selector'),
  content: document.querySelector('#affinity-content'),
  navLinks: Array.from(document.querySelectorAll('[data-nav-target]'))
};

let configuredUsers = [];
let selectedUserName = '';
let selectedPeerName = '';
let library = [];

function updateNavLinks() {
  const userParam = selectedUserName ? `?${USER_QUERY_KEY}=${encodeURIComponent(selectedUserName)}` : '';
  const byTarget = {
    home: `/${userParam}`,
    stats: `/stats.html${userParam}`,
    affinity: `/affinity.html${userParam}`,
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
  if (selectedPeerName) {
    url.searchParams.set(COMPARE_QUERY_KEY, selectedPeerName);
  } else {
    url.searchParams.delete(COMPARE_QUERY_KEY);
  }
  window.history.replaceState({}, '', url);
  updateNavLinks();
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
  elements.status.style.color = isError ? '#8a1f11' : '';
}

function normalizeRecord(record) {
  return {
    title: String(record.title || '').trim(),
    rating: Number.isFinite(Number(record.rating)) ? Number(record.rating) : null,
    url: String(record.url || '').trim(),
    posterUrl: String(record.posterUrl || '').trim(),
    otherVotes: Array.isArray(record.otherVotes) ? record.otherVotes : []
  };
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

function buildAffinityData(records, peerName) {
  const items = records.flatMap((record) => {
    if (!Number.isFinite(record.rating)) {
      return [];
    }

    const peerVote = record.otherVotes.find(
      (vote) => vote.userName === peerName && Number.isFinite(Number(vote.rating))
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
        mine: record.rating,
        theirs: peerRating,
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

  const topAgreements = [...items]
    .sort((a, b) => a.diff - b.diff || a.title.localeCompare(b.title))
    .slice(0, 4);
  const disagreements = [...items]
    .sort((a, b) => b.diff - a.diff || a.title.localeCompare(b.title))
    .slice(0, 4);

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

    if (entry.posterUrl) {
      const thumb = document.createElement('img');
      thumb.className = 'agreement-thumb';
      thumb.src = entry.posterUrl;
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

    const film = document.createElement(entry.url ? 'a' : 'span');
    film.className = 'agreement-film';
    film.textContent = entry.title;
    if (entry.url) {
      film.href = entry.url;
      film.target = '_blank';
      film.rel = 'noreferrer';
    }

    const numbers = document.createElement('span');
    numbers.className = `agreement-gap${positive ? ' agreement-gap-good' : ''}`;
    numbers.textContent = `Nota usuario activo ${entry.mine} · Nota ${selectedPeerName} ${entry.theirs} · Diferencia ${entry.diff}`;

    main.append(film, numbers);
    li.appendChild(main);
    list.appendChild(li);
  });

  wrapper.appendChild(list);
  return wrapper;
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
  const card = document.createElement('article');
  card.className = 'overlap-card agreement-card affinity-summary-card';

  const user = document.createElement('span');
  user.className = 'overlap-user';
  user.textContent = `👤 ${selectedUserName} vs ${selectedPeerName}`;
  card.appendChild(user);

  const metrics = document.createElement('div');
  metrics.className = 'agreement-metrics';

  const scoreBadge = document.createElement('span');
  scoreBadge.className = 'agreement-score';
  scoreBadge.textContent =
    affinity.agreementScore === null
      ? '🧩 Sin datos compartidos'
      : `🤝 ${affinity.agreementScore}% de compatibilidad`;

  const summary = document.createElement('span');
  summary.className = 'agreement-summary';
  summary.textContent =
    affinity.agreementScore === null
      ? 'Se necesitan más títulos en común para medir afinidad.'
      : `Afinidad ${describeCompatibility(affinity.agreementScore)} entre ambos usuarios.`;

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
  metrics.append(scoreBadge, summary, chips);
  card.appendChild(metrics);
  elements.content.appendChild(card);

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
  const response = await fetch('/api/config');
  const payload = await response.json();
  configuredUsers = Array.isArray(payload?.filmaffinity?.users) ? payload.filmaffinity.users : [];
  const queryUser = new URLSearchParams(window.location.search).get(USER_QUERY_KEY) || '';
  const queryPeer = new URLSearchParams(window.location.search).get(COMPARE_QUERY_KEY) || '';
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

  if (!selected) {
    selectedUserName = '';
    selectedPeerName = '';
    updateQueryString();
    return;
  }

  selectedUserName = selected.name;
  elements.userSelector.value = selected.name;
  localStorage.setItem(SELECTED_USER_KEY, selected.name);
  populatePeerSelector(queryPeer);
  updateQueryString();
}

async function loadLibrary() {
  if (!selectedUserName) {
    return;
  }

  elements.content.innerHTML = '';
  elements.content.appendChild(createLoader(`Cargando afinidad de ${selectedUserName}...`));
  setStatus(`Cargando afinidad para ${selectedUserName}...`);

  const response = await fetch(`/api/library?userName=${encodeURIComponent(selectedUserName)}`);
  const payload = await response.json();
  library = dedupeRecords(payload.ratings || []);

  elements.title.textContent = `🤝 Afinidad de ${selectedUserName}`;
  elements.subtitle.textContent = selectedPeerName
    ? `Comparativa directa de ${selectedUserName} con ${selectedPeerName}.`
    : 'Selecciona otro usuario para comparar afinidad.';

  renderAffinity();
}

elements.userSelector.addEventListener('change', async () => {
  selectedUserName = elements.userSelector.value;
  localStorage.setItem(SELECTED_USER_KEY, selectedUserName);
  const previousPeer = selectedPeerName;
  populatePeerSelector(previousPeer);
  updateQueryString();
  await loadLibrary();
});

elements.peerSelector.addEventListener('change', () => {
  selectedPeerName = elements.peerSelector.value;
  elements.subtitle.textContent = selectedPeerName
    ? `Comparativa directa de ${selectedUserName} con ${selectedPeerName}.`
    : 'Selecciona otro usuario para comparar afinidad.';
  updateQueryString();
  renderAffinity();
});

async function boot() {
  await loadConfig();
  if (!selectedUserName) {
    setStatus('Falta configurar usuarios en config.json.', true);
    return;
  }
  await loadLibrary();
}

boot().catch((error) => {
  setStatus(error.message || 'Error cargando la página de afinidad.', true);
});
