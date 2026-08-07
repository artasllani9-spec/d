(async function () {
  await ensureTradesSynced();

  const viewTrade = consumeViewTradeSession();
  if (!viewTrade) {
    window.location.href = 'trading.html';
    return;
  }

  const yoursGrid = document.getElementById('view-trade-yours');
  const theirsGrid = document.getElementById('view-trade-theirs');
  const offererEl = document.getElementById('view-trade-offerer');
  const offererAvatarEl = document.getElementById('view-trade-offerer-avatar');
  const timerEl = document.getElementById('view-trade-timer');
  const acceptBtn = document.getElementById('accept-trade-btn');

  if (!yoursGrid || !theirsGrid) return;

  const yourItems = viewTrade.yourSide || [];
  const theirItems = viewTrade.theirSide || [];

  yoursGrid.innerHTML = buildReadOnlyTradeGridHTML(yourItems);
  theirsGrid.innerHTML = buildReadOnlyTradeGridHTML(theirItems);
  yoursGrid.dataset.capacity = String(getViewTradeGridCapacity(yourItems.length));
  theirsGrid.dataset.capacity = String(getViewTradeGridCapacity(theirItems.length));

  if (offererEl) {
    offererEl.textContent = viewTrade.offerer || '—';
    const profileUrl = getOffererProfileUrl(viewTrade);
    if (profileUrl) {
      offererEl.href = profileUrl;
      offererEl.removeAttribute('target');
      offererEl.removeAttribute('rel');
      offererEl.removeAttribute('aria-disabled');
      offererEl.style.pointerEvents = '';
      offererEl.style.textDecoration = '';
    } else {
      offererEl.removeAttribute('href');
      offererEl.setAttribute('aria-disabled', 'true');
      offererEl.style.pointerEvents = 'none';
      offererEl.style.textDecoration = 'none';
    }
  }

  if (offererAvatarEl) {
    const avatarUrl = viewTrade.offererAvatar || getOffererAvatarUrl(viewTrade);
    if (avatarUrl) {
      offererAvatarEl.src = avatarUrl;
      offererAvatarEl.hidden = false;
    } else {
      offererAvatarEl.hidden = true;
    }
  }

  if (timerEl && viewTrade.postedAt) {
    timerEl.textContent = formatTimeAgo(viewTrade.postedAt);
    timerEl.dateTime = new Date(viewTrade.postedAt).toISOString();
  }

  if (acceptBtn) {
    const postedTrade = viewTrade.tradeId ? getPostedTradeById(viewTrade.tradeId) : null;
    const labelEl = acceptBtn.querySelector('.trade-action-btn__label');
    const isOwnPosted = Boolean(
      postedTrade &&
      viewTrade.source !== 'accepted' &&
      canUserDeleteTrade(postedTrade),
    );

    if (isOwnPosted) {
      acceptBtn.classList.remove('trade-action-btn--accept');
      acceptBtn.classList.add('trade-action-btn--delete');
      acceptBtn.id = 'delete-trade-btn';
      if (labelEl) labelEl.textContent = 'Delete Trade';
      acceptBtn.addEventListener('click', () => {
        if (!window.confirm('Delete this trade offer?')) return;
        deletePostedTrade(viewTrade.tradeId).then((deleted) => {
          if (deleted) {
            window.location.href = 'trading.html';
            return;
          }
          window.alert('Could not delete trade.');
        });
      });
    } else if (postedTrade && canUserAcceptTrade(postedTrade)) {
      acceptBtn.addEventListener('click', () => {
        acceptPostedTrade(viewTrade.tradeId).then((accepted) => {
          if (accepted) {
            window.location.href = 'trading.html?accepted=1';
          }
        }).catch((error) => {
          if (error && error.code === 'AUTH_REQUIRED') {
            window.location.href = '/api/auth/roblox';
            return;
          }
          window.alert((error && error.message) || 'Could not accept trade.');
        });
      });
    } else {
      acceptBtn.hidden = true;
    }
  }
})();
