(function () {
  const loading = document.querySelector('.profile-loading');
  const card = document.querySelector('.profile-card');
  const heading = document.querySelector('.tos-heading');
  const tradesSection = document.querySelector('.profile-trades');
  const tradesFeed = document.getElementById('profile-trades-feed');
  const tradesEmpty = document.getElementById('profile-trades-empty');
  if (!loading || !card) return;

  const avatar = card.querySelector('.profile-card__avatar');
  const username = card.querySelector('.profile-card__username');
  const idEl = card.querySelector('.profile-card__id');
  const robloxLink = card.querySelector('.profile-card__roblox');
  const postedStat = document.getElementById('profile-stat-posted');
  const completedStat = document.getElementById('profile-stat-completed');
  const failedStat = document.getElementById('profile-stat-failed');
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

  function renderStats(stats) {
    const next = stats || {};
    if (postedStat) postedStat.textContent = String(next.posted || 0);
    if (completedStat) completedStat.textContent = String(next.completed || 0);
    if (failedStat) failedStat.textContent = String(next.failed || 0);
  }

  function renderUser(user, stats) {
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
      const labelEl = robloxLink.querySelector('.profile-card__roblox-label');
      if (labelEl) labelEl.textContent = 'View on Roblox';
    }
    renderStats(stats);
  }

  async function renderPublishedTrades(userId) {
    if (!tradesSection || !tradesFeed || !tradesEmpty || !userId) return;

    tradesSection.hidden = false;
    tradesFeed.innerHTML = '';
    tradesEmpty.hidden = true;

    try {
      await ensureAuthUser();
      const response = await fetch(`/api/trades/posted?userId=${encodeURIComponent(userId)}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('Could not load trades.');
      const trades = await response.json();
      const list = Array.isArray(trades) ? trades : [];

      if (!list.length) {
        tradesEmpty.hidden = false;
        return;
      }

      tradesFeed.innerHTML = list.map((trade) => buildPostedTradeHTML(trade)).join('');
    } catch {
      tradesEmpty.hidden = false;
      tradesEmpty.textContent = 'Could not load published trades.';
    }
  }

  if (tradesFeed) {
    tradesFeed.addEventListener('click', (event) => {
      const article = event.target.closest('.posted-trade');
      if (!article) return;
      const tradeId = Number(article.dataset.tradeId);

      if (event.target.closest('.posted-trade__btn--view')) {
        if (setViewTradeSession(tradeId, 'posted')) {
          window.location.href = 'view-trade.html';
        }
        return;
      }

      if (event.target.closest('.posted-trade__btn--accept')) {
        acceptPostedTrade(tradeId).then((ok) => {
          if (ok) window.location.href = 'trading.html?accepted=1';
        }).catch((error) => {
          if (error && error.code === 'AUTH_REQUIRED') {
            window.location.href = '/api/auth/roblox';
            return;
          }
          window.alert((error && error.message) || 'Could not accept trade.');
        });
        return;
      }

      if (event.target.closest('.posted-trade__btn--delete')) {
        deletePostedTrade(tradeId).then((ok) => {
          if (ok && profileId) renderPublishedTrades(profileId);
          else if (ok) ensureAuthUser().then((user) => user && renderPublishedTrades(user.id));
        });
      }
    });
  }

  function loadOwnProfile() {
    loading.textContent = 'Loading your account…';
    return fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : null))
      .then(async (data) => {
        if (!data || !data.user) {
          window.location.replace('/api/auth/roblox');
          return;
        }

        let stats = { posted: 0, completed: 0, failed: 0 };
        try {
          const statsResponse = await fetch(`/api/users/${encodeURIComponent(data.user.id)}`, {
            credentials: 'same-origin',
          });
          if (statsResponse.ok) {
            const statsData = await statsResponse.json();
            if (statsData && statsData.stats) stats = statsData.stats;
          }
        } catch {
          // Keep zeroed stats if lookup fails.
        }

        renderUser(data.user, stats);
        await renderPublishedTrades(data.user.id);
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
      .then(async (data) => {
        if (!data || !data.user) {
          throw new Error('Profile not found.');
        }
        renderUser(data.user, data.stats);
        await renderPublishedTrades(data.user.id);
      });
  }

  const loadPromise = profileId
    ? loadPublicProfile(profileId)
    : loadOwnProfile();

  loadPromise.catch(() => {
    loading.hidden = false;
    card.hidden = true;
    if (tradesSection) tradesSection.hidden = true;
    loading.textContent = profileId
      ? 'Could not load this profile.'
      : 'Could not load your profile. Try signing in again.';
  });
})();
