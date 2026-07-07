(function () {
  const feed = document.getElementById('posted-trades-feed');
  const emptyState = document.getElementById('posted-trades-empty');
  const headbar = document.getElementById('trading-feed-headbar');
  const acceptedBtn = document.getElementById('accepted-trades-btn');

  if (!feed || !emptyState) return;

  let showingAccepted = new URLSearchParams(window.location.search).get('accepted') === '1';

  function setAcceptedMode(active) {
    showingAccepted = active;
    if (acceptedBtn) {
      acceptedBtn.classList.toggle('trading-btn--active', active);
      acceptedBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  async function renderFeed() {
    await ensureTradesSynced();

    if (showingAccepted) {
      const trades = getAcceptedTradesForUser();
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
        if (ok) renderFeed();
      });
      return;
    }

    if (event.target.closest('.posted-trade__btn--mark-failed')) {
      markAcceptedTradeFailed(tradeId).then((ok) => {
        if (ok) renderFeed();
      });
      return;
    }

    if (event.target.closest('.posted-trade__btn--delete')) {
      deletePostedTrade(tradeId).then((ok) => {
        if (ok) renderFeed();
      });
      return;
    }

    if (event.target.closest('.posted-trade__btn--accept')) {
      acceptPostedTrade(tradeId).then((ok) => {
        if (ok) {
          setAcceptedMode(true);
          renderFeed();
        }
      });
    }
  });

  if (acceptedBtn) {
    acceptedBtn.addEventListener('click', () => {
      setAcceptedMode(!showingAccepted);
      renderFeed();
    });
  }

  setAcceptedMode(showingAccepted);
  renderFeed();
  setInterval(() => {
    renderFeed();
  }, 30000);
})();
