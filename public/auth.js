(function () {
  const loginBtn = document.querySelector('.login-btn');
  if (!loginBtn) return;

  loginBtn.href = '/api/auth/roblox';

  function renderLoggedOut() {
    loginBtn.textContent = 'Log In';
    loginBtn.href = '/api/auth/roblox';
    loginBtn.removeAttribute('title');
    loginBtn.classList.remove('login-btn--user');
  }

  function renderLoggedIn(user) {
    const label = user.username || user.name || 'Account';
    loginBtn.textContent = label;
    loginBtn.href = '/api/auth/logout';
    loginBtn.title = 'Log out';
    loginBtn.classList.add('login-btn--user');
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
