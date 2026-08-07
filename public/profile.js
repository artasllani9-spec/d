(function () {
  const loading = document.querySelector('.profile-loading');
  const card = document.querySelector('.profile-card');
  const heading = document.querySelector('.tos-heading');
  const tradesSection = document.querySelector('.profile-trades');
  const tradesFeed = document.getElementById('profile-trades-feed');
  const tradesEmpty = document.getElementById('profile-trades-empty');
  const banBtn = document.getElementById('profile-ban-btn');
  const blockBtn = document.getElementById('profile-block-btn');
  const reportBtn = document.getElementById('profile-report-btn');
  const reportModal = document.getElementById('report-modal');
  const reportTitle = document.getElementById('report-modal-title');
  const reportInput = document.getElementById('report-reason-input');
  const reportStatus = document.getElementById('report-status');
  const reportCancelBtn = document.getElementById('report-cancel-btn');
  const reportSubmitBtn = document.getElementById('report-submit-btn');
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

  let viewedUserId = null;
  let viewedUsername = null;
  let viewerLoggedIn = false;
  let viewerRoles = { isModerator: false, isOwner: false };
  let profileModeration = null;
  let profileRelationship = null;

  function setReportStatus(message, isError) {
    if (!reportStatus) return;
    reportStatus.hidden = !message;
    reportStatus.textContent = message || '';
    reportStatus.classList.toggle('report-glass-bar__status--error', Boolean(isError));
  }

  function closeReportModal() {
    if (!reportModal) return;
    reportModal.hidden = true;
    document.body.classList.remove('report-modal-open');
    if (reportInput) reportInput.value = '';
    setReportStatus('', false);
    if (reportSubmitBtn) reportSubmitBtn.disabled = false;
  }

  function openReportModal() {
    if (!reportModal || !viewedUserId) return;
    const handle = viewedUsername ? `@${viewedUsername}` : `@${viewedUserId}`;
    if (reportTitle) reportTitle.textContent = `Report [${handle}]:`;
    if (reportInput) reportInput.value = '';
    setReportStatus('', false);
    reportModal.hidden = false;
    document.body.classList.add('report-modal-open');
    if (reportInput) reportInput.focus();
  }

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

  function isViewingSelf() {
    if (profileRelationship && typeof profileRelationship.isSelf === 'boolean') {
      return profileRelationship.isSelf;
    }
    return Boolean(getAuthUser() && viewedUserId && String(getAuthUser().id) === String(viewedUserId));
  }

  function syncBanButton() {
    if (!banBtn || !viewedUserId) {
      if (banBtn) banBtn.hidden = true;
      return;
    }

    const canModerate = Boolean(viewerRoles && viewerRoles.isModerator);
    const isSelf = isViewingSelf();
    const targetIsOwner = Boolean(profileModeration && profileModeration.isOwner);
    const targetIsModerator = Boolean(profileModeration && profileModeration.isModerator);
    const isBanned = Boolean(profileModeration && profileModeration.isBanned);
    const canBanTarget = canModerate
      && !isSelf
      && !targetIsOwner
      && (viewerRoles.isOwner || !targetIsModerator);

    if (!canBanTarget) {
      banBtn.hidden = true;
      return;
    }

    banBtn.hidden = false;
    banBtn.disabled = false;
    banBtn.textContent = isBanned ? 'Unban User' : 'Ban User';
    banBtn.classList.toggle('profile-ban-btn--unban', isBanned);
  }

  function syncUserActionButtons() {
    const showActions = Boolean(viewerLoggedIn && viewedUserId && !isViewingSelf());

    if (reportBtn) {
      reportBtn.hidden = !showActions;
      reportBtn.disabled = false;
    }

    if (blockBtn) {
      if (!showActions) {
        blockBtn.hidden = true;
      } else {
        const isBlocked = Boolean(profileRelationship && profileRelationship.blockedByViewer);
        blockBtn.hidden = false;
        blockBtn.disabled = false;
        blockBtn.textContent = isBlocked ? 'Unblock' : 'Block';
        blockBtn.classList.toggle('profile-user-btn--unblock', isBlocked);
      }
    }

    syncBanButton();
  }

  function renderUser(user, stats, moderation, relationship) {
    const label = user.username || user.name || 'Player';
    const imageUrl = avatarUrlFor(user);
    const robloxUrl = user.profile || `https://www.roblox.com/users/${encodeURIComponent(user.id)}/profile`;

    viewedUserId = user.id ? String(user.id) : null;
    viewedUsername = user.username || user.name || null;
    profileModeration = moderation || null;
    profileRelationship = relationship || null;

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
    syncUserActionButtons();
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

  if (reportBtn) {
    reportBtn.addEventListener('click', () => {
      if (!viewedUserId) return;
      if (!viewerLoggedIn) {
        window.location.href = '/api/auth/roblox';
        return;
      }
      openReportModal();
    });
  }

  if (reportCancelBtn) {
    reportCancelBtn.addEventListener('click', closeReportModal);
  }

  if (reportModal) {
    reportModal.addEventListener('click', (event) => {
      if (event.target.closest('[data-report-close]')) closeReportModal();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && reportModal && !reportModal.hidden) {
      closeReportModal();
    }
  });

  if (reportSubmitBtn) {
    reportSubmitBtn.addEventListener('click', async () => {
      if (!viewedUserId || !reportInput) return;
      const reason = String(reportInput.value || '').trim();
      if (!reason) {
        setReportStatus('Type a reason for the report.', true);
        reportInput.focus();
        return;
      }

      reportSubmitBtn.disabled = true;
      setReportStatus('Submitting report…', false);
      try {
        const response = await fetch('/api/moderation/reports', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: viewedUserId,
            username: viewedUsername,
            reason,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 401) {
            window.location.href = '/api/auth/roblox';
            return;
          }
          throw new Error(data.message || 'Could not submit report.');
        }
        closeReportModal();
        window.alert('Thanks. Your report was submitted.');
      } catch (error) {
        setReportStatus((error && error.message) || 'Could not submit report.', true);
        reportSubmitBtn.disabled = false;
      }
    });
  }

  if (blockBtn) {
    blockBtn.addEventListener('click', async () => {
      if (!viewedUserId) return;
      const isBlocked = Boolean(profileRelationship && profileRelationship.blockedByViewer);

      if (!isBlocked) {
        if (!window.confirm('Are you sure you would like to block this user?')) return;
      }

      blockBtn.disabled = true;
      try {
        const response = await fetch(
          isBlocked
            ? `/api/moderation/blocks/${encodeURIComponent(viewedUserId)}`
            : '/api/moderation/blocks',
          {
            method: isBlocked ? 'DELETE' : 'POST',
            credentials: 'same-origin',
            headers: isBlocked ? undefined : { 'Content-Type': 'application/json' },
            body: isBlocked ? undefined : JSON.stringify({ userId: viewedUserId }),
          },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok && response.status !== 204) {
          if (response.status === 401) {
            window.location.href = '/api/auth/roblox';
            return;
          }
          throw new Error(data.message || (isBlocked ? 'Could not unblock user.' : 'Could not block user.'));
        }

        profileRelationship = {
          ...(profileRelationship || {}),
          blockedByViewer: !isBlocked,
          isSelf: false,
        };
        syncUserActionButtons();
      } catch (error) {
        window.alert((error && error.message) || 'Could not update block.');
        blockBtn.disabled = false;
      }
    });
  }

  if (banBtn) {
    banBtn.addEventListener('click', async () => {
      if (!viewedUserId) return;
      const isBanned = Boolean(profileModeration && profileModeration.isBanned);
      const actionLabel = isBanned ? 'unban' : 'ban';
      if (!window.confirm(`Are you sure you want to ${actionLabel} this user?`)) return;

      banBtn.disabled = true;
      try {
        const response = await fetch(
          isBanned
            ? `/api/moderation/bans/${encodeURIComponent(viewedUserId)}`
            : '/api/moderation/bans',
          {
            method: isBanned ? 'DELETE' : 'POST',
            credentials: 'same-origin',
            headers: isBanned ? undefined : { 'Content-Type': 'application/json' },
            body: isBanned ? undefined : JSON.stringify({ userId: viewedUserId }),
          },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok && response.status !== 204) {
          throw new Error(data.message || `Could not ${actionLabel} user.`);
        }

        profileModeration = {
          ...(profileModeration || {}),
          isBanned: !isBanned,
          ban: isBanned ? null : (data.ban || { userId: viewedUserId }),
        };
        syncBanButton();
      } catch (error) {
        window.alert((error && error.message) || `Could not ${actionLabel} user.`);
        banBtn.disabled = false;
      }
    });
  }

  function loadOwnProfile() {
    loading.textContent = 'Loading your account…';
    return fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : null))
      .then(async (data) => {
        if (data && data.banned) {
          window.location.replace('banned.html');
          return;
        }
        if (!data || !data.user) {
          window.location.replace('/api/auth/roblox');
          return;
        }

        viewerLoggedIn = true;
        viewerRoles = {
          isOwner: Boolean(data.roles && data.roles.isOwner),
          isModerator: Boolean(data.roles && data.roles.isModerator),
        };

        let stats = { posted: 0, completed: 0, failed: 0 };
        let moderation = null;
        let relationship = { isSelf: true, blockedByViewer: false };
        try {
          const statsResponse = await fetch(`/api/users/${encodeURIComponent(data.user.id)}`, {
            credentials: 'same-origin',
          });
          if (statsResponse.ok) {
            const statsData = await statsResponse.json();
            if (statsData && statsData.stats) stats = statsData.stats;
            moderation = statsData.moderation || null;
            relationship = statsData.relationship || relationship;
          }
        } catch {
          // Keep zeroed stats if lookup fails.
        }

        renderUser(data.user, stats, moderation, relationship);
        await renderPublishedTrades(data.user.id);
      });
  }

  function loadPublicProfile(userId) {
    loading.textContent = 'Loading profile…';
    return fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : null))
      .then(async (authData) => {
        if (authData && authData.banned) {
          window.location.replace('banned.html');
          return;
        }
        viewerLoggedIn = Boolean(authData && authData.user);
        viewerRoles = {
          isOwner: Boolean(authData && authData.roles && authData.roles.isOwner),
          isModerator: Boolean(authData && authData.roles && authData.roles.isModerator),
        };

        const response = await fetch(`/api/users/${encodeURIComponent(userId)}`, {
          credentials: 'same-origin',
        });
        if (!response.ok) {
          throw new Error('Profile not found.');
        }
        const data = await response.json();
        if (!data || !data.user) {
          throw new Error('Profile not found.');
        }
        renderUser(data.user, data.stats, data.moderation, data.relationship);
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
