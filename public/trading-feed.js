(function () {
  const feed = document.getElementById('posted-trades-feed');
  const emptyState = document.getElementById('posted-trades-empty');
  const headbar = document.getElementById('trading-feed-headbar');
  const personLabel = document.getElementById('trading-feed-person-label');
  const acceptedBtn = document.getElementById('accepted-trades-btn');
  const filterPicker = document.getElementById('trade-side-filter-picker');
  const filterSearch = document.getElementById('trade-side-filter-search');
  const filterClearBtn = document.getElementById('trade-side-filter-clear');

  if (!feed || !emptyState) return;

  let showingAccepted = new URLSearchParams(window.location.search).get('accepted') === '1';
  let lastFingerprint = '';
  /** @type {{ side: 'yours' | 'theirs', itemName: string } | null} */
  let sideFilter = null;
  /** @type {'yours' | 'theirs' | null} */
  let filterPickerSide = null;
  let activeFilterCategory = 'pets';

  const CATEGORY_ITEMS = {
    pets: typeof pets !== 'undefined' ? pets : [],
    'pet-wear': typeof petWear !== 'undefined' ? petWear : [],
    strollers: typeof strollers !== 'undefined' ? strollers : [],
    food: typeof food !== 'undefined' ? food : [],
    vehicles: typeof vehicles !== 'undefined' ? vehicles : [],
    toys: typeof toys !== 'undefined' ? toys : [],
    gifts: typeof gifts !== 'undefined' ? gifts : [],
    stickers: typeof stickers !== 'undefined' ? stickers : [],
    houses: typeof houses !== 'undefined' ? houses : [],
  };

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

  function normalizeItemName(name) {
    return String(name || '').trim().toLowerCase();
  }

  function getViewerSideItems(trade, side) {
    // Feed labels swap: "Your Side" shows trade.theirSide, "Their Side" shows trade.yourSide.
    if (side === 'yours') return Array.isArray(trade.theirSide) ? trade.theirSide : [];
    return Array.isArray(trade.yourSide) ? trade.yourSide : [];
  }

  function tradeMatchesSideFilter(trade) {
    if (!sideFilter) return true;
    const items = getViewerSideItems(trade, sideFilter.side);
    const target = normalizeItemName(sideFilter.itemName);
    return items.some((item) => normalizeItemName(item && item.name) === target);
  }

  function applySideFilter(trades) {
    if (!sideFilter) return trades;
    return trades.filter(tradeMatchesSideFilter);
  }

  function fingerprintTrades(trades) {
    const filterKey = sideFilter
      ? `${sideFilter.side}:${normalizeItemName(sideFilter.itemName)}`
      : 'none';
    return `${filterKey}|${trades.map((trade) => [
      trade.id,
      trade.postedAt || 0,
      trade.acceptedAt || 0,
      trade.completedAt || 0,
      trade.failedAt || 0,
    ].join(':')).join('|')}`;
  }

  function syncFilterButtonState() {
    document.querySelectorAll('.trading-side-filter-btn').forEach((btn) => {
      const side = btn.dataset.side;
      const active = Boolean(sideFilter && sideFilter.side === side);
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      if (active) {
        btn.setAttribute('title', `Filtered by ${sideFilter.itemName}`);
      } else {
        btn.removeAttribute('title');
      }
    });

    if (filterClearBtn) {
      const showClear = Boolean(
        sideFilter && filterPickerSide && sideFilter.side === filterPickerSide,
      );
      filterClearBtn.hidden = !showClear;
    }
  }

  async function renderFeed(force) {
    await ensureTradesSynced();

    if (showingAccepted) {
      const allTrades = getAcceptedTradesForUser();
      const trades = applySideFilter(allTrades);
      const nextFingerprint = `accepted:${fingerprintTrades(allTrades)}`;
      if (!force && nextFingerprint === lastFingerprint) return;
      lastFingerprint = nextFingerprint;

      if (!allTrades.length) {
        feed.innerHTML = '';
        emptyState.hidden = false;
        emptyState.textContent = 'No accepted trades yet.';
        if (headbar) headbar.hidden = true;
        syncFilterButtonState();
        return;
      }

      if (!trades.length) {
        feed.innerHTML = '';
        emptyState.hidden = false;
        emptyState.textContent = sideFilter
          ? `No accepted trades with ${sideFilter.itemName} on ${sideFilter.side === 'yours' ? 'Your Side' : 'Their Side'}.`
          : 'No accepted trades yet.';
        if (headbar) headbar.hidden = false;
        syncFilterButtonState();
        return;
      }

      emptyState.hidden = true;
      if (headbar) headbar.hidden = false;
      feed.innerHTML = trades.map(buildAcceptedTradeHTML).join('');
      syncFilterButtonState();
      return;
    }

    const allTrades = getPostedTrades();
    const trades = applySideFilter(allTrades);
    const nextFingerprint = `posted:${fingerprintTrades(allTrades)}`;
    if (!force && nextFingerprint === lastFingerprint) return;
    lastFingerprint = nextFingerprint;

    if (!allTrades.length) {
      feed.innerHTML = '';
      emptyState.hidden = false;
      emptyState.textContent = 'No trades posted yet.';
      if (headbar) headbar.hidden = true;
      syncFilterButtonState();
      return;
    }

    if (!trades.length) {
      feed.innerHTML = '';
      emptyState.hidden = false;
      emptyState.textContent = sideFilter
        ? `No trades with ${sideFilter.itemName} on ${sideFilter.side === 'yours' ? 'Your Side' : 'Their Side'}.`
        : 'No trades posted yet.';
      if (headbar) headbar.hidden = false;
      syncFilterButtonState();
      return;
    }

    emptyState.hidden = true;
    if (headbar) headbar.hidden = false;
    feed.innerHTML = trades.map((trade) => buildPostedTradeHTML(trade)).join('');
    syncFilterButtonState();
  }

  function getActivePanel() {
    if (!filterPicker) return null;
    return filterPicker.querySelector(`.trade-picker__panel-content[data-panel="${activeFilterCategory}"]`);
  }

  function renderFilterItems() {
    const panel = getActivePanel();
    if (!panel) return;

    const container = panel.querySelector('[data-filter-items]');
    const hint = panel.querySelector('[data-filter-hint]');
    if (!container || !hint) return;

    const items = CATEGORY_ITEMS[activeFilterCategory] || [];
    const query = filterSearch ? filterSearch.value.trim() : '';
    const matches = query
      ? items.filter((item) => (
        typeof matchesSearchQuery === 'function'
          ? matchesSearchQuery(item.name, query)
          : normalizeItemName(item.name).includes(normalizeItemName(query))
      ))
      : items;

    container.innerHTML = matches.map((item) => {
      const selected = Boolean(
        sideFilter
        && filterPickerSide
        && sideFilter.side === filterPickerSide
        && normalizeItemName(sideFilter.itemName) === normalizeItemName(item.name),
      );
      return `<button type="button" class="trade-picker__item${selected ? ' trade-picker__item--selected' : ''}" data-item-name="${escapeHtml(item.name)}" aria-label="${escapeHtml(item.name)}" aria-pressed="${selected ? 'true' : 'false'}">
        <img src="${escapeHtml(item.image)}" alt="" loading="lazy">
      </button>`;
    }).join('');

    container.hidden = matches.length === 0;
    hint.hidden = matches.length > 0;
    if (!matches.length) {
      hint.textContent = query ? 'No items found' : 'No items in this category';
      hint.hidden = false;
    }
  }

  function setFilterCategory(category) {
    if (!filterPicker || !CATEGORY_ITEMS[category]) return;
    activeFilterCategory = category;
    filterPicker.querySelectorAll('.trade-picker__category').forEach((btn) => {
      btn.classList.toggle('trade-picker__category--active', btn.dataset.category === category);
    });
    filterPicker.querySelectorAll('.trade-picker__panel-content').forEach((panel) => {
      panel.classList.toggle('trade-picker__panel-content--active', panel.dataset.panel === category);
    });
    renderFilterItems();
  }

  function openFilterPicker(side) {
    if (!filterPicker) return;
    filterPickerSide = side;
    filterPicker.hidden = false;
    document.body.classList.add('trade-picker-open');
    if (filterSearch) {
      filterSearch.value = '';
      filterSearch.focus();
    }
    setFilterCategory('pets');
    syncFilterButtonState();
  }

  function closeFilterPicker() {
    if (!filterPicker) return;
    filterPicker.hidden = true;
    document.body.classList.remove('trade-picker-open');
    filterPickerSide = null;
    syncFilterButtonState();
  }

  function setSideFilter(side, itemName) {
    sideFilter = { side, itemName };
    syncFilterButtonState();
    closeFilterPicker();
    renderFeed(true);
  }

  function clearSideFilter() {
    sideFilter = null;
    syncFilterButtonState();
    renderFilterItems();
    renderFeed(true);
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

  document.querySelectorAll('.trading-side-filter-btn').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const side = btn.dataset.side === 'theirs' ? 'theirs' : 'yours';
      openFilterPicker(side);
    });
  });

  if (filterPicker) {
    filterPicker.addEventListener('click', (event) => {
      if (event.target.closest('[data-filter-close]')) {
        closeFilterPicker();
        return;
      }

      const categoryBtn = event.target.closest('.trade-picker__category');
      if (categoryBtn && categoryBtn.dataset.category) {
        setFilterCategory(categoryBtn.dataset.category);
        return;
      }

      const itemBtn = event.target.closest('.trade-picker__item');
      if (itemBtn && itemBtn.dataset.itemName && filterPickerSide) {
        const itemName = itemBtn.dataset.itemName;
        if (
          sideFilter
          && sideFilter.side === filterPickerSide
          && normalizeItemName(sideFilter.itemName) === normalizeItemName(itemName)
        ) {
          clearSideFilter();
          closeFilterPicker();
          return;
        }
        setSideFilter(filterPickerSide, itemName);
      }
    });
  }

  if (filterSearch) {
    filterSearch.addEventListener('input', () => {
      renderFilterItems();
    });
  }

  if (filterClearBtn) {
    filterClearBtn.addEventListener('click', () => {
      clearSideFilter();
      closeFilterPicker();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && filterPicker && !filterPicker.hidden) {
      closeFilterPicker();
    }
  });

  if (acceptedBtn) {
    acceptedBtn.addEventListener('click', () => {
      setAcceptedMode(!showingAccepted);
      renderFeed(true);
    });
  }

  setAcceptedMode(showingAccepted);
  syncFilterButtonState();
  renderFeed(true);
  setInterval(() => {
    renderFeed(false);
  }, 60000);
})();
