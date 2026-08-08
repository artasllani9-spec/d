(function () {
  const feed = document.getElementById('posted-trades-feed');
  const emptyState = document.getElementById('posted-trades-empty');
  const headbar = document.getElementById('trading-feed-headbar');
  const personLabel = document.getElementById('trading-feed-person-label');
  const acceptedBtn = document.getElementById('accepted-trades-btn');

  if (!feed || !emptyState) return;

  let showingAccepted = new URLSearchParams(window.location.search).get('accepted') === '1';
  let lastFingerprint = '';

  function setAcceptedMode(active) {
    showingAccepted = active;
    if (acceptedBtn) {
      acceptedBtn.classList.toggle('trading-btn--active', active);
      acceptedBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    if (personLabel) {
      personLabel.textContent = active ? 'Trader' : 'Offerer';
    }
  }

  function fingerprintTrades(trades) {
    return trades.map((trade) => [
      trade.id,
      trade.postedAt || 0,
      trade.acceptedAt || 0,
      trade.completedAt || 0,
      trade.failedAt || 0,
    ].join(':')).join('|');
  }

  async function renderFeed(force) {
    await ensureTradesSynced();

    if (showingAccepted) {
      const trades = getAcceptedTradesForUser();
      const nextFingerprint = `accepted:${fingerprintTrades(trades)}`;
      if (!force && nextFingerprint === lastFingerprint) return;
      lastFingerprint = nextFingerprint;

      if (!trades.length) {
        feed.innerHTML = '';
        emptyState.hidden = false;
        emptyState.textContent = 'No accepted trades yet.';
        if (headbar) headbar.hidden = true;
        return;
      }

      emptyState.hidden = true;
      if (headbar) headbar.hidden = false;
      feed.innerHTML = trades.map(buildAcceptedTradeHTML).join('');
      return;
    }

    const trades = getPostedTrades();
    const nextFingerprint = `posted:${fingerprintTrades(trades)}`;
    if (!force && nextFingerprint === lastFingerprint) return;
    lastFingerprint = nextFingerprint;

    if (!trades.length) {
      feed.innerHTML = '';
      emptyState.hidden = false;
      emptyState.textContent = 'No trades posted yet.';
      if (headbar) headbar.hidden = true;
      return;
    }

    emptyState.hidden = true;
    if (headbar) headbar.hidden = false;
    feed.innerHTML = trades.map((trade) => buildPostedTradeHTML(trade)).join('');
  }

  feed.addEventListener('click', (event) => {
    const article = event.target.closest('.posted-trade');
    if (!article) return;

    const tradeId = Number(article.dataset.tradeId);
    const tradeSource = article.dataset.tradeSource || 'posted';

    if (event.target.closest('.posted-trade__btn--view')) {
      if (setViewTradeSession(tradeId, tradeSource)) {
        window.location.href = 'view-trade.html';
      }
      return;
    }

    if (event.target.closest('.posted-trade__btn--mark-completed')) {
      markAcceptedTradeCompleted(tradeId).then((ok) => {
        if (ok) renderFeed(true);
      });
      return;
    }

    if (event.target.closest('.posted-trade__btn--mark-failed')) {
      markAcceptedTradeFailed(tradeId).then((ok) => {
        if (ok) renderFeed(true);
      });
      return;
    }

    if (event.target.closest('.posted-trade__btn--delete')) {
      deletePostedTrade(tradeId).then((ok) => {
        if (ok) renderFeed(true);
      });
      return;
    }

    if (event.target.closest('.posted-trade__btn--accept')) {
      acceptPostedTrade(tradeId).then((ok) => {
        if (ok) {
          setAcceptedMode(true);
          renderFeed(true);
        }
      }).catch((error) => {
        if (error && error.code === 'AUTH_REQUIRED') {
          window.location.href = '/api/auth/roblox';
          return;
        }
        window.alert((error && error.message) || 'Could not accept trade.');
      });
    }
  });

  if (acceptedBtn) {
    acceptedBtn.addEventListener('click', () => {
      setAcceptedMode(!showingAccepted);
      renderFeed(true);
    });
  }

  setAcceptedMode(showingAccepted);
  renderFeed(true);
  setInterval(() => {
    renderFeed(false);
  }, 60000);
})();
