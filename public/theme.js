(() => {
  function setupHamburger() {
    const button = document.getElementById('nav-menu-toggle');
    const nav = document.getElementById('top-nav');
    if (!button || !nav) return;

    const closeMenu = () => {
      nav.classList.remove('is-open');
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', 'Abrir menú');
    };

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const isOpen = nav.classList.toggle('is-open');
      button.setAttribute('aria-expanded', String(isOpen));
      button.setAttribute('aria-label', isOpen ? 'Cerrar menú' : 'Abrir menú');
    });

    nav.addEventListener('click', (event) => {
      if (event.target.tagName === 'A') {
        closeMenu();
      }
    });

    document.addEventListener('click', (event) => {
      if (!button.contains(event.target) && !nav.contains(event.target)) {
        closeMenu();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && nav.classList.contains('is-open') &&
          !document.querySelector('dialog[open]')) {
        event.preventDefault();
        closeMenu();
        button.focus();
      }
    });
  }

  function setupMobileFilters() {
    const toggle = document.getElementById('mobile-filter-toggle');
    const sidebar = document.getElementById('filter-sidebar');
    if (!toggle || !sidebar) return;

    function setOpen(isOpen) {
      sidebar.classList.toggle('is-open', isOpen);
      toggle.setAttribute('aria-expanded', String(isOpen));
      toggle.querySelector('.mobile-filter-toggle-label').textContent = isOpen
        ? '✕ Ocultar filtros'
        : '🔧 Mostrar filtros';
    }

    toggle.addEventListener('click', () => setOpen(!sidebar.classList.contains('is-open')));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented &&
          sidebar.classList.contains('is-open') && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        setOpen(false);
        toggle.focus();
      }
    });
  }

  function setup() {
    setupHamburger();
    setupMobileFilters();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup, { once: true });
  } else {
    setup();
  }
})();
