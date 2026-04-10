(() => {
  const THEME_KEY = 'filmaffinity-browser-theme';
  const LABEL_BY_THEME = {
    light: 'Claro',
    dark: 'Oscuro'
  };

  function normalizeTheme(value) {
    const text = String(value || '').trim().toLowerCase();
    return text === 'dark' ? 'dark' : text === 'light' ? 'light' : '';
  }

  function detectSystemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  function readStoredTheme() {
    try {
      return normalizeTheme(localStorage.getItem(THEME_KEY));
    } catch (error) {
      return '';
    }
  }

  function saveTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      // Ignore storage errors.
    }
  }

  function getActiveTheme() {
    const stored = readStoredTheme();
    return stored || detectSystemTheme();
  }

  function applyTheme(theme) {
    const safeTheme = normalizeTheme(theme) || 'light';
    document.documentElement.setAttribute('data-theme', safeTheme);
    return safeTheme;
  }

  function updateToggleButton(theme) {
    const button = document.querySelector('#global-theme-toggle');
    if (!button) {
      return;
    }

    const normalized = normalizeTheme(theme) || 'light';
    const isDark = normalized === 'dark';
    const textNode = button.querySelector('.theme-toggle-text');
    if (textNode) {
      textNode.textContent = LABEL_BY_THEME[normalized];
    }

    button.setAttribute('aria-pressed', String(isDark));
    button.setAttribute('title', isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
  }

  function setupThemeToggle() {
    const button = document.querySelector('#global-theme-toggle');
    if (!button) {
      return;
    }

    const current = normalizeTheme(document.documentElement.getAttribute('data-theme')) || 'light';
    updateToggleButton(current);

    button.addEventListener('click', () => {
      const active = normalizeTheme(document.documentElement.getAttribute('data-theme')) || 'light';
      const next = active === 'dark' ? 'light' : 'dark';
      const applied = applyTheme(next);
      saveTheme(applied);
      updateToggleButton(applied);
    });
  }

  const initialTheme = applyTheme(getActiveTheme());
  saveTheme(initialTheme);

  function setupHamburger() {
    const button = document.getElementById('nav-menu-toggle');
    const nav = document.getElementById('top-nav');
    if (!button || !nav) return;

    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = nav.classList.toggle('is-open');
      button.setAttribute('aria-expanded', String(isOpen));
      button.setAttribute('aria-label', isOpen ? 'Cerrar menú' : 'Abrir menú');
    });

    nav.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') {
        nav.classList.remove('is-open');
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-label', 'Abrir menú');
      }
    });

    document.addEventListener('click', (e) => {
      if (!button.contains(e.target) && !nav.contains(e.target)) {
        nav.classList.remove('is-open');
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-label', 'Abrir menú');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupThemeToggle, { once: true });
    document.addEventListener('DOMContentLoaded', setupHamburger, { once: true });
  } else {
    setupThemeToggle();
    setupHamburger();
  }
})();
