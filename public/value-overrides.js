(function () {
  function getCategoryList(category) {
    switch (category) {
      case 'pet-wear':
        return typeof petWear !== 'undefined' ? petWear : null;
      case 'strollers':
        return typeof strollers !== 'undefined' ? strollers : null;
      case 'food':
        return typeof food !== 'undefined' ? food : null;
      case 'vehicles':
        return typeof vehicles !== 'undefined' ? vehicles : null;
      case 'toys':
        return typeof toys !== 'undefined' ? toys : null;
      case 'gifts':
        return typeof gifts !== 'undefined' ? gifts : null;
      case 'stickers':
        return typeof stickers !== 'undefined' ? stickers : null;
      case 'houses':
        return typeof houses !== 'undefined' ? houses : null;
      default:
        return null;
    }
  }

  function upsertNamedItem(list, name, image) {
    if (!Array.isArray(list)) return false;
    const existing = list.find((item) => item && item.name === name);
    if (existing) {
      existing.image = image || existing.image;
      return false;
    }
    list.push({ name, image: image || '' });
    return true;
  }

  function removeNamedItem(list, name) {
    if (!Array.isArray(list)) return;
    const index = list.findIndex((item) => item && item.name === name);
    if (index >= 0) list.splice(index, 1);
  }

  function isBuiltinPetName(name) {
    return (
      typeof AMVGG_PET_PRICING !== 'undefined' &&
      Object.prototype.hasOwnProperty.call(AMVGG_PET_PRICING, name)
    );
  }

  function isBuiltinFlatItemName(name) {
    return (
      typeof AMVGG_USD_VALUES !== 'undefined' &&
      Object.prototype.hasOwnProperty.call(AMVGG_USD_VALUES, name) &&
      !isBuiltinPetName(name)
    );
  }

  const injectedCustomPets = new Set();
  const injectedCustomItems = new Map();

  function applyCustomCatalog(data) {
    const customPets = (data && data.customPets) || {};
    const customItems = (data && data.customItems) || {};

    for (const name of [...injectedCustomPets]) {
      if (!Object.prototype.hasOwnProperty.call(customPets, name)) {
        if (!isBuiltinPetName(name)) {
          removeNamedItem(typeof pets !== 'undefined' ? pets : null, name);
        }
        injectedCustomPets.delete(name);
      }
    }

    for (const [name, category] of [...injectedCustomItems.entries()]) {
      const entry = customItems[name];
      if (!entry || entry.category !== category) {
        if (!isBuiltinFlatItemName(name)) {
          removeNamedItem(getCategoryList(category), name);
        }
        injectedCustomItems.delete(name);
      }
    }

    Object.keys(customPets).forEach((name) => {
      const entry = customPets[name];
      if (!entry) return;
      upsertNamedItem(typeof pets !== 'undefined' ? pets : null, name, entry.image);
      injectedCustomPets.add(name);
    });

    Object.keys(customItems).forEach((name) => {
      const entry = customItems[name];
      if (!entry) return;
      upsertNamedItem(getCategoryList(entry.category), name, entry.image);
      injectedCustomItems.set(name, entry.category);
    });
  }

  function rebuildPetsByUsd() {
    if (typeof sortAllCatalogListsByUsd === 'function') {
      sortAllCatalogListsByUsd();
      return;
    }
    if (typeof pets === 'undefined' || typeof sortItemsByUsdDesc !== 'function') return;
    const sorted = sortItemsByUsdDesc(pets);
    if (typeof petsByUsd !== 'undefined' && Array.isArray(petsByUsd)) {
      petsByUsd.splice(0, petsByUsd.length, ...sorted);
    } else if (typeof globalThis !== 'undefined') {
      globalThis.petsByUsd = sorted;
    }
  }

  function applyOverrides(data) {
    const petsMap = { ...((data && data.pets) || {}) };
    const itemsMap = { ...((data && data.items) || {}) };
    const customPets = (data && data.customPets) || {};
    const customItems = (data && data.customItems) || {};

    Object.keys(customPets).forEach((name) => {
      const entry = customPets[name];
      if (!entry) return;
      petsMap[name] = { fr: entry.fr, nfr: entry.nfr, mfr: entry.mfr };
    });
    Object.keys(customItems).forEach((name) => {
      const entry = customItems[name];
      if (!entry) return;
      itemsMap[name] = entry.value;
    });

    globalThis.__VALUE_OVERRIDES = {
      pets: petsMap,
      items: itemsMap,
      customPets,
      customItems,
      updatedAt: data && data.updatedAt != null ? data.updatedAt : null,
    };
    globalThis.__ITEM_ACRONYMS = (data && data.acronyms) || {};
    applyCustomCatalog(data);
    rebuildPetsByUsd();
  }

  window.valueOverridesReady = (async function loadValueOverrides() {
    try {
      const response = await fetch('/api/values/overrides', { cache: 'no-store' });
      if (!response.ok) {
        applyOverrides({ pets: {}, items: {}, acronyms: {}, customPets: {}, customItems: {} });
        return null;
      }
      const data = await response.json();
      applyOverrides(data);
      return data;
    } catch (err) {
      applyOverrides({ pets: {}, items: {}, acronyms: {}, customPets: {}, customItems: {} });
      return null;
    } finally {
      window.dispatchEvent(new Event('valueoverridesready'));
    }
  })();
})();
