(function () {
  const SELECTED_USER_KEY = 'filmaffinity-browser-selected-user';
  let storageWarningShown = false;

  function accessUserStorage(operation) {
    try {
      return operation(window.localStorage);
    } catch (error) {
      if (!(error instanceof DOMException) ||
          !['SecurityError', 'QuotaExceededError'].includes(error.name)) throw error;
      if (!storageWarningShown) {
        console.warn('No se puede acceder a las preferencias locales. El usuario se conservará en la URL.', error);
        storageWarningShown = true;
      }
      return null;
    }
  }

  function updateUserNavigation(userName, extraParams = {}) {
    if (userName) {
      accessUserStorage((storage) => {
        if (storage.getItem(SELECTED_USER_KEY) !== userName) storage.setItem(SELECTED_USER_KEY, userName);
      });
    }
    const url = new URL(window.location.href);
    Object.entries({ userName, ...extraParams }).forEach(([name, value]) => {
      if (value) {
        url.searchParams.set(name, value);
      } else {
        url.searchParams.delete(name);
      }
    });
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url);

    const targets = {
      home: 'index.html', watchnext: 'watch-next.html', affinity: 'affinity.html', stats: 'stats.html'
    };
    const query = userName ? `?userName=${encodeURIComponent(userName)}` : '';
    document.querySelectorAll('[data-nav-target], .brand-mark').forEach((link) => {
      const target = link.dataset.navTarget || 'home';
      if (targets[target]) link.href = `${targets[target]}${query}`;
    });
  }

  async function initializeUserSelector(selector) {
    const response = await fetch('/api/config');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'No se pudo cargar la configuración.');
    const users = Array.isArray(payload?.filmaffinity?.users) ? payload.filmaffinity.users : [];
    const queryUser = new URLSearchParams(window.location.search).get('userName') || '';
    const savedUser = accessUserStorage((storage) => storage.getItem(SELECTED_USER_KEY)) || '';
    const defaultUser = String(payload?.filmaffinity?.defaultUser || '').trim();
    const selected = users.find((user) => user.name === queryUser) ||
      users.find((user) => user.name === savedUser) ||
      users.find((user) => user.name === defaultUser) || users[0];

    selector.replaceChildren();
    users.forEach((user) => {
      const option = document.createElement('option');
      option.value = user.name;
      option.textContent = user.name;
      selector.appendChild(option);
    });
    const userName = selected?.name || '';
    selector.value = userName;
    selector.disabled = users.length === 0;
    updateUserNavigation(userName);
    return { users, userName };
  }

  function parseFlexibleDate(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const spanish = text.toLowerCase().match(/(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})/);
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
      'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    if (iso || spanish) {
      const year = Number(iso ? iso[1] : spanish[3]);
      const month = iso ? Number(iso[2]) - 1 : months.indexOf(spanish[2].replace('setiembre', 'septiembre'));
      const day = Number(iso ? iso[3] : spanish[1]);
      const date = new Date(year, month, day);
      return month >= 0 && date.getFullYear() === year && date.getMonth() === month &&
        date.getDate() === day ? date : null;
    }
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function toRating(value) {
    if (value === null || value === undefined || String(value).trim() === '') {
      return null;
    }
    const rating = Number(value);
    return Number.isFinite(rating) && rating >= 1 && rating <= 10 ? rating : null;
  }

  function normalizeSearch(value) {
    return String(value || '').trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  }

  function createFilterState(controls) {
    const entries = Object.entries(controls).map(([name, element]) => ({
      name,
      element,
      defaultValue: element.type === 'checkbox' ? element.checked : element.value
    }));

    function reset() {
      entries.forEach(({ element, defaultValue }) => {
        if (element.type === 'checkbox') {
          element.checked = defaultValue;
        } else {
          element.value = defaultValue;
        }
      });
    }

    return {
      reset,
      restore() {
        const params = new URLSearchParams(window.location.search);
        entries.forEach(({ name, element, defaultValue }) => {
          const value = params.get(name);
          if (element.type === 'checkbox') {
            element.checked = value === null ? defaultValue : value === '1';
          } else if (element.tagName === 'SELECT') {
            element.value = Array.from(element.options).some((option) => option.value === value)
              ? value : defaultValue;
          } else {
            element.value = value ?? defaultValue;
          }
        });
      },
      save(extra = {}) {
        const url = new URL(window.location.href);
        entries.forEach(({ name, element, defaultValue }) => {
          const value = element.type === 'checkbox' ? element.checked : element.value.trim();
          url.searchParams.delete(name);
          if (value !== defaultValue) {
            url.searchParams.set(name, element.type === 'checkbox' ? (value ? '1' : '0') : value);
          }
        });
        Object.entries(extra).forEach(([name, values]) => {
          url.searchParams.delete(name);
          values.forEach((value) => url.searchParams.append(name, value));
        });
        if (url.href !== window.location.href) {
          window.history.replaceState(window.history.state, '', url);
        }
      }
    };
  }

  function renderEmptyState(container, message, onReset) {
    const wrapper = document.createElement('div');
    wrapper.className = 'empty-state';
    const text = document.createElement('p');
    text.className = 'status-text';
    text.textContent = message;
    wrapper.appendChild(text);
    if (onReset) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ghost-button';
      button.textContent = 'Limpiar filtros';
      button.addEventListener('click', onReset);
      wrapper.appendChild(button);
    }
    container.appendChild(wrapper);
  }

  function createTrailerDialog() {
    const dialog = document.getElementById('trailer-modal');
    const frame = document.getElementById('trailer-frame');
    const title = document.getElementById('trailer-title');
    const closeButton = document.getElementById('trailer-close');
    const unavailable = document.getElementById('trailer-unavailable');

    function clear() {
      frame.removeAttribute('src');
      frame.removeAttribute('srcdoc');
      frame.hidden = true;
      unavailable.hidden = true;
      dialog.hidden = true;
      dialog.removeAttribute('aria-describedby');
      document.body.classList.remove('modal-open');
    }

    function close() {
      dialog.close();
      clear();
    }

    closeButton.addEventListener('click', close);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) close();
    });
    dialog.addEventListener('close', () => {
      if (!dialog.open) clear();
    });

    return {
      open(record) {
        const filmTitle = String(record.title || '').trim() || 'Trailer';
        const year = String(record.year || '').trim();
        const videoId = String(record.trailerVideoId || '').trim();
        const embedUrl = String(record.trailerEmbedUrl || '').trim() ||
          (videoId ? `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&playsinline=1` : '');

        title.textContent = year ? `${filmTitle} (${year})` : filmTitle;
        frame.removeAttribute('src');
        frame.removeAttribute('srcdoc');
        frame.hidden = !embedUrl;
        unavailable.hidden = Boolean(embedUrl);
        if (embedUrl) {
          dialog.removeAttribute('aria-describedby');
        } else {
          dialog.setAttribute('aria-describedby', unavailable.id);
        }
        if (embedUrl) frame.src = embedUrl;
        dialog.hidden = false;
        if (!dialog.open) dialog.showModal();
        document.body.classList.add('modal-open');
        closeButton.focus();
      }
    };
  }

  function getImageProxyUrl(url, width = 400) {
    const params = new URLSearchParams({ url, w: String(width), fit: 'inside', output: 'webp', q: '65' });
    return `https://images.weserv.nl/?${params}`;
  }

  function setPosterSource(image, posterUrl, { priority = false, thumbnail = false } = {}) {
    const source = String(posterUrl || '').trim();
    if (!source) {
      image.removeAttribute('src');
      return;
    }
    const fullSource = source.replace('-msmall.', '-large.');
    const widths = thumbnail ? [80] : [200, 400, 600, 800];
    image.loading = priority ? 'eager' : 'lazy';
    image.fetchPriority = priority ? 'high' : 'auto';
    image.decoding = 'async';
    image.width = thumbnail ? 40 : 400;
    image.height = thumbnail ? 56 : 550;
    image.sizes = thumbnail
      ? '40px'
      : '(max-width: 760px) calc(100vw - 80px), (max-width: 920px) 40vw, (max-width: 1120px) 28vw, 200px';
    image.srcset = widths.map((width) => `${getImageProxyUrl(fullSource, width)} ${width}w`).join(', ');
    const fallbacks = [
      ...(source !== fullSource ? [getImageProxyUrl(source, thumbnail ? 80 : 400)] : []),
      source
    ];
    image.onerror = () => {
      image.removeAttribute('srcset');
      const next = fallbacks.shift();
      if (next) {
        image.src = next;
      } else {
        image.onerror = null;
        image.removeAttribute('src');
        image.style.visibility = 'hidden';
        image.closest('.poster-link, .watch-next-poster-link')?.classList.add('is-empty');
      }
    };
    image.src = getImageProxyUrl(fullSource, thumbnail ? 80 : 400);
  }

  function createLatestLoader(status, onError) {
    let latestRequest = 0;
    return async (load) => {
      const request = ++latestRequest;
      const isCurrent = () => request === latestRequest;
      status.removeAttribute('role');
      status.style.color = '';
      status.replaceChildren();
      try {
        await load(isCurrent);
      } catch (error) {
        if (isCurrent()) onError(error);
      }
    };
  }

  function showError(error, status, containers = [], onRetry) {
    const message = error.message || 'No se pudieron cargar los datos.';
    status.textContent = message;
    status.style.color = 'var(--fa-error)';
    status.setAttribute('role', 'alert');
    containers.forEach((container) => {
      const text = document.createElement(container.tagName === 'OL' ? 'li' : 'p');
      text.className = 'status-text';
      text.textContent = message;
      container.replaceChildren(text);
    });
    if (onRetry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ghost-button';
      button.textContent = 'Reintentar';
      button.addEventListener('click', () => {
        button.disabled = true;
        status.tabIndex = -1;
        status.focus({ preventScroll: true });
        onRetry();
      }, { once: true });
      status.append(' ', button);
    }
  }

  window.siteUtils = {
    initializeUserSelector, updateUserNavigation,
    parseFlexibleDate, toRating, normalizeSearch, createFilterState, renderEmptyState,
    createTrailerDialog, getImageProxyUrl, setPosterSource, createLatestLoader, showError
  };
}());
