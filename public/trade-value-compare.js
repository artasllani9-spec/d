(function () {
  function formatAmount(amount) {
    if (typeof formatUsdValue === 'function') {
      return formatUsdValue(amount);
    }
    return '$' + amount.toLocaleString('en-US');
  }

  function updateTradeValueCompare(yoursUsd, theirsUsd) {
    const root = document.getElementById('trade-value-compare');
    if (!root) return;

    root.hidden = false;

    const yours = Math.max(0, Number.isFinite(yoursUsd) ? yoursUsd : 0);
    const theirs = Math.max(0, Number.isFinite(theirsUsd) ? theirsUsd : 0);
    const total = yours + theirs;

    const yoursAmount = document.getElementById('trade-value-yours-amount');
    const theirsAmount = document.getElementById('trade-value-theirs-amount');
    const yoursSegment = document.getElementById('trade-value-yours-segment');
    const theirsSegment = document.getElementById('trade-value-theirs-segment');
    const verdictEl = document.getElementById('trade-value-verdict');

    if (yoursAmount) yoursAmount.textContent = formatAmount(yours);
    if (theirsAmount) theirsAmount.textContent = formatAmount(theirs);

    let yoursFlex = 1;
    let theirsFlex = 1;
    if (total > 0) {
      yoursFlex = Math.max(yours, 0.001);
      theirsFlex = Math.max(theirs, 0.001);
    }

    if (yoursSegment) yoursSegment.style.flex = String(yoursFlex);
    if (theirsSegment) theirsSegment.style.flex = String(theirsFlex);

    root.classList.remove('trade-value-compare--win', 'trade-value-compare--lose', 'trade-value-compare--fair');

    if (theirs > yours) {
      root.classList.add('trade-value-compare--win');
      if (verdictEl) verdictEl.textContent = 'Win';
    } else if (yours > theirs) {
      root.classList.add('trade-value-compare--lose');
      if (verdictEl) verdictEl.textContent = 'Lose';
    } else {
      root.classList.add('trade-value-compare--fair');
      if (verdictEl) verdictEl.textContent = 'Fair';
    }
  }

  window.updateTradeValueCompare = updateTradeValueCompare;
})();
