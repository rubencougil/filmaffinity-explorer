const {
  parseFlexibleDate, toRating, setPosterSource, initializeUserSelector, updateUserNavigation
} = window.siteUtils;

const elements = {
  subtitle: document.querySelector('#stats-subtitle'),
  userSelector: document.querySelector('#global-user-selector'),
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
  topWorstList: document.querySelector('#top-worst-list')
};

let selectedUserName = '';
let library = [];

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

function createChartDetail({
  id,
  chart,
  label,
  value,
  summary,
  meta = []
}) {
  return { id, chart, label, value, summary, meta };
}

function formatDate(value, options = {}) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat('es-ES', options).format(value);
}

function getYear(date) {
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getFullYear() : null;
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

function createChartTooltip() {
  const node = document.createElement('div');
  node.className = 'chart-tooltip';
  node.hidden = true;

  const label = document.createElement('span');
  label.className = 'chart-tooltip-label';

  const value = document.createElement('strong');
  value.className = 'chart-tooltip-value';

  const summary = document.createElement('p');
  summary.className = 'chart-tooltip-summary';

  const meta = document.createElement('div');
  meta.className = 'chart-tooltip-meta';

  node.append(label, value, summary, meta);

  return {
    node,
    show(detail) {
      label.textContent = detail.chart;
      value.textContent = `${detail.label} · ${detail.value}`;
      summary.textContent = detail.summary;
      meta.innerHTML = '';
      (detail.meta || []).forEach((item) => {
        const chip = document.createElement('span');
        chip.className = 'chart-tooltip-chip';
        chip.textContent = item;
        meta.appendChild(chip);
      });
      node.hidden = false;
    },
    hide() {
      node.hidden = true;
    }
  };
}

function wireChartElement(element, detail, tooltip) {
  if (!detail) {
    return;
  }

  element.classList.add('chart-item');
  element.setAttribute('tabindex', '0');
  element.setAttribute('focusable', 'true');
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', `${detail.chart}: ${detail.label}. Valor ${detail.value}`);
  element.setAttribute('data-detail', `${detail.label} ${detail.value}`);
  element.title = `${detail.label}: ${detail.value}`;

  const activate = () => {
    element.classList.add('is-active');
    tooltip.show(detail);
  };

  const deactivate = () => {
    element.classList.remove('is-active');
    tooltip.hide();
  };

  element.addEventListener('mouseenter', activate);
  element.addEventListener('focus', activate);
  element.addEventListener('mouseleave', deactivate);
  element.addEventListener('blur', deactivate);
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      deactivate();
    }
  });
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
  const chartName = options.chartName || 'Gráfico';
  const tooltip = createChartTooltip();

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'chart-svg');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', chartName);

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
    const detail = createChartDetail({
      id: `${chartName}-${item.label}-${index}`,
      chart: chartName,
      label: item.label,
      value: String(item.value),
      summary: options.describe
        ? options.describe(item, index)
        : `${item.label}: ${item.value}`,
      meta: options.meta ? options.meta(item, index) : []
    });
    const rect = document.createElementNS(svg.namespaceURI, 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', Math.max(10, barWidth * 0.72));
    rect.setAttribute('height', Math.max(2, barHeight));
    rect.setAttribute('rx', 10);
    rect.setAttribute('class', options.barClass || 'chart-bar');
    wireChartElement(rect, detail, tooltip);
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
  target.appendChild(tooltip.node);
}

function renderInsights(records) {
  elements.insightsGrid.innerHTML = '';

  const ratedRecords = records.filter((record) => Number.isFinite(record.rating));
  const datedRecords = records.filter((record) => record.date);
  const maxRating = ratedRecords.length ? Math.max(...ratedRecords.map((record) => record.rating)) : null;
  const minRating = ratedRecords.length ? Math.min(...ratedRecords.map((record) => record.rating)) : null;
  const latestHighest = maxRating === null
    ? null
    : [...ratedRecords].filter((record) => record.rating === maxRating).at(-1) || null;
  const latestLowest = minRating === null
    ? null
    : [...ratedRecords].filter((record) => record.rating === minRating).at(-1) || null;
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
      .map((vote) => toRating(vote.rating))
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
      .map((record) => [
        record.date.getFullYear(),
        String(record.date.getMonth() + 1).padStart(2, '0'),
        String(record.date.getDate()).padStart(2, '0')
      ].join('-'))
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
      label: '🏆 Última nota más alta',
      value: latestHighest
        ? `${latestHighest.rating} · ${latestHighest.title} · ${formatDate(latestHighest.date, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          })}`
        : '-',
      tooltip: 'Última aparición de la nota máxima registrada, con fecha.'
    },
    {
      label: '🫣 Última nota más baja',
      value: latestLowest
        ? `${latestLowest.rating} · ${latestLowest.title} · ${formatDate(latestLowest.date, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          })}`
        : '-',
      tooltip: 'Última aparición de la nota mínima registrada, con fecha.'
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
      setPosterSource(thumb, record.posterUrl, { thumbnail: true });
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
    const toneClass = getRatingToneClass(record.rating);
    if (toneClass) {
      value.classList.add(toneClass);
    }

    item.append(main, value);
    target.appendChild(item);
  });
}

function buildStatistics(records) {
  const datedRecords = records.filter((record) => record.date);
  const average = records.filter((record) => Number.isFinite(record.rating));

  const byYearCount = groupCount(datedRecords, (record) => {
    const year = getYear(record.date);
    return year ? String(year) : '';
  });

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
  const topBest = ranked
    .slice(0, 10)
    .sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0) || a.title.localeCompare(b.title));
  const topWorst = [...ranked]
    .sort((a, b) => a.rating - b.rating || compareRecentFirst(a, b))
    .slice(0, 10)
    .sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0) || a.title.localeCompare(b.title));

  elements.totalVotes.textContent = String(average.length);
  elements.averageRating.textContent = average.length
    ? (average.reduce((sum, record) => sum + record.rating, 0) / average.length).toFixed(1)
    : '-';
  elements.busiestYear.textContent = busiestYear ? `${busiestYear.label} (${busiestYear.value})` : '-';
  elements.sharedCount.textContent = String(records.filter((record) => record.otherVotes.length > 0).length);

  renderBarChart(elements.timelineChart, byYearCount, {
    chartName: 'Actividad por año',
    barClass: 'chart-bar chart-bar-soft',
    describe: (item) => `${item.value} votos en el año ${item.label}.`,
    meta: (item) => [`Año: ${item.label}`, `Votos: ${item.value}`]
  });
  renderBarChart(elements.averageByYearChart, byYearAverage, {
    chartName: 'Nota media por año',
    barClass: 'chart-bar chart-bar-gold',
    describe: (item) => `La media del año ${item.label} fue ${item.value}.`,
    meta: (item) => [`Año: ${item.label}`, `Media: ${item.value}`]
  });
  renderBarChart(elements.ratingDistributionChart, byRating, {
    chartName: 'Distribución de notas',
    describe: (item) => `${item.value} votos con nota ${item.label}.`,
    meta: (item) => [`Nota: ${item.label}`, `Votos: ${item.value}`]
  });
  renderBarChart(elements.sharedByYearChart, sharedByYear, {
    chartName: 'Votos compartidos por año',
    barClass: 'chart-bar chart-bar-soft',
    describe: (item) => `${item.value} títulos compartidos en ${item.label}.`,
    meta: (item) => [`Año: ${item.label}`, `Compartidos: ${item.value}`]
  });
  renderInsights(records);
  renderRankingList(elements.topBestList, topBest, 'Sin suficientes votos para mostrar un top.');
  renderRankingList(elements.topWorstList, topWorst, 'Sin suficientes votos para mostrar un top.');
}

async function loadConfig() {
  const config = await initializeUserSelector(elements.userSelector);
  selectedUserName = config.userName;
}

async function loadLibrary() {
  return runLibraryLoad(async (isCurrent) => {
    const message = selectedUserName ? `Cargando estadísticas de ${selectedUserName}...` : 'Cargando estadísticas...';
    showStatsLoader(message);
    elements.subtitle.textContent = message;
    if (!selectedUserName) await loadConfig();
    if (!isCurrent()) return;
    if (!selectedUserName) throw new Error('Falta configurar usuarios en config.json.');

    const response = await fetch(`/api/library?userName=${encodeURIComponent(selectedUserName)}`);
    const payload = await response.json();
    if (!isCurrent()) return;
    if (!response.ok) throw new Error(payload.error || 'No se pudo cargar la biblioteca.');
    library = dedupeRecords(payload.ratings || []);

    elements.subtitle.textContent = library.length
      ? `Lectura rápida de ${library.length} votos guardados para este usuario.`
      : 'Este usuario todavía no tiene votos guardados para analizar.';

    buildStatistics(library);
  });
}

elements.userSelector.addEventListener('change', () => {
  selectedUserName = elements.userSelector.value;
  updateUserNavigation(selectedUserName);
  loadLibrary();
});

function showStatsError(error) {
  window.siteUtils.showError(error, elements.subtitle, [
    elements.timelineChart, elements.averageByYearChart, elements.ratingDistributionChart,
    elements.sharedByYearChart, elements.insightsGrid, elements.topBestList, elements.topWorstList
  ], loadLibrary);
}

const runLibraryLoad = window.siteUtils.createLatestLoader(elements.subtitle, showStatsError);
loadLibrary();
