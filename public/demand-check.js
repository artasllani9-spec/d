(function () {
  const searchInput = document.getElementById('demand-check-search');
  const grid = document.getElementById('demand-check-grid');
  const hint = document.getElementById('demand-check-hint');
  const itemsBtn = document.getElementById('demand-check-items-btn');
  const categoryMenu = document.getElementById('demand-check-category-menu');
  const categoryButtons = categoryMenu.querySelectorAll('.demand-check-category');

  const CATEGORY_CONFIG = {
    pets: {
      items: pets,
      searchPlaceholder: 'Type pet name to search...',
      emptyLabel: 'pets',
    },
    'pet-wear': {
      items: petWear,
      searchPlaceholder: 'Type pet wear name to search...',
      emptyLabel: 'pet wear',
    },
    strollers: {
      items: strollers,
      searchPlaceholder: 'Type stroller name to search...',
      emptyLabel: 'strollers',
    },
    food: {
      items: food,
      searchPlaceholder: 'Type food name to search...',
      emptyLabel: 'food',
    },
    vehicles: {
      items: vehicles,
      searchPlaceholder: 'Type vehicle name to search...',
      emptyLabel: 'vehicles',
    },
    toys: {
      items: toys,
      searchPlaceholder: 'Type toy name to search...',
      emptyLabel: 'toys',
    },
    gifts: {
      items: gifts,
      searchPlaceholder: 'Type gift name to search...',
      emptyLabel: 'gifts',
    },
    stickers: {
      items: stickers,
      searchPlaceholder: 'Type sticker name to search...',
      emptyLabel: 'stickers',
    },
    houses: {
      items: houses,
      searchPlaceholder: 'Type house name to search...',
      emptyLabel: 'houses',
    },
  };

  let activeCategory = 'pets';

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
      });
    });
  }

  function createItemCard(item) {
    const noPotions = activeCategory !== 'pets' || PETS_NO_POTIONS.has(item.name);
    const showStats = activeCategory === 'pets';
    const card = document.createElement('article');
    card.className = 'demand-check-pet-card trade-picker__pet-popout-card';
    card.dataset.petName = item.name;
    card.innerHTML = `
      <div class="trade-picker__pet-bar-media demand-check-pet-card__media">
        <div class="trade-picker__pet-bar-preview">
          <img class="trade-picker__pet-bar-img" src="${item.image}" alt="${item.name}" loading="lazy">
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
        ${showStats ? `
        <div class="demand-check-pet-card__stats">
          <p class="demand-check-pet-card__stat">Demand:</p>
          <p class="demand-check-pet-card__stat">Trend:</p>
        </div>` : ''}
      </div>
    `;

    if (!noPotions) {
      wirePotionButtons(card);
      updateCardBadges(card);
    }

    return card;
  }

  function renderItems() {
    const config = CATEGORY_CONFIG[activeCategory];
    const query = searchInput.value.trim().toLowerCase();
    const matches = query
      ? config.items.filter((item) => matchesSearchQuery(item.name, query))
      : config.items;

    grid.innerHTML = '';
    matches.forEach((item) => {
      grid.appendChild(createItemCard(item));
    });

    hint.hidden = matches.length > 0;
    hint.textContent = query ? `No ${config.emptyLabel} found` : `No ${config.emptyLabel} available`;
  }

  function setActiveCategory(category) {
    if (!CATEGORY_CONFIG[category]) return;

    activeCategory = category;
    categoryButtons.forEach((button) => {
      button.classList.toggle('demand-check-category--active', button.dataset.category === category);
    });
    searchInput.placeholder = CATEGORY_CONFIG[category].searchPlaceholder;
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
    if (event.key === 'Escape' && !categoryMenu.hidden) {
      closeCategoryMenu();
    }
  });

  searchInput.addEventListener('input', renderItems);
  renderItems();
})();
