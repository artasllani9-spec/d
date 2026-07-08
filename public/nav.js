(function () {
  const menuBtn = document.querySelector('.nav-menu-btn');
  const nav = document.getElementById('site-nav');
  const mobileQuery = window.matchMedia('(max-width: 1024px)');

  if (!menuBtn || !nav) return;

  function isMobileNav() {
    return mobileQuery.matches;
  }

  function setOpen(open) {
    if (!isMobileNav()) return;
    nav.hidden = !open;
    menuBtn.classList.toggle('nav-menu-btn--open', open);
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }

  function syncNavMode() {
    if (!isMobileNav()) {
      nav.hidden = false;
      menuBtn.classList.remove('nav-menu-btn--open');
      menuBtn.setAttribute('aria-expanded', 'false');
      menuBtn.setAttribute('aria-label', 'Open menu');
      return;
    }

    if (!menuBtn.classList.contains('nav-menu-btn--open')) {
      nav.hidden = true;
    }
  }

  menuBtn.addEventListener('click', (event) => {
    if (!isMobileNav()) return;
    event.stopPropagation();
    setOpen(nav.hidden);
  });

  nav.querySelectorAll('.sector').forEach((link) => {
    link.addEventListener('click', () => setOpen(false));
  });

  document.addEventListener('click', (event) => {
    if (!isMobileNav() || nav.hidden) return;
    if (menuBtn.contains(event.target) || nav.contains(event.target)) return;
    setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (!isMobileNav()) return;
    if (event.key === 'Escape') setOpen(false);
  });

  mobileQuery.addEventListener('change', syncNavMode);
  syncNavMode();
})();
