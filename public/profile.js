(function () {
  const loading = document.querySelector('.profile-loading');
  const card = document.querySelector('.profile-card');
  if (!loading || !card) return;

  const avatar = card.querySelector('.profile-card__avatar');
  const username = card.querySelector('.profile-card__username');
  const idEl = card.querySelector('.profile-card__id');
  const robloxLink = card.querySelector('.profile-card__roblox');

  function avatarUrlFor(user) {
    if (user.avatarUrl) return user.avatarUrl;
    if (user.picture) return user.picture;
    if (user.id) {
      return `https://www.roblox.com/headshot-thumbnail/image?userId=${encodeURIComponent(user.id)}&width=150&height=150&format=png`;
    }
    return '';
  }

  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (!data || !data.user) {
        window.location.replace('/api/auth/roblox');
        return;
      }

      const user = data.user;
      const label = user.username || user.name || 'Player';
      const imageUrl = avatarUrlFor(user);
      const profileUrl = user.profile || `https://www.roblox.com/users/${encodeURIComponent(user.id)}/profile`;

      loading.hidden = true;
      card.hidden = false;

      if (avatar && imageUrl) {
        avatar.src = imageUrl;
        avatar.alt = label;
      }
      if (username) username.textContent = label;
      if (idEl) idEl.textContent = `Roblox ID: ${user.id || '—'}`;
      if (robloxLink) {
        robloxLink.href = profileUrl;
        robloxLink.textContent = 'View on Roblox';
      }
    })
    .catch(() => {
      loading.textContent = 'Could not load your profile. Try signing in again.';
    });
})();
