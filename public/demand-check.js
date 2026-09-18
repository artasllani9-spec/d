(function () {
  const searchInput = document.getElementById('demand-check-search');
  const grid = document.getElementById('demand-check-grid');
  const hint = document.getElementById('demand-check-hint');
  const countEl = document.getElementById('demand-check-count');
  const categoryLabel = document.getElementById('demand-check-category-label');
  const itemsBtn = document.getElementById('demand-check-items-btn');
  const categoryMenu = document.getElementById('demand-check-category-menu');
  const categoryButtons = categoryMenu.querySelectorAll('.demand-check-category');

  const CATEGORY_CONFIG = {
    pets: {
      items: petsByUsd,
      label: 'Pets',
      searchPlaceholder: 'Type pet name to search...',
      emptyLabel: 'pets',
    },
    'pet-wear': {
      items: petWear,
      label: 'Pet Wear',
      searchPlaceholder: 'Type pet wear name to search...',
      emptyLabel: 'pet wear',
    },
    strollers: {
      items: strollers,
      label: 'Strollers',
      searchPlaceholder: 'Type stroller name to search...',
      emptyLabel: 'strollers',
    },
    food: {
      items: food,
      label: 'Food',
      searchPlaceholder: 'Type food name to search...',
      emptyLabel: 'food',
    },
    vehicles: {
      items: vehicles,
      label: 'Vehicles',
      searchPlaceholder: 'Type vehicle name to search...',
      emptyLabel: 'vehicles',
    },
    toys: {
      items: toys,
      label: 'Toys',
      searchPlaceholder: 'Type toy name to search...',
      emptyLabel: 'toys',
    },
    gifts: {
      items: gifts,
      label: 'Gifts',
      searchPlaceholder: 'Type gift name to search...',
      emptyLabel: 'gifts',
    },
    stickers: {
      items: stickers,
      label: 'Stickers',
      searchPlaceholder: 'Type sticker name to search...',
      emptyLabel: 'stickers',
    },
    houses: {
      items: houses,
      label: 'Houses',
      searchPlaceholder: 'Type house name to search...',
      emptyLabel: 'houses',
    },
  };

  let activeCategory = 'pets';
  let canEditValues = false;
  let editTarget = null;

  const editModal = document.getElementById('value-edit-modal');
  const editTitle = document.getElementById('value-edit-title');
  const editNameEl = document.getElementById('value-edit-name');
  const editFields = document.getElementById('value-edit-fields');
  const editStatus = document.getElementById('value-edit-status');
  const editSaveBtn = document.getElementById('value-edit-save');

  const EDIT_PENCIL_SVG = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 20h4.5L19 9.5 14.5 5 4 15.5V20z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="M12.8 6.7l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
  `;

  function debounce(fn, wait) {
    let timer = null;
    return function debounced() {
      const ctx = this;
      const args = arguments;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn.apply(ctx, args);
      }, wait);
    };
  }

  function buildPotionBadgesHTML(potions) {
    const badges = [];
    if (potions.mega) badges.push('<span class="trade-slot__badge trade-slot__badge--mega" aria-label="Mega">M</span>');
    if (potions.neon) badges.push('<span class="trade-slot__badge trade-slot__badge--neon" aria-label="Neon">N</span>');
    if (potions.fly) badges.push('<span class="trade-slot__badge trade-slot__badge--fly" aria-label="Fly">F</span>');
    if (potions.ride) badges.push('<span class="trade-slot__badge trade-slot__badge--ride" aria-label="Ride">R</span>');
    if (badges.length === 0) return '';
    return badges.join('');
  }

  function getCardPotions(card) {
    const potions = { fly: false, ride: false, neon: false, mega: false };
    card.querySelectorAll('.trade-picker__potion').forEach((button) => {
      potions[button.dataset.potion] = button.classList.contains('trade-picker__potion--active');
    });
    return potions;
  }

  function updateCardBadges(card) {
    const badges = card.querySelector('.trade-picker__pet-bar-badges');
    if (!badges) return;
    const badgeHTML = buildPotionBadgesHTML(getCardPotions(card));
    badges.innerHTML = badgeHTML;
    badges.hidden = !badgeHTML;
  }

  function updateCardUsd(card) {
    const amountEl = card.querySelector('.demand-check-value__amount');
    if (!amountEl) return;
    const itemName = card.dataset.petName;
    const potions = getCardPotions(card);
    amountEl.textContent = formatUsdValue(getAmvggUsdValue(itemName, potions));
  }

  function setPotionActive(button, isActive) {
    button.classList.toggle('trade-picker__potion--active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  }

  function wirePotionButtons(card) {
    const neonPotion = card.querySelector('[data-potion="neon"]');
    const megaPotion = card.querySelector('[data-potion="mega"]');

    card.querySelectorAll('.trade-picker__potion').forEach((button) => {
      button.addEventListener('click', () => {
        const isActive = !button.classList.contains('trade-picker__potion--active');
        setPotionActive(button, isActive);

        if (isActive && button === neonPotion) {
          setPotionActive(megaPotion, false);
        } else if (isActive && button === megaPotion) {
          setPotionActive(neonPotion, false);
        }

        updateCardBadges(card);
        updateCardUsd(card);
      });
    });
  }

  function createItemCard(item) {
    const isPetCard = activeCategory === 'pets';
    const noPotions = !isPetCard || PETS_NO_POTIONS.has(item.name);
    const defaultPotions = { fly: true, ride: true, neon: false, mega: false };
    const usdAmount = noPotions
      ? getAmvggUsdValue(item.name)
      : getAmvggUsdValue(item.name, defaultPotions);
    const usdDisplay = formatUsdValue(usdAmount);
    const card = document.createElement('article');
    card.className = 'demand-check-pet-card trade-picker__pet-popout-card';
    card.dataset.petName = item.name;
    card.dataset.itemKind = isPetCard ? 'pet' : 'item';
    card.innerHTML = `
      ${canEditValues ? `<button type="button" class="demand-check-pet-card__edit" aria-label="Edit value of ${item.name}">${EDIT_PENCIL_SVG}</button>` : ''}
      <div class="trade-picker__pet-bar-media demand-check-pet-card__media">
        <div class="trade-picker__pet-bar-preview">
          <img class="trade-picker__pet-bar-img" src="${item.image}" alt="${item.name}" loading="lazy" decoding="async" width="88" height="88">
          <div class="trade-picker__pet-bar-badges trade-slot__badges" hidden></div>
        </div>
        <div class="trade-picker__potions demand-check-pet-card__potions"${noPotions ? ' hidden' : ''}>
          <button type="button" class="trade-picker__potion trade-picker__potion--fly trade-picker__potion--active" data-potion="fly" aria-label="Fly" aria-pressed="true">F</button>
          <button type="button" class="trade-picker__potion trade-picker__potion--ride trade-picker__potion--active" data-potion="ride" aria-label="Ride" aria-pressed="true">R</button>
          <button type="button" class="trade-picker__potion trade-picker__potion--neon" data-potion="neon" aria-label="Neon" aria-pressed="false">N</button>
          <button type="button" class="trade-picker__potion trade-picker__potion--mega" data-potion="mega" aria-label="Mega" aria-pressed="false">M</button>
        </div>
      </div>
      <div class="trade-picker__pet-bar-info">
        <span class="trade-picker__pet-bar-name">${item.name}</span>
        <div class="demand-check-pet-card__stats">
          <div class="demand-check-value">
            <span class="demand-check-value__label">USD Value:</span>
            <span class="demand-check-value__amount">${usdDisplay}</span>
          </div>
        </div>
      </div>
    `;

    if (!noPotions) {
      wirePotionButtons(card);
      updateCardBadges(card);
    }

    if (canEditValues) {
      const editBtn = card.querySelector('.demand-check-pet-card__edit');
      if (editBtn) {
        editBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          openValueEditor(item.name, isPetCard ? 'pet' : 'item');
        });
      }
    }

    return card;
  }

  function setEditStatus(message, isError) {
    if (!editStatus) return;
    editStatus.hidden = !message;
    editStatus.textContent = message || '';
    editStatus.classList.toggle('value-edit-modal__status--error', Boolean(isError));
  }

  function closeValueEditor() {
    editTarget = null;
    if (editModal) editModal.hidden = true;
    setEditStatus('', false);
  }

  function openValueEditor(itemName, kind) {
    if (!editModal || !editFields || !editNameEl) return;
    editTarget = { name: itemName, kind };
    editNameEl.textContent = itemName;
    if (editTitle) editTitle.textContent = kind === 'pet' ? 'Edit pet values' : 'Edit item value';

    if (kind === 'pet') {
      const variantKeys =
        typeof AMVGG_PET_VARIANT_KEYS !== 'undefined'
          ? AMVGG_PET_VARIANT_KEYS
          : ['', 'f', 'r', 'fr', 'n', 'nf', 'nr', 'nfr', 'm', 'mf', 'mr', 'mfr'];
      editFields.classList.add('value-edit-modal__fields--variants');
      editFields.innerHTML = variantKeys
        .map((key) => {
          const potions =
            typeof potionsFromKey === 'function'
              ? potionsFromKey(key)
              : { fly: false, ride: false, neon: false, mega: false };
          const amount = getAmvggUsdValue(itemName, potions);
          const label = key === '' ? 'Blank' : key.toUpperCase();
          const fieldId = `value-edit-${key === '' ? 'blank' : key}`;
          return `
        <div class="value-edit-modal__field">
          <label for="${fieldId}">${label}</label>
          <input id="${fieldId}" data-variant-key="${key}" type="number" min="0" step="any" value="${
            amount != null ? amount : ''
          }" inputmode="decimal">
        </div>`;
        })
        .join('');
    } else {
      editFields.classList.remove('value-edit-modal__fields--variants');
      const value = getAmvggUsdValue(itemName);
      editFields.innerHTML = `
        <div class="value-edit-modal__field">
          <label for="value-edit-flat">USD Value</label>
          <input id="value-edit-flat" type="number" min="0" step="any" value="${value != null ? value : ''}" inputmode="decimal">
        </div>
      `;
    }

    setEditStatus('', false);
    editModal.hidden = false;
    const firstInput = editFields.querySelector('input');
    if (firstInput) firstInput.focus();
  }

  async function saveValueEditor() {
    if (!editTarget) return;
    setEditStatus('Saving…', false);

    let body;
    if (editTarget.kind === 'pet') {
      const values = {};
      const inputs = editFields.querySelectorAll('input[data-variant-key]');
      for (const input of inputs) {
        const key = input.getAttribute('data-variant-key');
        const amount = Number(input.value);
        if (!Number.isFinite(amount) || amount < 0) {
          const label = key === '' ? 'Blank' : String(key).toUpperCase();
          setEditStatus(`Enter a valid ${label} value.`, true);
          return;
        }
        values[key] = amount;
      }
      if (
        ![values.fr, values.nfr, values.mfr].every((n) => Number.isFinite(n) && n >= 0)
      ) {
        setEditStatus('FR, NFR, and MFR are required.', true);
        return;
      }
      body = { name: editTarget.name, kind: 'pet', values };
    } else {
      const value = Number(document.getElementById('value-edit-flat')?.value);
      if (!Number.isFinite(value) || value < 0) {
        setEditStatus('Enter a valid USD value.', true);
        return;
      }
      body = { name: editTarget.name, kind: 'item', value };
    }

    try {
      const response = await fetch('/api/values/item', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || 'Could not save value.');
      }

      if (typeof globalThis !== 'undefined') {
        globalThis.__VALUE_OVERRIDES = {
          pets: data.pets || {},
          items: data.items || {},
          customPets: data.customPets || {},
          customItems: data.customItems || {},
          acronyms: data.acronyms || {},
        };
      }
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new Event('valueoverridesready'));
      }

      closeValueEditor();
      renderItems();
    } catch (error) {
      setEditStatus((error && error.message) || 'Could not save value.', true);
    }
  }

  if (editModal) {
    editModal.addEventListener('click', (event) => {
      if (event.target.closest('[data-value-edit-close]')) {
        closeValueEditor();
      }
    });
  }
  if (editSaveBtn) {
    editSaveBtn.addEventListener('click', () => {
      void saveValueEditor();
    });
  }

  function renderItems() {
    const config = CATEGORY_CONFIG[activeCategory];
    const query = searchInput.value.trim().toLowerCase();
    const matches = query
      ? config.items.filter((item) => matchesSearchQuery(item.name, query))
      : config.items;

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < matches.length; i += 1) {
      fragment.appendChild(createItemCard(matches[i]));
    }
    grid.replaceChildren(fragment);

    hint.hidden = matches.length > 0;
    hint.textContent = query ? `No ${config.emptyLabel} found` : `No ${config.emptyLabel} available`;

    if (countEl) {
      const noun = config.emptyLabel;
      countEl.textContent = `${matches.length.toLocaleString()} ${noun}`;
    }
  }

  function setActiveCategory(category) {
    if (!CATEGORY_CONFIG[category]) return;

    activeCategory = category;
    const config = CATEGORY_CONFIG[category];
    categoryButtons.forEach((button) => {
      button.classList.toggle('demand-check-category--active', button.dataset.category === category);
    });
    if (categoryLabel) {
      categoryLabel.textContent = config.label;
    }
    searchInput.placeholder = config.searchPlaceholder;
    searchInput.value = '';
    renderItems();
  }

  function openCategoryMenu() {
    categoryMenu.hidden = false;
    itemsBtn.setAttribute('aria-expanded', 'true');
  }

  function closeCategoryMenu() {
    categoryMenu.hidden = true;
    itemsBtn.setAttribute('aria-expanded', 'false');
  }

  function toggleCategoryMenu() {
    if (categoryMenu.hidden) {
      openCategoryMenu();
    } else {
      closeCategoryMenu();
    }
  }

  itemsBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleCategoryMenu();
  });

  categoryButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setActiveCategory(button.dataset.category);
      closeCategoryMenu();
    });
  });

  document.addEventListener('click', (event) => {
    if (!categoryMenu.hidden && !event.target.closest('.demand-check-items-wrap')) {
      closeCategoryMenu();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (editModal && !editModal.hidden) {
        closeValueEditor();
        return;
      }
      if (!categoryMenu.hidden) {
        closeCategoryMenu();
      }
    }
  });

  searchInput.addEventListener('input', debounce(renderItems, 120));

  function bootDemandCheck() {
    if (CATEGORY_CONFIG.pets) {
      CATEGORY_CONFIG.pets.items = typeof petsByUsd !== 'undefined' ? petsByUsd : CATEGORY_CONFIG.pets.items;
    }
    renderItems();
  }

  function loadEditorAccess() {
    if (!window.__demandggAuthMePromise) {
      window.__demandggAuthMePromise = fetch('/api/auth/me', { credentials: 'same-origin' })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
    }
    return window.__demandggAuthMePromise
      .then((data) => {
        canEditValues = Boolean(
          data && data.roles && (data.roles.isValueEditor || data.roles.isOwner)
        );
      })
      .catch(() => {
        canEditValues = false;
      });
  }

  const ready = window.valueOverridesReady;
  Promise.all([
    loadEditorAccess(),
    ready && typeof ready.then === 'function' ? ready.catch(() => null) : Promise.resolve(),
  ])
    .then(bootDemandCheck)
    .catch(bootDemandCheck);
})();
