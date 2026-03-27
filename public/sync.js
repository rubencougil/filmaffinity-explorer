const SELECTED_USER_KEY = 'filmaffinity-browser-selected-user';
const USER_QUERY_KEY = 'userName';

const elements = {
  userSelector: document.querySelector('#global-user-selector'),
  navLinks: Array.from(document.querySelectorAll('[data-nav-target]')),
  syncButton: document.querySelector('#sync-button'),
  syncStatePill: document.querySelector('#sync-state-pill'),
  syncProgressBar: document.querySelector('#sync-progress-bar'),
  syncProgressText: document.querySelector('#sync-progress-text'),
  syncProgressPercent: document.querySelector('#sync-progress-percent'),
  syncLog: document.querySelector('#sync-log'),
  configSummary: document.querySelector('#config-summary'),
  importStatus: document.querySelector('#import-status'),
  accessStatus: document.querySelector('#access-status')
};

let selectedUserName = '';
let activeJobId = null;
let configuredUsers = [];

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
  elements.importStatus.textContent = message;
  elements.importStatus.style.color = isError ? '#8a1f11' : '';
}

function setAccessStatus(message = '', tone = '') {
  elements.accessStatus.textContent = message;
  elements.accessStatus.className = `status-text access-status${tone ? ` access-status-${tone}` : ''}`;
}

function setSyncButtonState(isRunning) {
  elements.syncButton.disabled = isRunning;
  elements.syncButton.textContent = isRunning ? 'Sincronizando...' : 'Sincronizar ahora';
}

function updateProgress(status, entries = []) {
  const lastMessage = entries.at(-1)?.message || '';
  const pageMatch = lastMessage.match(/Reading ratings page (\d+)/i);
  let percent = 0;
  let label = 'Preparando';
  let text = 'Esperando datos...';

  if (status === 'running') {
    const pageNumber = pageMatch ? Number(pageMatch[1]) : 0;
    percent = pageNumber ? Math.min(92, 10 + pageNumber * 4) : 8;
    label = 'En marcha';
    text = pageNumber
      ? `Leyendo la pagina ${pageNumber} de votaciones`
      : 'Preparando la biblioteca del usuario';
  } else if (status === 'completed') {
    percent = 100;
    label = 'Al dia';
    text = 'Biblioteca actualizada';
  } else if (status === 'failed') {
    percent = 100;
    label = 'Error';
    text = 'No se pudo actualizar la biblioteca';
  }

  elements.syncStatePill.textContent = label;
  elements.syncProgressText.textContent = text;
  elements.syncProgressPercent.textContent = `${Math.round(percent)}%`;
  elements.syncProgressBar.style.width = `${percent}%`;
  elements.syncProgressBar.classList.toggle('is-active', status === 'running');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderLog(entries) {
  if (!entries.length) {
    elements.syncLog.innerHTML = '';
    return;
  }

  const html = entries
    .slice(-12)
    .map((entry) => {
      const isWarning = /aviso:/i.test(entry.message);
      const classes = isWarning ? 'log-line log-line-warning' : 'log-line';
      return `<div class="${classes}">${escapeHtml(entry.message)}</div>`;
    })
    .join('');

  elements.syncLog.innerHTML = html;
}

async function checkAccessForSelectedUser() {
  if (!selectedUserName) {
    return;
  }

  setAccessStatus('Comprobando acceso a Filmaffinity...', 'neutral');

  try {
    const response = await fetch(`/api/access-check?userName=${encodeURIComponent(selectedUserName)}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'No se pudo comprobar el acceso a Filmaffinity.');
    }

    if (payload.status === 'available') {
      setAccessStatus(`Acceso OK: ${payload.message}`, 'ok');
    } else if (payload.status === 'blocked') {
      setAccessStatus(`Bloqueado: ${payload.message}`, 'warning');
    } else {
      setAccessStatus(payload.message, 'neutral');
    }
  } catch (error) {
    setAccessStatus(error.message || 'No se pudo comprobar el acceso a Filmaffinity.', 'warning');
  }
}

async function loadSyncStateForSelectedUser() {
  if (!selectedUserName) {
    return;
  }

  const response = await fetch(`/api/library?userName=${encodeURIComponent(selectedUserName)}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'No se pudo cargar el estado de sincronizacion.');
  }

  renderLog(payload.job?.log || []);
  updateProgress(payload.status, payload.job?.log || []);

  if (payload.status === 'running') {
    activeJobId = payload.job?.id || null;
    setSyncButtonState(true);
    setStatus(`Actualizando la biblioteca de ${selectedUserName}...`);
  } else {
    activeJobId = null;
    setSyncButtonState(false);
    if (payload.lastSyncedAt) {
      const when = new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date(payload.lastSyncedAt));
      setStatus(`Ultima sincronizacion de ${selectedUserName}: ${when}.`);
    } else if (payload.status === 'failed') {
      setStatus(payload.error || `La sincronizacion fallo para ${selectedUserName}.`, true);
    } else if (payload.status === 'idle') {
      setStatus(`Todavia no hay datos guardados para ${selectedUserName}.`);
    } else {
      setStatus(`Biblioteca cargada para ${selectedUserName}.`);
    }
  }

  if (payload.job?.id && payload.status === 'running') {
    pollSyncJob(payload.job.id);
  }
}

async function pollSyncJob(jobId) {
  while (activeJobId === jobId) {
    const response = await fetch(`/api/sync/${jobId}`);
    const job = await response.json();

    renderLog(job.log || []);
    updateProgress(job.status, job.log || []);

    if (job.status === 'completed') {
      activeJobId = null;
      setSyncButtonState(false);
      await loadSyncStateForSelectedUser();
      setStatus(`Sincronizacion completada para ${selectedUserName}.`);
      return;
    }

    if (job.status === 'failed') {
      activeJobId = null;
      setSyncButtonState(false);
      setStatus(job.error || 'La sincronizacion fallo.', true);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
}

async function startSync() {
  if (!selectedUserName) {
    setStatus('Configura primero al menos un usuario en config.json.', true);
    return;
  }

  setStatus(`Iniciando sincronizacion para ${selectedUserName}...`);
  renderLog([]);
  setSyncButtonState(true);

  try {
    await checkAccessForSelectedUser();
    const response = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: selectedUserName })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'No se pudo iniciar la sincronizacion.');
    }

    activeJobId = payload.jobId;
    await pollSyncJob(payload.jobId);
  } catch (error) {
    activeJobId = null;
    setSyncButtonState(false);
    setStatus(error.message || 'No se pudo iniciar la sincronizacion.', true);
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
    elements.configSummary.textContent = `Usuario activo: ${selected.name}`;
  } else {
    selectedUserName = '';
    elements.configSummary.textContent = 'No hay usuarios disponibles.';
  }

  updateQueryString();
}

elements.syncButton.addEventListener('click', startSync);
elements.userSelector.addEventListener('change', () => {
  selectedUserName = elements.userSelector.value;
  localStorage.setItem(SELECTED_USER_KEY, selectedUserName);
  updateQueryString();
  setStatus(`Usuario activo: ${selectedUserName}. Cargando estado...`);
  renderLog([]);
  updateProgress('idle', []);
  checkAccessForSelectedUser();
  loadSyncStateForSelectedUser().catch((error) => {
    setStatus(error.message || 'No se pudo cargar el estado de sincronizacion.', true);
  });
});

async function boot() {
  await loadConfig();
  if (selectedUserName) {
    await checkAccessForSelectedUser();
    await loadSyncStateForSelectedUser();
  } else {
    setStatus('Falta configurar usuarios en config.json.', true);
  }
}

boot();
