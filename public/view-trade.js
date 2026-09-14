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

  let yourItems = Array.isArray(viewTrade.yourSide) ? viewTrade.yourSide.slice() : [];
  let theirItems = Array.isArray(viewTrade.theirSide) ? viewTrade.theirSide.slice() : [];

  function updateViewTradeValues() {
    if (typeof updateTradeValueCompare !== 'function' || typeof sumTradeSideUsd !== 'function') return;
    updateTradeValueCompare(sumTradeSideUsd(yourItems), sumTradeSideUsd(theirItems));
  }

  function renderTradeGrids() {
    yoursGrid.innerHTML = buildReadOnlyTradeGridHTML(yourItems);
    theirsGrid.innerHTML = buildReadOnlyTradeGridHTML(theirItems);
    yoursGrid.dataset.capacity = String(getViewTradeGridCapacity(yourItems.length));
    theirsGrid.dataset.capacity = String(getViewTradeGridCapacity(theirItems.length));
    updateViewTradeValues();
  }

  renderTradeGrids();
  window.addEventListener('valueoverridesready', updateViewTradeValues);

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

  const offererName = (viewTrade.offerer && viewTrade.offerer !== '—') ? viewTrade.offerer : 'Their Side';
  const theirsLabelEl = document.getElementById('view-trade-theirs-label');
  const theirsValueLabelEl = document.getElementById('trade-value-theirs-label');
  if (theirsLabelEl) {
    theirsLabelEl.textContent = offererName;
    theirsLabelEl.classList.toggle('trade-side__label--name', offererName !== 'Their Side');
  }
  if (theirsValueLabelEl) {
    theirsValueLabelEl.textContent = offererName;
    theirsValueLabelEl.classList.toggle('trade-value-compare__label--name', offererName !== 'Their Side');
  }
  theirsGrid.setAttribute('aria-label', offererName);

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
    await ensureAuthUser();
    const postedTrade = viewTrade.tradeId ? getPostedTradeById(viewTrade.tradeId) : null;
    const permTrade = postedTrade || viewTrade;
    const isOpenTrade = Boolean(viewTrade.source !== 'accepted' && (postedTrade || viewTrade.tradeId));
    const isPoster = Boolean(isOpenTrade && typeof isOwnPostedTrade === 'function' && isOwnPostedTrade(permTrade));
    const isMod = Boolean(typeof isAuthModerator === 'function' && isAuthModerator());

    // Poster: delete only. Regular viewer: accept only. Site mod: both (unless they posted it).
    const canAccept = Boolean(
      isOpenTrade
      && !isPoster
      && (typeof canUserAcceptTrade !== 'function' || canUserAcceptTrade(permTrade)),
    );
    const canDelete = Boolean(
      isOpenTrade
      && (isPoster || isMod)
      && (typeof canUserDeleteTrade !== 'function' || canUserDeleteTrade(permTrade)),
    );

    if (acceptBtn) {
      acceptBtn.hidden = !canAccept;
      if (canAccept) {
        acceptBtn.addEventListener('click', () => {
          openTradeConfirm('accept');
        });
      }
    }

    if (deleteBtn) {
      deleteBtn.hidden = !canDelete;
      if (canDelete) {
        deleteBtn.addEventListener('click', () => {
          openTradeConfirm('delete');
        });
      }
    }
  }
})();
