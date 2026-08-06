(function () {
  const loading = document.querySelector('.profile-loading');
  const card = document.querySelector('.profile-card');
  const heading = document.querySelector('.tos-heading');
  if (!loading || !card) return;

  const avatar = card.querySelector('.profile-card__avatar');
  const username = card.querySelector('.profile-card__username');
  const idEl = card.querySelector('.profile-card__id');
  const robloxLink = card.querySelector('.profile-card__roblox');
  const params = new URLSearchParams(window.location.search);
  const profileId = (params.get('id') || '').trim();

  function avatarUrlFor(user) {
    if (user.avatarUrl) return user.avatarUrl;
    if (user.picture) return user.picture;
    if (user.id) {
      return `https://www.roblox.com/headshot-thumbnail/image?userId=${encodeURIComponent(user.id)}&width=150&height=150&format=png`;
    }
    return '';
  }

  function renderUser(user) {
    const label = user.username || user.name || 'Player';
    const imageUrl = avatarUrlFor(user);
    const robloxUrl = user.profile || `https://www.roblox.com/users/${encodeURIComponent(user.id)}/profile`;

    loading.hidden = true;
    card.hidden = false;
    document.title = `${label} — demand.gg`;
    if (heading) heading.textContent = 'Profile';

    if (avatar && imageUrl) {
      avatar.src = imageUrl;
      avatar.alt = label;
    }
    if (username) username.textContent = label;
    if (idEl) idEl.textContent = `Roblox ID: ${user.id || '—'}`;
    if (robloxLink) {
      robloxLink.href = robloxUrl;
      robloxLink.textContent = 'View on Roblox';
    }
  }

  function loadOwnProfile() {
    loading.textContent = 'Loading your account…';
    return fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data || !data.user) {
          window.location.replace('/api/auth/roblox');
          return;
        }
        renderUser(data.user);
      });
  }

  function loadPublicProfile(userId) {
    loading.textContent = 'Loading profile…';
    return fetch(`/api/users/${encodeURIComponent(userId)}`, { credentials: 'same-origin' })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Profile not found.');
        }
        return response.json();
      })
      .then((data) => {
        if (!data || !data.user) {
          throw new Error('Profile not found.');
        }
        renderUser(data.user);
      });
  }

  const loadPromise = profileId
    ? loadPublicProfile(profileId)
    : loadOwnProfile();

  loadPromise.catch(() => {
    loading.hidden = false;
    card.hidden = true;
    loading.textContent = profileId
      ? 'Could not load this profile.'
      : 'Could not load your profile. Try signing in again.';
  });
})();
