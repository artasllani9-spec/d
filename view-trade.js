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
  }

  if (timerEl && viewTrade.postedAt) {
    timerEl.textContent = formatTimeAgo(viewTrade.postedAt);
    timerEl.dateTime = new Date(viewTrade.postedAt).toISOString();
  }

  if (acceptBtn) {
    const postedTrade = viewTrade.tradeId ? getPostedTradeById(viewTrade.tradeId) : null;
    if (!postedTrade || !canUserAcceptTrade(postedTrade)) {
      acceptBtn.hidden = true;
    } else {
      acceptBtn.addEventListener('click', () => {
        acceptPostedTrade(viewTrade.tradeId).then((accepted) => {
          if (accepted) {
            window.location.href = 'trading.html?accepted=1';
          }
        });
      });
    }
  }
})();
