(function () {
  function rebuildPetsByUsd() {
    if (typeof pets === 'undefined' || typeof sortItemsByUsdDesc !== 'function') return;
    const sorted = sortItemsByUsdDesc(pets);
    if (typeof petsByUsd !== 'undefined' && Array.isArray(petsByUsd)) {
      petsByUsd.splice(0, petsByUsd.length, ...sorted);
    } else {
      // eslint-disable-next-line no-undef
      petsByUsd = sorted;
    }
  }

  function applyOverrides(data) {
    globalThis.__VALUE_OVERRIDES = {
      pets: (data && data.pets) || {},
      items: (data && data.items) || {},
      updatedAt: data && data.updatedAt != null ? data.updatedAt : null,
    };
    globalThis.__ITEM_ACRONYMS = (data && data.acronyms) || {};
    rebuildPetsByUsd();
  }

  window.valueOverridesReady = (async function loadValueOverrides() {
    try {
      const response = await fetch('/api/values/overrides', { cache: 'no-store' });
      if (!response.ok) {
        applyOverrides({ pets: {}, items: {}, acronyms: {} });
        return null;
      }
      const data = await response.json();
      applyOverrides(data);
      return data;
    } catch (err) {
      applyOverrides({ pets: {}, items: {}, acronyms: {} });
      return null;
    } finally {
      window.dispatchEvent(new Event('valueoverridesready'));
    }
  })();
})();
