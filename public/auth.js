(function () {
  const loginBtn = document.querySelector('.login-btn');
  if (!loginBtn) return;

  loginBtn.href = '/api/auth/roblox';

  function avatarUrlFor(user) {
    if (user.avatarUrl) return user.avatarUrl;
    if (user.picture) return user.picture;
    if (user.id) {
      return `https://www.roblox.com/headshot-thumbnail/image?userId=${encodeURIComponent(user.id)}&width=150&height=150&format=png`;
    }
    return '';
  }

  function renderLoggedOut() {
    loginBtn.textContent = 'Log In';
    loginBtn.href = '/api/auth/roblox';
    loginBtn.removeAttribute('title');
    loginBtn.removeAttribute('aria-label');
    loginBtn.classList.remove('login-btn--user', 'login-btn--avatar');
  }

  function renderLoggedIn(user) {
    const label = user.username || user.name || 'Account';
    const avatarUrl = avatarUrlFor(user);

    loginBtn.textContent = '';
    loginBtn.href = '/api/auth/logout';
    loginBtn.title = `${label} — Log out`;
    loginBtn.setAttribute('aria-label', `${label}, log out`);
    loginBtn.classList.add('login-btn--user', 'login-btn--avatar');

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
      return;
    }

    loginBtn.classList.remove('login-btn--avatar');
    loginBtn.textContent = label;
  }

  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (data && data.user) {
        renderLoggedIn(data.user);
      } else {
        renderLoggedOut();
      }
    })
    .catch(() => {
      renderLoggedOut();
    });
})();
