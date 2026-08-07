(function () {
  const ADMIN_ROBLOX_ID = '3519737769';
  const loginBtn = document.querySelector('.login-btn');
  if (!loginBtn) return;

  let currentUser = null;
  let currentRoles = { isOwner: false, isModerator: false };
  let menuWrap = null;
  let dropdown = null;
  let adminToolsBtn = null;
  let reportsBtn = null;

  function avatarUrlFor(user) {
    if (user.avatarUrl) return user.avatarUrl;
    if (user.picture) return user.picture;
    if (user.id) {
      return `https://www.roblox.com/headshot-thumbnail/image?userId=${encodeURIComponent(user.id)}&width=150&height=150&format=png`;
    }
    return '';
  }

  function isAdminUser(user) {
    return Boolean(user && user.id && String(user.id) === ADMIN_ROBLOX_ID);
  }

  function ensureMenuWrap() {
    if (menuWrap && menuWrap.contains(loginBtn)) return menuWrap;
    menuWrap = document.createElement('div');
    menuWrap.className = 'account-menu';
    loginBtn.parentNode.insertBefore(menuWrap, loginBtn);
    menuWrap.appendChild(loginBtn);
    return menuWrap;
  }

  function removeAdminToolsBtn() {
    if (!adminToolsBtn) return;
    adminToolsBtn.remove();
    adminToolsBtn = null;
  }

  function removeReportsBtn() {
    if (!reportsBtn) return;
    reportsBtn.remove();
    reportsBtn = null;
  }

  function ensureAdminToolsBtn() {
    const wrap = ensureMenuWrap();
    if (adminToolsBtn && wrap.contains(adminToolsBtn)) return adminToolsBtn;

    removeAdminToolsBtn();
    adminToolsBtn = document.createElement('button');
    adminToolsBtn.type = 'button';
    adminToolsBtn.className = 'admin-tools-btn';
    adminToolsBtn.setAttribute('aria-label', 'Admin tools');
    adminToolsBtn.title = 'Admin tools';
    adminToolsBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.location.href = 'admin-tools.html';
    });

    const icon = document.createElement('span');
    icon.className = 'admin-tools-btn__icon';
    icon.setAttribute('aria-hidden', 'true');
    adminToolsBtn.appendChild(icon);

    wrap.insertBefore(adminToolsBtn, loginBtn);
    return adminToolsBtn;
  }

  function ensureReportsBtn() {
    const wrap = ensureMenuWrap();
    if (reportsBtn && wrap.contains(reportsBtn)) return reportsBtn;

    removeReportsBtn();
    reportsBtn = document.createElement('button');
    reportsBtn.type = 'button';
    reportsBtn.className = 'mod-reports-btn';
    reportsBtn.setAttribute('aria-label', 'User reports');
    reportsBtn.title = 'User reports';
    reportsBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.location.href = 'reports.html';
    });

    const icon = document.createElement('span');
    icon.className = 'mod-reports-btn__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '!';
    reportsBtn.appendChild(icon);

    const insertBefore = adminToolsBtn && wrap.contains(adminToolsBtn) ? adminToolsBtn : loginBtn;
    wrap.insertBefore(reportsBtn, insertBefore);
    return reportsBtn;
  }

  function syncModeratorButtons(user, roles) {
    if (isAdminUser(user)) {
      ensureAdminToolsBtn();
    } else {
      removeAdminToolsBtn();
    }

    if (roles && roles.isModerator) {
      ensureReportsBtn();
    } else {
      removeReportsBtn();
    }
  }

  function closeDropdown() {
    if (!dropdown) return;
    dropdown.hidden = true;
    loginBtn.setAttribute('aria-expanded', 'false');
    if (menuWrap) menuWrap.classList.remove('account-menu--open');
  }

  function openDropdown() {
    if (!dropdown) return;
    dropdown.hidden = false;
    loginBtn.setAttribute('aria-expanded', 'true');
    if (menuWrap) menuWrap.classList.add('account-menu--open');
  }

  function toggleDropdown(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!dropdown) return;
    if (dropdown.hidden) openDropdown();
    else closeDropdown();
  }

  function signOut(event) {
    event.preventDefault();
    closeDropdown();
    window.location.href = '/api/auth/logout';
  }

  function buildDropdown(user) {
    const wrap = ensureMenuWrap();
    if (dropdown) dropdown.remove();

    dropdown = document.createElement('div');
    dropdown.className = 'account-dropdown';
    dropdown.hidden = true;
    dropdown.setAttribute('role', 'menu');

    const identity = document.createElement('div');
    identity.className = 'account-dropdown__identity';
    identity.setAttribute('role', 'presentation');

    const nameEl = document.createElement('p');
    nameEl.className = 'account-dropdown__name';
    nameEl.textContent = user.username || user.name || 'Player';

    const idEl = document.createElement('p');
    idEl.className = 'account-dropdown__id';
    idEl.textContent = `ID: ${user.id || '—'}`;

    identity.appendChild(nameEl);
    identity.appendChild(idEl);

    const profileLink = document.createElement('a');
    profileLink.className = 'account-dropdown__item';
    profileLink.href = 'profile.html';
    profileLink.setAttribute('role', 'menuitem');
    profileLink.textContent = 'Profile';

    const logoutBtn = document.createElement('button');
    logoutBtn.type = 'button';
    logoutBtn.className = 'account-dropdown__item account-dropdown__item--danger';
    logoutBtn.setAttribute('role', 'menuitem');
    logoutBtn.textContent = 'Sign Out';
    logoutBtn.addEventListener('click', signOut);

    dropdown.appendChild(identity);
    dropdown.appendChild(profileLink);
    dropdown.appendChild(logoutBtn);
    wrap.appendChild(dropdown);
  }

  function renderLoggedOut() {
    closeDropdown();
    currentUser = null;
    currentRoles = { isOwner: false, isModerator: false };
    removeAdminToolsBtn();
    removeReportsBtn();
    if (dropdown) {
      dropdown.remove();
      dropdown = null;
    }
    if (menuWrap && menuWrap.contains(loginBtn)) {
      menuWrap.parentNode.insertBefore(loginBtn, menuWrap);
      menuWrap.remove();
      menuWrap = null;
    }

    loginBtn.textContent = 'Log In';
    loginBtn.href = '/api/auth/roblox';
    loginBtn.removeAttribute('title');
    loginBtn.removeAttribute('aria-label');
    loginBtn.removeAttribute('aria-expanded');
    loginBtn.removeAttribute('aria-haspopup');
    loginBtn.classList.remove('login-btn--user', 'login-btn--avatar');
    loginBtn.onclick = null;
  }

  function renderLoggedIn(user, roles) {
    currentUser = user;
    currentRoles = roles || { isOwner: false, isModerator: false };
    const label = user.username || user.name || 'Account';
    const avatarUrl = avatarUrlFor(user);

    ensureMenuWrap();
    buildDropdown(user);
    syncModeratorButtons(user, currentRoles);

    loginBtn.textContent = '';
    loginBtn.href = '#';
    loginBtn.title = label;
    loginBtn.setAttribute('aria-label', `${label} account menu`);
    loginBtn.setAttribute('aria-haspopup', 'menu');
    loginBtn.setAttribute('aria-expanded', 'false');
    loginBtn.classList.add('login-btn--user', 'login-btn--avatar');
    loginBtn.onclick = toggleDropdown;

    if (avatarUrl) {
      const img = document.createElement('img');
      img.className = 'login-btn__avatar';
      img.src = avatarUrl;
      img.alt = '';
      img.width = 40;
      img.height = 40;
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => {
        loginBtn.classList.remove('login-btn--avatar');
        loginBtn.textContent = label;
      };
      loginBtn.appendChild(img);
    } else {
      loginBtn.classList.remove('login-btn--avatar');
      loginBtn.textContent = label;
    }
  }

  document.addEventListener('click', (event) => {
    if (!menuWrap || !dropdown || dropdown.hidden) return;
    if (menuWrap.contains(event.target)) return;
    closeDropdown();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDropdown();
  });

  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (data && data.banned) {
        if (!/banned\.html$/i.test(window.location.pathname)) {
          window.location.replace('banned.html');
        }
        return;
      }
      if (data && data.user) {
        renderLoggedIn(data.user, data.roles || null);
      } else {
        renderLoggedOut();
      }
    })
    .catch(() => {
      renderLoggedOut();
    });
})();
