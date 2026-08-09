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
  const deleteBtn = document.getElementById('delete-trade-btn');
  const tradeConfirm = document.getElementById('trade-confirm');
  const tradeConfirmMessage = document.getElementById('trade-confirm-message');
  const tradeConfirmYes = document.getElementById('trade-confirm-yes');

  if (!yoursGrid || !theirsGrid) return;

  /** @type {'accept' | 'delete' | null} */
  let pendingConfirmAction = null;

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

  function closeTradeConfirm() {
    pendingConfirmAction = null;
    if (!tradeConfirm) return;
    tradeConfirm.hidden = true;
    document.body.classList.remove('trade-confirm-open');
  }

  function openTradeConfirm(action) {
    if (!tradeConfirm || !tradeConfirmMessage) return;
    pendingConfirmAction = action;
    tradeConfirmMessage.textContent = action === 'delete'
      ? 'Are you sure you would like to delete this trade?'
      : 'Are you sure you would like to accept this trade offer?';
    tradeConfirm.hidden = false;
    document.body.classList.add('trade-confirm-open');
    if (tradeConfirmYes) tradeConfirmYes.focus();
  }

  async function resolveTradeConfirm(confirmed) {
    const action = pendingConfirmAction;
    closeTradeConfirm();
    if (!confirmed || !action || !viewTrade.tradeId) return;

    if (action === 'delete') {
      const deleted = await deletePostedTrade(viewTrade.tradeId);
      if (deleted) {
        window.location.href = 'trading.html';
        return;
      }
      window.alert('Could not delete trade.');
      return;
    }

    try {
      const accepted = await acceptPostedTrade(viewTrade.tradeId);
      if (accepted) {
        window.location.href = 'trading.html?accepted=1';
      }
    } catch (error) {
      if (error && error.code === 'AUTH_REQUIRED') {
        window.location.href = '/api/auth/roblox';
        return;
      }
      window.alert((error && error.message) || 'Could not accept trade.');
    }
  }

  if (tradeConfirmYes) {
    tradeConfirmYes.addEventListener('click', () => {
      resolveTradeConfirm(true);
    });
  }

  if (tradeConfirm) {
    tradeConfirm.addEventListener('click', (event) => {
      if (event.target.closest('[data-confirm-close]')) {
        resolveTradeConfirm(false);
      }
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && tradeConfirm && !tradeConfirm.hidden) {
      resolveTradeConfirm(false);
    }
  });

  if (acceptBtn || deleteBtn) {
    const postedTrade = viewTrade.tradeId ? getPostedTradeById(viewTrade.tradeId) : null;
    const canAccept = Boolean(
      postedTrade
      && viewTrade.source !== 'accepted'
      && canUserAcceptTrade(postedTrade),
    );
    const canDelete = Boolean(
      postedTrade
      && viewTrade.source !== 'accepted'
      && canUserDeleteTrade(postedTrade),
    );

    if (acceptBtn) {
      if (canAccept) {
        acceptBtn.hidden = false;
        acceptBtn.addEventListener('click', () => {
          openTradeConfirm('accept');
        });
      } else {
        acceptBtn.hidden = true;
      }
    }

    if (deleteBtn) {
      if (canDelete) {
        deleteBtn.hidden = false;
        deleteBtn.addEventListener('click', () => {
          openTradeConfirm('delete');
        });
      } else {
        deleteBtn.hidden = true;
      }
    }
  }
})();
