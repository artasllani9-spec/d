(function () {
  const feed = document.getElementById('posted-trades-feed');
  const emptyState = document.getElementById('posted-trades-empty');
  const headbar = document.getElementById('trading-feed-headbar');
  const personLabel = document.getElementById('trading-feed-person-label');
  const acceptedBtn = document.getElementById('accepted-trades-btn');
  const filterPicker = document.getElementById('trade-side-filter-picker');
  const filterSearch = document.getElementById('trade-side-filter-search');
  const filterClearBtn = document.getElementById('trade-side-filter-clear');
  const filterDetail = document.getElementById('trade-side-filter-detail');
  const filterDetailImg = document.getElementById('trade-side-filter-detail-img');
  const filterDetailName = document.getElementById('trade-side-filter-detail-name');
  const filterDetailBadges = document.getElementById('trade-side-filter-detail-badges');
  const filterPotionsRow = document.getElementById('trade-side-filter-potions');
  const filterDetailCancel = document.getElementById('trade-side-filter-detail-cancel');
  const filterDetailConfirm = document.getElementById('trade-side-filter-detail-confirm');
  const tradeConfirm = document.getElementById('trade-confirm');
  const tradeConfirmMessage = document.getElementById('trade-confirm-message');
  const tradeConfirmYes = document.getElementById('trade-confirm-yes');
  const tradeConfirmNo = document.getElementById('trade-confirm-no');
  const potionButtons = filterPotionsRow
    ? filterPotionsRow.querySelectorAll('.trade-picker__potion')
    : [];
  const neonPotion = filterPotionsRow
    ? filterPotionsRow.querySelector('[data-potion="neon"]')
    : null;
  const megaPotion = filterPotionsRow
    ? filterPotionsRow.querySelector('[data-potion="mega"]')
    : null;

  if (!feed || !emptyState) return;

  let showingAccepted = new URLSearchParams(window.location.search).get('accepted') === '1';
  let lastFingerprint = '';
  /** @type {{ yours: { itemName: string, potions: object | null } | null, theirs: { itemName: string, potions: object | null } | null }} */
  const sideFilters = { yours: null, theirs: null };
  /** @type {'yours' | 'theirs' | null} */
  let filterPickerSide = null;
  let activeFilterCategory = 'pets';
  let pendingItemName = null;
  let pendingItemImage = null;
  let pendingNoPotions = false;
  /** @type {{ tradeId: number, action: 'completed' | 'failed' | 'delete' } | null} */
  let pendingConfirm = null;

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

  const noPotionsSet = typeof PETS_NO_POTIONS !== 'undefined' ? PETS_NO_POTIONS : new Set();

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

  function normalizePotions(potions) {
    return {
      fly: Boolean(potions && potions.fly),
      ride: Boolean(potions && potions.ride),
      neon: Boolean(potions && potions.neon),
      mega: Boolean(potions && potions.mega),
    };
  }

  function potionsEqual(a, b) {
    const left = normalizePotions(a);
    const right = normalizePotions(b);
    return (
      left.fly === right.fly
      && left.ride === right.ride
      && left.neon === right.neon
      && left.mega === right.mega
    );
  }

  function potionsKey(potions) {
    if (!potions) return 'any';
    const normalized = normalizePotions(potions);
    return [
      normalized.mega ? 'M' : '',
      normalized.neon ? 'N' : '',
      normalized.fly ? 'F' : '',
      normalized.ride ? 'R' : '',
    ].join('');
  }

  function formatPotionsLabel(potions) {
    if (!potions) return '';
    const normalized = normalizePotions(potions);
    const parts = [];
    if (normalized.mega) parts.push('M');
    if (normalized.neon) parts.push('N');
    if (normalized.fly) parts.push('F');
    if (normalized.ride) parts.push('R');
    return parts.length ? ` (${parts.join('')})` : ' (no potions)';
  }

  function itemSupportsPotions(category, itemName) {
    return category === 'pets' && !noPotionsSet.has(itemName);
  }

  function getViewerSideItems(trade, side) {
    const userId = typeof getCurrentUserId === 'function' ? getCurrentUserId() : null;
    const isPosterAccepted = Boolean(
      trade
      && trade.acceptedBy
      && userId
      && String(trade.postedBy) === String(userId),
    );

    // Match feed rendering: poster on accepted trades sees original sides;
    // everyone else sees sides swapped to the viewer perspective.
    if (isPosterAccepted) {
      if (side === 'yours') return Array.isArray(trade.yourSide) ? trade.yourSide : [];
      return Array.isArray(trade.theirSide) ? trade.theirSide : [];
    }
    if (side === 'yours') return Array.isArray(trade.theirSide) ? trade.theirSide : [];
    return Array.isArray(trade.yourSide) ? trade.yourSide : [];
  }

  function hasAnySideFilter() {
    return Boolean(sideFilters.yours || sideFilters.theirs);
  }

  function formatFilterLabel(filter) {
    if (!filter) return '';
    return `${filter.itemName}${formatPotionsLabel(filter.potions)}`;
  }

  function sideMatchesFilter(trade, side, filter) {
    if (!filter) return true;
    const items = getViewerSideItems(trade, side);
    const target = normalizeItemName(filter.itemName);
    return items.some((item) => {
      if (normalizeItemName(item && item.name) !== target) return false;
      if (!filter.potions) return true;
      return potionsEqual(item.potions, filter.potions);
    });
  }

  function tradeMatchesSideFilter(trade) {
    return (
      sideMatchesFilter(trade, 'yours', sideFilters.yours)
      && sideMatchesFilter(trade, 'theirs', sideFilters.theirs)
    );
  }

  function applySideFilter(trades) {
    if (!hasAnySideFilter()) return trades;
    return trades.filter(tradeMatchesSideFilter);
  }

  function fingerprintTrades(trades) {
    const filterKey = [
      sideFilters.yours
        ? `yours:${normalizeItemName(sideFilters.yours.itemName)}:${potionsKey(sideFilters.yours.potions)}`
        : 'yours:none',
      sideFilters.theirs
        ? `theirs:${normalizeItemName(sideFilters.theirs.itemName)}:${potionsKey(sideFilters.theirs.potions)}`
        : 'theirs:none',
    ].join('|');
    return `${filterKey}|${trades.map((trade) => [
      trade.id,
      trade.postedAt || 0,
      trade.acceptedAt || 0,
      trade.completedAt || 0,
      trade.failedAt || 0,
    ].join(':')).join('|')}`;
  }

  function buildPotionBadgesHTML(potions) {
    if (!potions) return '';
    const badges = [];
    if (potions.mega) badges.push('<span class="trade-slot__badge trade-slot__badge--mega" aria-label="Mega">M</span>');
    if (potions.neon) badges.push('<span class="trade-slot__badge trade-slot__badge--neon" aria-label="Neon">N</span>');
    if (potions.fly) badges.push('<span class="trade-slot__badge trade-slot__badge--fly" aria-label="Fly">F</span>');
    if (potions.ride) badges.push('<span class="trade-slot__badge trade-slot__badge--ride" aria-label="Ride">R</span>');
    return badges.join('');
  }

  function getActivePotions() {
    const potions = { fly: false, ride: false, neon: false, mega: false };
    potionButtons.forEach((button) => {
      potions[button.dataset.potion] = button.classList.contains('trade-picker__potion--active');
    });
    return potions;
  }

  function setPotionActive(button, isActive) {
    if (!button) return;
    button.classList.toggle('trade-picker__potion--active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  }

  function resetPotions(applyDefaults) {
    potionButtons.forEach((button) => {
      const isDefault = applyDefaults && (button.dataset.potion === 'fly' || button.dataset.potion === 'ride');
      setPotionActive(button, isDefault);
    });
    updateDetailBadges();
  }

  function applyPotionsState(potions) {
    const normalized = normalizePotions(potions);
    potionButtons.forEach((button) => {
      setPotionActive(button, Boolean(normalized[button.dataset.potion]));
    });
    updateDetailBadges();
  }

  function updateDetailBadges() {
    if (!filterDetailBadges) return;
    if (pendingNoPotions) {
      filterDetailBadges.innerHTML = '';
      filterDetailBadges.hidden = true;
      return;
    }
    const badgeHTML = buildPotionBadgesHTML(getActivePotions());
    filterDetailBadges.innerHTML = badgeHTML;
    filterDetailBadges.hidden = !badgeHTML;
  }

  function hideFilterDetail() {
    pendingItemName = null;
    pendingItemImage = null;
    pendingNoPotions = false;
    if (filterDetail) filterDetail.hidden = true;
  }

  function showFilterDetail(itemName, itemImage, noPotions, potions) {
    pendingItemName = itemName;
    pendingItemImage = itemImage;
    pendingNoPotions = noPotions;

    if (filterDetailImg) {
      filterDetailImg.src = itemImage || '';
      filterDetailImg.alt = itemName || '';
    }
    if (filterDetailName) filterDetailName.textContent = itemName || '';
    if (filterPotionsRow) filterPotionsRow.hidden = noPotions;

    if (noPotions) {
      resetPotions(false);
    } else if (potions) {
      applyPotionsState(potions);
    } else {
      resetPotions(true);
    }

    if (filterDetail) filterDetail.hidden = false;
  }

  function syncFilterButtonState() {
    document.querySelectorAll('.trading-side-filter-btn').forEach((btn) => {
      const side = btn.dataset.side === 'theirs' ? 'theirs' : 'yours';
      const filter = sideFilters[side];
      const active = Boolean(filter);
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      if (active) {
        btn.setAttribute('title', `Filtered by ${formatFilterLabel(filter)}`);
      } else {
        btn.removeAttribute('title');
      }
    });

    if (filterClearBtn) {
      const showClear = Boolean(
        filterPickerSide && sideFilters[filterPickerSide],
      );
      filterClearBtn.hidden = !showClear;
    }
  }

  async function renderFeed(force) {
    await ensureTradesSynced();

    const emptyFilterMessage = (() => {
      if (!hasAnySideFilter()) return null;
      const parts = [];
      if (sideFilters.yours) parts.push(`${formatFilterLabel(sideFilters.yours)} on Your Side`);
      if (sideFilters.theirs) parts.push(`${formatFilterLabel(sideFilters.theirs)} on Their Side`);
      return `No ${showingAccepted ? 'accepted ' : ''}trades with ${parts.join(' and ')}.`;
    })();

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
        emptyState.textContent = emptyFilterMessage || 'No accepted trades yet.';
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
      emptyState.textContent = emptyFilterMessage || 'No trades posted yet.';
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
      const activeSideFilter = filterPickerSide ? sideFilters[filterPickerSide] : null;
      const selected = Boolean(
        (pendingItemName && normalizeItemName(pendingItemName) === normalizeItemName(item.name))
        || (
          !pendingItemName
          && activeSideFilter
          && normalizeItemName(activeSideFilter.itemName) === normalizeItemName(item.name)
        ),
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
    hideFilterDetail();
    renderFilterItems();
  }

  function openFilterPicker(side) {
    if (!filterPicker) return;
    filterPickerSide = side;
    // Keep overlay above the fixed trading shell (overflow/stacking).
    if (filterPicker.parentElement !== document.body) {
      document.body.appendChild(filterPicker);
    }
    filterPicker.hidden = false;
    filterPicker.style.display = 'flex';
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
    hideFilterDetail();
    filterPicker.hidden = true;
    filterPicker.style.display = '';
    document.body.classList.remove('trade-picker-open');
    filterPickerSide = null;
    syncFilterButtonState();
  }

  function setSideFilter(side, itemName, potions) {
    sideFilters[side] = {
      itemName,
      potions: potions ? normalizePotions(potions) : null,
    };
    syncFilterButtonState();
    closeFilterPicker();
    renderFeed(true);
  }

  function clearSideFilter(side = filterPickerSide) {
    if (side === 'yours' || side === 'theirs') {
      sideFilters[side] = null;
    }
    hideFilterDetail();
    syncFilterButtonState();
    renderFilterItems();
    renderFeed(true);
  }

  function confirmPendingFilter() {
    if (!filterPickerSide || !pendingItemName) return;
    const potions = pendingNoPotions ? null : getActivePotions();
    setSideFilter(filterPickerSide, pendingItemName, potions);
  }

  function closeTradeConfirm() {
    pendingConfirm = null;
    if (!tradeConfirm) return;
    tradeConfirm.hidden = true;
    document.body.classList.remove('trade-confirm-open');
  }

  function openTradeConfirm(tradeId, action) {
    if (!tradeConfirm || !tradeConfirmMessage) return;
    pendingConfirm = { tradeId, action };
    if (action === 'failed') {
      tradeConfirmMessage.textContent = 'Are you sure you would like to mark this trade failed?';
    } else if (action === 'delete') {
      tradeConfirmMessage.textContent = 'Are you sure you would like to delete this trade?';
    } else {
      tradeConfirmMessage.textContent = 'Are you sure you would like to mark this trade completed?';
    }
    tradeConfirm.hidden = false;
    document.body.classList.add('trade-confirm-open');
    if (tradeConfirmYes) tradeConfirmYes.focus();
  }

  async function resolveTradeConfirm(confirmed) {
    const pending = pendingConfirm;
    closeTradeConfirm();
    if (!confirmed || !pending) return;

    let ok = false;
    if (pending.action === 'failed') {
      ok = await markAcceptedTradeFailed(pending.tradeId);
    } else if (pending.action === 'delete') {
      ok = await deletePostedTrade(pending.tradeId);
    } else {
      ok = await markAcceptedTradeCompleted(pending.tradeId);
    }
    if (ok) renderFeed(true);
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
      openTradeConfirm(tradeId, 'completed');
      return;
    }

    if (event.target.closest('.posted-trade__btn--mark-failed')) {
      openTradeConfirm(tradeId, 'failed');
      return;
    }

    if (event.target.closest('.posted-trade__btn--delete')) {
      openTradeConfirm(tradeId, 'delete');
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

  document.addEventListener('click', (event) => {
    const btn = event.target.closest('.trading-side-filter-btn');
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    const side = btn.dataset.side === 'theirs' ? 'theirs' : 'yours';
    if (sideFilters[side]) {
      if (filterPicker && !filterPicker.hidden && filterPickerSide === side) {
        closeFilterPicker();
      }
      clearSideFilter(side);
      return;
    }
    openFilterPicker(side);
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
        const itemImage = itemBtn.querySelector('img')?.src || '';
        const supportsPotions = itemSupportsPotions(activeFilterCategory, itemName);

        itemBtn.closest('.trade-picker__items')?.querySelectorAll('.trade-picker__item--selected').forEach((el) => {
          el.classList.remove('trade-picker__item--selected');
        });
        itemBtn.classList.add('trade-picker__item--selected');

        if (activeFilterCategory === 'pets') {
          const activeSideFilter = sideFilters[filterPickerSide];
          const restorePotions = (
            activeSideFilter
            && normalizeItemName(activeSideFilter.itemName) === normalizeItemName(itemName)
            && activeSideFilter.potions
          ) ? activeSideFilter.potions : null;
          showFilterDetail(itemName, itemImage, !supportsPotions, restorePotions);
          return;
        }

        // Non-pet categories apply immediately (no version).
        setSideFilter(filterPickerSide, itemName, null);
      }
    });
  }

  potionButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const isActive = !button.classList.contains('trade-picker__potion--active');
      setPotionActive(button, isActive);
      if (isActive && button === neonPotion) setPotionActive(megaPotion, false);
      if (isActive && button === megaPotion) setPotionActive(neonPotion, false);
      updateDetailBadges();
    });
  });

  if (filterDetailCancel) {
    filterDetailCancel.addEventListener('click', (event) => {
      event.stopPropagation();
      hideFilterDetail();
      renderFilterItems();
    });
  }

  if (filterDetailConfirm) {
    filterDetailConfirm.addEventListener('click', (event) => {
      event.stopPropagation();
      confirmPendingFilter();
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
    if (event.key === 'Escape' && tradeConfirm && !tradeConfirm.hidden) {
      closeTradeConfirm();
      return;
    }
    if (event.key === 'Escape' && filterPicker && !filterPicker.hidden) {
      if (filterDetail && !filterDetail.hidden) {
        hideFilterDetail();
        renderFilterItems();
        return;
      }
      closeFilterPicker();
    }
  });

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
