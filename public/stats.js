const SELECTED_USER_KEY = 'filmaffinity-browser-selected-user';
const USER_QUERY_KEY = 'userName';
const TAB_QUERY_KEY = 'tab';
const DEFAULT_TAB = 'resumen';

const elements = {
  title: document.querySelector('#stats-title'),
  subtitle: document.querySelector('#stats-subtitle'),
  userSelector: document.querySelector('#global-user-selector'),
  navLinks: Array.from(document.querySelectorAll('[data-nav-target]')),
  tabButtons: Array.from(document.querySelectorAll('[data-stats-tab]')),
  tabPanels: {
    resumen: document.querySelector('#stats-tabpanel-resumen'),
    afinidad: document.querySelector('#stats-tabpanel-afinidad')
  },
  totalVotes: document.querySelector('#stats-total-votes'),
  averageRating: document.querySelector('#stats-average-rating'),
  busiestYear: document.querySelector('#stats-busiest-year'),
  sharedCount: document.querySelector('#stats-shared-count'),
  timelineChart: document.querySelector('#timeline-chart'),
  averageByYearChart: document.querySelector('#average-by-year-chart'),
  ratingDistributionChart: document.querySelector('#rating-distribution-chart'),
  sharedByYearChart: document.querySelector('#shared-by-year-chart'),
  insightsGrid: document.querySelector('#insights-grid'),
  topBestList: document.querySelector('#top-best-list'),
  topWorstList: document.querySelector('#top-worst-list'),
  overlapGrid: document.querySelector('#overlap-grid')
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

let configuredUsers = [];
let selectedUserName = '';
let library = [];
let activeTab = DEFAULT_TAB;

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

function normalizeTab(value) {
  const tab = String(value || '').trim().toLowerCase();
  return tab === 'afinidad' ? 'afinidad' : DEFAULT_TAB;
}

function setActiveTab(tab, { updateUrl = true } = {}) {
  activeTab = normalizeTab(tab);

  elements.tabButtons.forEach((button) => {
    const isActive = button.dataset.statsTab === activeTab;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });

  Object.entries(elements.tabPanels).forEach(([key, panel]) => {
    if (!panel) {
      return;
    }
    panel.hidden = key !== activeTab;
  });

  if (updateUrl) {
    updateQueryString();
  }
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

function showStatsLoader(message = 'Cargando estadísticas...') {
  elements.totalVotes.textContent = '-';
  elements.averageRating.textContent = '-';
  elements.busiestYear.textContent = '-';
  elements.sharedCount.textContent = '-';

  [
    elements.timelineChart,
    elements.averageByYearChart,
    elements.ratingDistributionChart,
    elements.sharedByYearChart
  ].forEach((target) => {
    target.innerHTML = '';
    target.appendChild(createLoader(message));
  });

  elements.insightsGrid.innerHTML = '';
  elements.insightsGrid.appendChild(createLoader(message));
  elements.topBestList.innerHTML = '';
  elements.topBestList.appendChild(createLoader(message));
  elements.topWorstList.innerHTML = '';
  elements.topWorstList.appendChild(createLoader(message));
  elements.overlapGrid.innerHTML = '';
  elements.overlapGrid.appendChild(createLoader(message));
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

function formatDate(value, options = {}) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat('es-ES', options).format(value);
}

function formatMonthKey(key) {
  const [year, month] = String(key).split('-').map(Number);
  return formatDate(new Date(year, (month || 1) - 1, 1), {
    year: 'numeric',
    month: 'short'
  });
}

function getYear(date) {
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getFullYear() : null;
}

function normalizeRecord(record) {
  return {
    title: String(record.title || '').trim(),
    rating: Number.isFinite(Number(record.rating)) ? Number(record.rating) : null,
    ratedAt: String(record.ratedAt || '').trim(),
    date: parseFlexibleDate(record.ratedAt),
    url: String(record.url || '').trim(),
    posterUrl: String(record.posterUrl || '').trim(),
    otherVotes: Array.isArray(record.otherVotes) ? record.otherVotes : []
  };
}

function dedupeRecords(records) {
  const seen = new Set();
  const normalized = [];

  for (const rawRecord of records) {
    const record = normalizeRecord(rawRecord);
    if (!record.title) {
      continue;
    }

    const key = `${record.title}|${record.rating || ''}|${record.ratedAt || ''}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(record);
  }

  return normalized.sort((a, b) => {
    const aTime = a.date ? a.date.getTime() : 0;
    const bTime = b.date ? b.date.getTime() : 0;
    return aTime - bTime;
  });
}

function groupCount(records, keyFn) {
  const counts = new Map();

  for (const record of records) {
    const key = keyFn(record);
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([label, value]) => ({ label: String(label), value }));
}

function groupAverage(records, keyFn) {
  const groups = new Map();

  for (const record of records) {
    const key = keyFn(record);
    if (!key || !Number.isFinite(record.rating)) {
      continue;
    }

    const current = groups.get(key) || { sum: 0, count: 0 };
    current.sum += record.rating;
    current.count += 1;
    groups.set(key, current);
  }

  return [...groups.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([label, stats]) => ({
      label: String(label),
      value: stats.count ? Number((stats.sum / stats.count).toFixed(2)) : 0
    }));
}

function createChartShell(title) {
  const empty = document.createElement('div');
  empty.className = 'chart-empty';
  empty.textContent = title;
  return empty;
}

function renderBarChart(target, dataset, options = {}) {
  target.innerHTML = '';

  if (!dataset.length) {
    target.appendChild(createChartShell('Todavía no hay suficientes datos para esta gráfica.'));
    return;
  }

  const width = options.width || 760;
  const height = options.height || 260;
  const padding = { top: 18, right: 18, bottom: 44, left: 42 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...dataset.map((item) => item.value), 1);
  const barWidth = innerWidth / dataset.length;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'chart-svg');

  const axis = document.createElementNS(svg.namespaceURI, 'line');
  axis.setAttribute('x1', padding.left);
  axis.setAttribute('y1', height - padding.bottom);
  axis.setAttribute('x2', width - padding.right);
  axis.setAttribute('y2', height - padding.bottom);
  axis.setAttribute('class', 'chart-axis');
  svg.appendChild(axis);

  dataset.forEach((item, index) => {
    const barHeight = (item.value / maxValue) * innerHeight;
    const x = padding.left + index * barWidth + barWidth * 0.14;
    const y = height - padding.bottom - barHeight;
    const rect = document.createElementNS(svg.namespaceURI, 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', Math.max(10, barWidth * 0.72));
    rect.setAttribute('height', Math.max(2, barHeight));
    rect.setAttribute('rx', 10);
    rect.setAttribute('class', options.barClass || 'chart-bar');
    svg.appendChild(rect);

    const valueLabel = document.createElementNS(svg.namespaceURI, 'text');
    valueLabel.setAttribute('x', x + Math.max(10, barWidth * 0.72) / 2);
    valueLabel.setAttribute('y', y - 6);
    valueLabel.setAttribute('text-anchor', 'middle');
    valueLabel.setAttribute('class', 'chart-value');
    valueLabel.textContent = String(item.value);
    svg.appendChild(valueLabel);

    const tick = document.createElementNS(svg.namespaceURI, 'text');
    tick.setAttribute('x', x + Math.max(10, barWidth * 0.72) / 2);
    tick.setAttribute('y', height - padding.bottom + 18);
    tick.setAttribute('text-anchor', 'middle');
    tick.setAttribute('class', 'chart-tick');
    tick.textContent = item.label;
    svg.appendChild(tick);
  });

  target.appendChild(svg);
}

function renderLineChart(target, dataset) {
  target.innerHTML = '';

  if (!dataset.length) {
    target.appendChild(createChartShell('Todavía no hay suficientes datos para esta gráfica.'));
    return;
  }

  const width = 760;
  const height = 260;
  const padding = { top: 18, right: 18, bottom: 44, left: 42 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...dataset.map((item) => item.value), 1);
  const stepX = dataset.length > 1 ? innerWidth / (dataset.length - 1) : innerWidth / 2;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'chart-svg');

  const axis = document.createElementNS(svg.namespaceURI, 'line');
  axis.setAttribute('x1', padding.left);
  axis.setAttribute('y1', height - padding.bottom);
  axis.setAttribute('x2', width - padding.right);
  axis.setAttribute('y2', height - padding.bottom);
  axis.setAttribute('class', 'chart-axis');
  svg.appendChild(axis);

  const points = dataset.map((item, index) => {
    const x = padding.left + index * stepX;
    const y = height - padding.bottom - (item.value / maxValue) * innerHeight;
    return { ...item, x, y };
  });

  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute(
    'd',
    points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  );
  path.setAttribute('class', 'chart-line');
  svg.appendChild(path);

  points.forEach((point, index) => {
    const dot = document.createElementNS(svg.namespaceURI, 'circle');
    dot.setAttribute('cx', point.x);
    dot.setAttribute('cy', point.y);
    dot.setAttribute('r', 4.5);
    dot.setAttribute('class', 'chart-dot');
    svg.appendChild(dot);

    if (index % Math.ceil(points.length / 8 || 1) === 0 || index === points.length - 1) {
      const tick = document.createElementNS(svg.namespaceURI, 'text');
      tick.setAttribute('x', point.x);
      tick.setAttribute('y', height - padding.bottom + 18);
      tick.setAttribute('text-anchor', 'middle');
      tick.setAttribute('class', 'chart-tick');
      tick.textContent = point.label;
      svg.appendChild(tick);
    }
  });

  target.appendChild(svg);
}

function renderInsights(records) {
  elements.insightsGrid.innerHTML = '';

  const ratedRecords = records.filter((record) => Number.isFinite(record.rating));
  const datedRecords = records.filter((record) => record.date);
  const highest = [...ratedRecords]
    .sort((a, b) => b.rating - a.rating || a.title.localeCompare(b.title))[0];
  const lowest = [...ratedRecords]
    .sort((a, b) => a.rating - b.rating || a.title.localeCompare(b.title))[0];
  const shared = records.filter((record) => record.otherVotes.length > 0).length;
  const mostRecent = datedRecords.at(-1);
  const highRatings = ratedRecords.filter((record) => record.rating >= 8).length;
  const lowRatings = ratedRecords.filter((record) => record.rating <= 4).length;

  const distribution = new Map();
  ratedRecords.forEach((record) => {
    distribution.set(record.rating, (distribution.get(record.rating) || 0) + 1);
  });
  const mode = [...distribution.entries()]
    .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0];

  const average = ratedRecords.length
    ? ratedRecords.reduce((sum, record) => sum + record.rating, 0) / ratedRecords.length
    : null;
  const variance = ratedRecords.length
    ? ratedRecords.reduce((sum, record) => sum + (record.rating - average) ** 2, 0) / ratedRecords.length
    : null;
  const stdDev = Number.isFinite(variance) ? Math.sqrt(variance) : null;

  const sharedPairs = records.flatMap((record) => {
    if (!Number.isFinite(record.rating)) {
      return [];
    }
    return (record.otherVotes || [])
      .map((vote) => Number(vote.rating))
      .filter((rating) => Number.isFinite(rating))
      .map((rating) => Math.abs(record.rating - rating));
  });
  const sharedAgreement = sharedPairs.length
    ? Math.round(
        (sharedPairs.reduce((sum, diff) => sum + (1 - diff / 9), 0) / sharedPairs.length) * 100
      )
    : null;

  const uniqueDays = [...new Set(
    datedRecords
      .map((record) => record.date.toISOString().slice(0, 10))
      .sort()
  )];
  let longestStreak = 0;
  let currentStreak = 0;
  let previousDay = null;
  uniqueDays.forEach((day) => {
    const date = new Date(`${day}T00:00:00`);
    if (!previousDay) {
      currentStreak = 1;
    } else {
      const diffDays = Math.round((date.getTime() - previousDay.getTime()) / 86_400_000);
      currentStreak = diffDays === 1 ? currentStreak + 1 : 1;
    }
    previousDay = date;
    longestStreak = Math.max(longestStreak, currentStreak);
  });

  const items = [
    {
      label: '🏆 Nota más alta',
      value: highest ? `${highest.rating} · ${highest.title}` : '-',
      tooltip: 'Mayor nota individual registrada para el usuario y título asociado.'
    },
    {
      label: '🫣 Nota más baja',
      value: lowest ? `${lowest.rating} · ${lowest.title}` : '-',
      tooltip: 'Menor nota individual registrada para el usuario y título asociado.'
    },
    {
      label: '🤝 Porcentaje compartido',
      value: records.length ? `${Math.round((shared / records.length) * 100)}%` : '-',
      tooltip: 'Porcentaje de títulos del usuario que también fueron votados por otros usuarios configurados.'
    },
    {
      label: '🕒 Último voto registrado',
      value: mostRecent ? formatDate(mostRecent.date, { year: 'numeric', month: 'short', day: 'numeric' }) : '-',
      tooltip: 'Fecha más reciente con voto detectado para el usuario seleccionado.'
    },
    {
      label: '💎 Notas altas (8-10)',
      value: ratedRecords.length ? `${Math.round((highRatings / ratedRecords.length) * 100)}%` : '-',
      tooltip: 'Proporción de votos con nota alta (8, 9 o 10).'
    },
    {
      label: '🌧️ Notas bajas (1-4)',
      value: ratedRecords.length ? `${Math.round((lowRatings / ratedRecords.length) * 100)}%` : '-',
      tooltip: 'Proporción de votos con nota baja (1 a 4).'
    },
    {
      label: '🎯 Nota más usada',
      value: mode ? `${mode[0]} (${mode[1]} veces)` : '-',
      tooltip: 'Nota que más se repite en el historial del usuario.'
    },
    {
      label: '📏 Consistencia (σ)',
      value: Number.isFinite(stdDev) ? stdDev.toFixed(2) : '-',
      tooltip: 'Desviación estándar de las notas. Más bajo = criterio más consistente.'
    },
    {
      label: '🔥 Racha más larga',
      value: longestStreak ? `${longestStreak} día${longestStreak === 1 ? '' : 's'} seguidos` : '-',
      tooltip: 'Mayor secuencia de días consecutivos con al menos un voto.'
    },
    {
      label: '🤝 Acuerdo global',
      value: Number.isFinite(sharedAgreement) ? `${sharedAgreement}%` : '-',
      tooltip: 'Nivel agregado de cercanía entre notas del usuario activo y notas de otros usuarios en títulos compartidos.'
    }
  ];

  items.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'insight-card';

    const label = document.createElement('span');
    label.className = 'insight-label has-tooltip';
    label.textContent = item.label;
    label.dataset.tooltip = item.tooltip;

    const value = document.createElement('strong');
    value.className = 'insight-value';
    value.textContent = item.value;

    card.append(label, value);
    elements.insightsGrid.appendChild(card);
  });
}

function renderRankingList(target, records, emptyText) {
  target.innerHTML = '';

  if (!records.length) {
    const item = document.createElement('li');
    item.className = 'ranking-item ranking-item-empty';
    item.textContent = emptyText;
    target.appendChild(item);
    return;
  }

  records.forEach((record) => {
    const item = document.createElement('li');
    item.className = 'ranking-item';

    const main = document.createElement('div');
    main.className = 'ranking-main';

    if (record.posterUrl) {
      const thumb = document.createElement('img');
      thumb.className = 'ranking-thumb';
      thumb.src = record.posterUrl;
      thumb.alt = `Portada de ${record.title}`;
      thumb.loading = 'lazy';
      main.appendChild(thumb);
    } else {
      const thumbFallback = document.createElement('span');
      thumbFallback.className = 'ranking-thumb-fallback';
      thumbFallback.textContent = '🎬';
      main.appendChild(thumbFallback);
    }

    const title = document.createElement(record.url ? 'a' : 'span');
    title.className = 'ranking-title';
    title.textContent = record.title;
    if (record.url) {
      title.href = record.url;
      title.target = '_blank';
      title.rel = 'noreferrer';
    }
    main.appendChild(title);

    const value = document.createElement('span');
    value.className = 'ranking-score';
    value.textContent = String(record.rating ?? '-');

    item.append(main, value);
    target.appendChild(item);
  });
}

function renderOverlapGrid(records) {
  elements.overlapGrid.innerHTML = '';
  const peers = configuredUsers
    .filter((user) => user.name !== selectedUserName)
    .map((user) => user.name);

  if (!peers.length) {
    const empty = document.createElement('p');
    empty.className = 'status-text';
    empty.textContent = 'No hay otros usuarios configurados para comparar.';
    elements.overlapGrid.appendChild(empty);
    return;
  }

  const analyticsByUser = new Map(peers.map((name) => [name, []]));

  records.forEach((record) => {
    const currentRating = Number(record.rating);
    if (!Number.isFinite(currentRating)) {
      return;
    }

    record.otherVotes.forEach((vote) => {
      const peerRating = Number(vote.rating);
      if (!Number.isFinite(peerRating) || !analyticsByUser.has(vote.userName)) {
        return;
      }

      analyticsByUser.get(vote.userName).push({
        title: record.title,
        url: record.url,
        posterUrl: record.posterUrl,
        mine: currentRating,
        theirs: peerRating,
        diff: Math.abs(currentRating - peerRating)
      });
    });
  });

  const ranking = peers
    .map((name) => {
      const items = analyticsByUser.get(name) || [];
      const overlapCount = items.length;
      const totalGap = items.reduce((sum, item) => sum + item.diff, 0);
      const avgGap = overlapCount ? totalGap / overlapCount : null;
      const bias = overlapCount
        ? items.reduce((sum, item) => sum + (item.mine - item.theirs), 0) / overlapCount
        : null;
      const exactMatches = items.filter((item) => item.diff === 0).length;
      const exactRate = overlapCount ? Math.round((exactMatches / overlapCount) * 100) : null;
      const agreementScore = overlapCount
        ? Math.round(
            (items.reduce((sum, item) => sum + (1 - item.diff / 9), 0) / overlapCount) * 100
          )
        : null;
      const strongDisagreements = items.filter((item) => item.diff >= 4).length;
      const disagreements = [...items]
        .sort((a, b) => b.diff - a.diff || a.title.localeCompare(b.title))
        .slice(0, 4);
      const topAgreements = [...items]
        .sort((a, b) => a.diff - b.diff || a.title.localeCompare(b.title))
        .slice(0, 3);

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

      return {
        name,
        overlapCount,
        avgGap,
        bias,
        exactMatches,
        exactRate,
        agreementScore,
        pearson,
        strongDisagreements,
        topAgreements,
        disagreements
      };
    })
    .sort((a, b) => {
      const scoreA = a.agreementScore ?? -1;
      const scoreB = b.agreementScore ?? -1;
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }
      if (b.overlapCount !== a.overlapCount) {
        return b.overlapCount - a.overlapCount;
      }
      return a.name.localeCompare(b.name);
    });

  function describeCompatibility(score) {
    if (!Number.isFinite(score)) {
      return 'Sin base de comparacion';
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

  ranking.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'overlap-card agreement-card';

    const user = document.createElement('span');
    user.className = 'overlap-user';
    user.textContent = `👤 ${item.name}`;

    const metrics = document.createElement('div');
    metrics.className = 'agreement-metrics';

    const scoreBadge = document.createElement('span');
    scoreBadge.className = 'agreement-score has-tooltip';
    scoreBadge.textContent =
      item.agreementScore === null
        ? '🧩 Sin datos compartidos'
        : `🤝 ${item.agreementScore}% de compatibilidad`;
    scoreBadge.dataset.tooltip =
      'Afinidad normalizada entre 0% y 100% según la distancia media entre notas en títulos compartidos.';

    const summary = document.createElement('span');
    summary.className = 'agreement-summary';
    summary.textContent =
      item.agreementScore === null
        ? 'Se necesitan mas titulos en comun para medir afinidad.'
        : `Afinidad ${describeCompatibility(item.agreementScore)} entre las notas de ambos usuarios.`;

    const chips = document.createElement('div');
    chips.className = 'agreement-chips';

    const overlapChip = document.createElement('span');
    overlapChip.className = 'agreement-chip has-tooltip';
    overlapChip.textContent = `🎬 En comun: ${item.overlapCount}`;
    overlapChip.dataset.tooltip =
      'Número de títulos donde ambos usuarios tienen voto y se puede comparar.';

    const gapChip = document.createElement('span');
    gapChip.className = 'agreement-chip has-tooltip';
    gapChip.textContent = `📏 Gap medio: ${
      item.avgGap === null ? '-' : item.avgGap.toFixed(2)
    }`;
    gapChip.dataset.tooltip =
      'Diferencia absoluta media entre ambas notas. Más bajo = mayor cercanía.';

    const exactChip = document.createElement('span');
    exactChip.className = 'agreement-chip has-tooltip';
    exactChip.textContent = `✅ Exactas: ${item.exactMatches}`;
    exactChip.dataset.tooltip = 'Cantidad de títulos donde ambos usuarios pusieron exactamente la misma nota.';

    const exactRateChip = document.createElement('span');
    exactRateChip.className = 'agreement-chip has-tooltip';
    exactRateChip.textContent = `📌 Exactitud: ${item.exactRate ?? '-'}%`;
    exactRateChip.dataset.tooltip = 'Porcentaje de coincidencias exactas sobre el total de títulos compartidos.';

    const confidenceChip = document.createElement('span');
    confidenceChip.className = 'agreement-chip has-tooltip';
    confidenceChip.textContent = `🧪 Confianza: ${describeConfidence(item.overlapCount)}`;
    confidenceChip.dataset.tooltip = 'Nivel orientativo basado en tamaño de muestra: más títulos compartidos = más confianza.';

    const biasChip = document.createElement('span');
    biasChip.className = 'agreement-chip has-tooltip';
    if (item.bias === null) {
      biasChip.textContent = '↕️ Sesgo: -';
    } else if (item.bias > 0.2) {
      biasChip.textContent = `⬆️ Sesgo: usuario activo +${item.bias.toFixed(2)}`;
    } else if (item.bias < -0.2) {
      biasChip.textContent = `⬇️ Sesgo: ${item.name} +${Math.abs(item.bias).toFixed(2)}`;
    } else {
      biasChip.textContent = '↔️ Sesgo: equilibrado';
    }
    biasChip.dataset.tooltip =
      'Diferencia media firmada: indica qué usuario suele puntuar más alto en los mismos títulos.';

    const corrChip = document.createElement('span');
    corrChip.className = 'agreement-chip has-tooltip';
    corrChip.textContent = `📈 Correlación: ${item.pearson ?? '-'}`;
    corrChip.dataset.tooltip =
      'Correlación de Pearson entre ambas series de notas. 1 = patrón muy parecido, 0 = sin relación, -1 = patrón inverso.';

    const disagreementChip = document.createElement('span');
    disagreementChip.className = 'agreement-chip has-tooltip';
    disagreementChip.textContent = `⚠️ Desacuerdos fuertes: ${item.strongDisagreements}`;
    disagreementChip.dataset.tooltip =
      'Cantidad de títulos con diferencia de 4 puntos o más entre ambos usuarios.';

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
    card.append(user, metrics);

    if (item.topAgreements.length) {
      const agreementTitle = document.createElement('p');
      agreementTitle.className = 'agreement-list-title agreement-list-title-good';
      agreementTitle.textContent = '💚 Donde mejor encajais';
      card.appendChild(agreementTitle);

      const bestList = document.createElement('ol');
      bestList.className = 'agreement-list agreement-list-good';

      item.topAgreements.forEach((entry) => {
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
        numbers.className = 'agreement-gap agreement-gap-good';
        numbers.textContent = `Nota usuario activo ${entry.mine} · Nota ${item.name} ${entry.theirs} · Diferencia ${entry.diff}`;

        main.append(film, numbers);
        li.appendChild(main);
        bestList.appendChild(li);
      });

      card.appendChild(bestList);
    }

    if (item.disagreements.length) {
      const disagreementTitle = document.createElement('p');
      disagreementTitle.className = 'agreement-list-title';
      disagreementTitle.textContent = '⚡ Donde mas discrepais';
      card.appendChild(disagreementTitle);

      const list = document.createElement('ol');
      list.className = 'agreement-list';

      item.disagreements.forEach((entry) => {
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
        numbers.className = 'agreement-gap';
        numbers.textContent = `Nota usuario activo ${entry.mine} · Nota ${item.name} ${entry.theirs} · Diferencia ${entry.diff}`;

        main.append(film, numbers);
        li.appendChild(main);
        list.appendChild(li);
      });

      card.appendChild(list);
    }

    elements.overlapGrid.appendChild(card);
  });
}

function buildStatistics(records) {
  const datedRecords = records.filter((record) => record.date);
  const average = records.filter((record) => Number.isFinite(record.rating));

  const byMonth = groupCount(datedRecords, (record) => {
    const year = record.date.getFullYear();
    const month = String(record.date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }).map((item) => ({
    label: formatMonthKey(item.label),
    value: item.value
  }));

  const byYearAverage = groupAverage(datedRecords, (record) => {
    const year = getYear(record.date);
    return year ? String(year) : '';
  });

  const byRating = Array.from({ length: 10 }, (_, index) => {
    const rating = index + 1;
    return {
      label: String(rating),
      value: records.filter((record) => record.rating === rating).length
    };
  });

  const sharedByYear = groupCount(
    datedRecords.filter((record) => record.otherVotes.length > 0),
    (record) => {
      const year = getYear(record.date);
      return year ? String(year) : '';
    }
  );

  const busiestYear = groupCount(datedRecords, (record) => {
    const year = getYear(record.date);
    return year ? String(year) : '';
  }).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))[0];

  const compareRecentFirst = (a, b) => {
    const aTime = a.date ? a.date.getTime() : 0;
    const bTime = b.date ? b.date.getTime() : 0;
    return bTime - aTime || a.title.localeCompare(b.title);
  };

  const ranked = records
    .filter((record) => Number.isFinite(record.rating))
    .sort((a, b) => b.rating - a.rating || compareRecentFirst(a, b));
  const topBest = ranked.slice(0, 10);
  const topWorst = [...ranked]
    .sort((a, b) => a.rating - b.rating || compareRecentFirst(a, b))
    .slice(0, 10);

  elements.totalVotes.textContent = String(records.length);
  elements.averageRating.textContent = average.length
    ? (average.reduce((sum, record) => sum + record.rating, 0) / average.length).toFixed(1)
    : '-';
  elements.busiestYear.textContent = busiestYear ? `${busiestYear.label} (${busiestYear.value})` : '-';
  elements.sharedCount.textContent = String(records.filter((record) => record.otherVotes.length > 0).length);

  renderLineChart(elements.timelineChart, byMonth.slice(-18));
  renderBarChart(elements.averageByYearChart, byYearAverage, { barClass: 'chart-bar chart-bar-gold' });
  renderBarChart(elements.ratingDistributionChart, byRating);
  renderBarChart(elements.sharedByYearChart, sharedByYear, { barClass: 'chart-bar chart-bar-soft' });
  renderInsights(records);
  renderRankingList(elements.topBestList, topBest, 'Sin suficientes votos para mostrar un top.');
  renderRankingList(elements.topWorstList, topWorst, 'Sin suficientes votos para mostrar un top.');
  renderOverlapGrid(records);
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
  }
}

async function loadLibrary() {
  if (!selectedUserName) {
    return;
  }

  showStatsLoader(`Cargando estadísticas de ${selectedUserName}...`);
  const response = await fetch(`/api/library?userName=${encodeURIComponent(selectedUserName)}`);
  const payload = await response.json();
  library = dedupeRecords(payload.ratings || []);

  elements.title.textContent = `📊 Estadísticas de ${selectedUserName}`;
  elements.subtitle.textContent = library.length
    ? `Lectura rápida de ${library.length} votos guardados para este usuario.`
    : 'Este usuario todavía no tiene votos guardados para analizar.';

  buildStatistics(library);
}

function updateQueryString() {
  const url = new URL(window.location.href);
  if (selectedUserName) {
    url.searchParams.set(USER_QUERY_KEY, selectedUserName);
  } else {
    url.searchParams.delete(USER_QUERY_KEY);
  }
  if (activeTab === DEFAULT_TAB) {
    url.searchParams.delete(TAB_QUERY_KEY);
  } else {
    url.searchParams.set(TAB_QUERY_KEY, activeTab);
  }
  window.history.replaceState({}, '', url);
  updateNavLinks();
}

elements.tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setActiveTab(button.dataset.statsTab || DEFAULT_TAB);
  });
});

elements.userSelector.addEventListener('change', async () => {
  selectedUserName = elements.userSelector.value;
  localStorage.setItem(SELECTED_USER_KEY, selectedUserName);
  updateQueryString();
  await loadLibrary();
});

async function boot() {
  const queryTab = new URLSearchParams(window.location.search).get(TAB_QUERY_KEY) || DEFAULT_TAB;
  setActiveTab(queryTab, { updateUrl: false });
  await loadConfig();
  updateQueryString();
  showStatsLoader('Cargando estadísticas...');
  await loadLibrary();
}

boot();
