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
  }

  document.documentElement.setAttribute('data-theme', 'light');

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupHamburger, { once: true });
  } else {
    setupHamburger();
  }
})();
