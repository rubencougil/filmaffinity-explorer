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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupThemeToggle, { once: true });
  } else {
    setupThemeToggle();
  }
})();
