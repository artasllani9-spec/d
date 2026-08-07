(function () {
  const ADMIN_ROBLOX_ID = '3519737769';
  const panel = document.querySelector('.admin-tools-panel');
  const loading = document.querySelector('.admin-tools-loading');

  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      const user = data && data.user ? data.user : null;
      if (!user || String(user.id) !== ADMIN_ROBLOX_ID) {
        window.location.replace('index.html');
        return;
      }

      if (loading) loading.hidden = true;
      if (panel) panel.hidden = false;
    })
    .catch(() => {
      window.location.replace('index.html');
    });
})();
