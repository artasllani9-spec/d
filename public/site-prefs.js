(function () {
  var THEMES = [
    { id: 'red', label: 'Red', swatch: '#ff3a3a' },
    { id: 'blue', label: 'Blue', swatch: '#3a8bff' },
    { id: 'green', label: 'Green', swatch: '#2ee06a' },
    { id: 'purple', label: 'Purple', swatch: '#b44aff' },
    { id: 'orange', label: 'Orange', swatch: '#ff8a2a' },
    { id: 'pink', label: 'Pink', swatch: '#ff4f9a' },
    { id: 'cyan', label: 'Cyan', swatch: '#2ad4ff' },
    { id: 'gold', label: 'Gold', swatch: '#f0c14a' },
    { id: 'gray', label: 'Gray', swatch: '#a3a3ab' }
  ];

  var CURRENCIES = [
    { code: 'USD', label: 'USD', symbol: '$', decimals: 2 },
    { code: 'EUR', label: 'Euro', symbol: '€', decimals: 2 },
    { code: 'CAD', label: 'CAD', symbol: 'CA$', decimals: 2 },
    { code: 'GBP', label: 'GBP', symbol: '£', decimals: 2 },
    { code: 'AUD', label: 'AUD', symbol: 'A$', decimals: 2 },
    { code: 'JPY', label: 'JPY', symbol: '¥', decimals: 0 },
    { code: 'CHF', label: 'CHF', symbol: 'CHF ', decimals: 2 },
    { code: 'INR', label: 'INR', symbol: '₹', decimals: 2 },
    { code: 'MXN', label: 'MXN', symbol: 'MX$', decimals: 2 },
    { code: 'BRL', label: 'BRL', symbol: 'R$', decimals: 2 }
  ];

  var FALLBACK_RATES = {
    USD: 1,
    EUR: 0.92,
    CAD: 1.36,
    GBP: 0.76,
    AUD: 1.52,
    JPY: 149,
    CHF: 0.86,
    INR: 84,
    MXN: 18.4,
    BRL: 5.4
  };

  var THEME_KEY = 'vd-theme';
  var CURRENCY_KEY = 'vd-currency';
  var RATES_KEY = 'vd-fx';
  var RATES_MAX_AGE = 12 * 60 * 60 * 1000;

  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      /* ignore private-mode storage failures */
    }
  }

  function currencyByCode(code) {
    for (var i = 0; i < CURRENCIES.length; i += 1) {
      if (CURRENCIES[i].code === code) return CURRENCIES[i];
    }
    return CURRENCIES[0];
  }

  function themeById(id) {
    for (var i = 0; i < THEMES.length; i += 1) {
      if (THEMES[i].id === id) return THEMES[i];
    }
    return THEMES[0];
  }

  var state = {
    theme: themeById(readStorage(THEME_KEY)).id,
    currency: currencyByCode(readStorage(CURRENCY_KEY)).code,
    rates: Object.assign({}, FALLBACK_RATES)
  };

  function loadCachedRates() {
    var raw = readStorage(RATES_KEY);
    if (!raw) return;
    try {
      var saved = JSON.parse(raw);
      if (!saved || !saved.rates) return;
      Object.keys(FALLBACK_RATES).forEach(function (code) {
        var rate = Number(saved.rates[code]);
        if (code !== 'USD' && Number.isFinite(rate) && rate > 0) state.rates[code] = rate;
      });
    } catch (error) {
      /* keep fallback rates */
    }
  }

  function tidy(amount, zeroDecimals) {
    if (zeroDecimals) return Math.round(amount);
    if (amount < 1) return Math.round(amount * 100) / 100;
    if (amount < 10) return Math.ceil(amount * 10) / 10;
    if (amount < 50) return Math.ceil(amount * 2) / 2;
    return Math.round(amount);
  }

  function applyTheme(id) {
    state.theme = themeById(id).id;
    document.documentElement.setAttribute('data-theme', state.theme);
    writeStorage(THEME_KEY, state.theme);
    syncThemeSwatch();
  }

  function present(amount) {
    var entry = currencyByCode(state.currency);
    var rate = state.currency === 'USD' ? 1 : state.rates[state.currency];
    if (!Number.isFinite(rate) || rate <= 0) rate = 1;
    var shown = state.currency === 'USD' ? amount : tidy(amount * rate, entry.decimals === 0);
    return {
      shown: shown,
      symbol: entry.symbol,
      zeroDecimals: entry.decimals === 0
    };
  }

  function toUsd(amount, code) {
    var currency = code || state.currency;
    if (currency === 'USD') return amount;
    var rate = state.rates[currency];
    if (!Number.isFinite(rate) || rate <= 0) return amount;
    return amount / rate;
  }

  function emitCurrency(previous) {
    repaintTaggedAmounts();
    window.dispatchEvent(new CustomEvent('vd-currency-change', {
      detail: { currency: state.currency, previous: previous || state.currency }
    }));
  }

  function setCurrency(code) {
    var previous = state.currency;
    state.currency = currencyByCode(code).code;
    writeStorage(CURRENCY_KEY, state.currency);
    syncCurrencyLabel();
    emitCurrency(previous);
  }

  function repaintTaggedAmounts() {
    if (typeof formatUsdValue !== 'function') return;
    document.querySelectorAll('[data-usd-value]').forEach(function (el) {
      var tag = el.querySelector('.trade-slot__usd-tag');
      var amount = Number(el.getAttribute('data-usd-value'));
      if (!tag || !Number.isFinite(amount)) return;
      tag.textContent = formatUsdValue(amount);
    });
  }

  loadCachedRates();
  applyTheme(state.theme);

  globalThis.ValueDexPrefs = {
    get currency() { return state.currency; },
    get theme() { return state.theme; },
    present: present,
    toUsd: toUsd,
    valueLabel: function () { return currencyByCode(state.currency).label; }
  };

  var root = null;
  var menu = null;
  var currencyFlyout = null;
  var themeFlyout = null;
  var currencyLabel = null;
  var themeSwatch = null;
  var openPanel = '';

  function syncCurrencyLabel() {
    if (!currencyLabel) return;
    currencyLabel.textContent = currencyByCode(state.currency).label;
    if (!currencyFlyout) return;
    currencyFlyout.querySelectorAll('[data-currency]').forEach(function (button) {
      var active = button.getAttribute('data-currency') === state.currency;
      button.classList.toggle('site-settings__choice--active', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  function syncThemeSwatch() {
    var theme = themeById(state.theme);
    if (themeSwatch) themeSwatch.style.background = theme.swatch;
    if (!themeFlyout) return;
    themeFlyout.querySelectorAll('[data-theme-choice]').forEach(function (button) {
      var active = button.getAttribute('data-theme-choice') === state.theme;
      button.classList.toggle('site-settings__color--active', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  function closeFlyouts() {
    openPanel = '';
    if (currencyFlyout) currencyFlyout.hidden = true;
    if (themeFlyout) themeFlyout.hidden = true;
    if (!menu) return;
    menu.style.transform = '';
    menu.querySelectorAll('[data-settings-panel]').forEach(function (button) {
      button.classList.remove('site-settings__item--open');
      button.setAttribute('aria-expanded', 'false');
    });
  }

  function closeMenu() {
    if (!menu) return;
    menu.hidden = true;
    closeFlyouts();
    var toggle = root && root.querySelector('.site-settings__btn');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  function placeFlyout(flyout) {
    if (!menu || !flyout) return;
    menu.style.transform = '';
    var menuRect = menu.getBoundingClientRect();
    var width = flyout.offsetWidth || 168;
    var spaceRight = window.innerWidth - menuRect.right;
    if (spaceRight < width + 12) {
      menu.style.transform = 'translateX(-' + Math.ceil(width + 12 - spaceRight) + 'px)';
    }
  }

  function openPanelFor(name, item) {
    var flyout = name === 'currency' ? currencyFlyout : themeFlyout;
    var already = openPanel === name;
    closeFlyouts();
    if (already || !flyout) return;
    openPanel = name;
    flyout.hidden = false;
    flyout.style.top = item.offsetTop + 'px';
    item.classList.add('site-settings__item--open');
    item.setAttribute('aria-expanded', 'true');
    placeFlyout(flyout);
  }

  function gearIcon() {
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.52-.4-1.08-.73-1.69-.98l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.61.25-1.17.59-1.69.98l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.52.4 1.08.73 1.69.98l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.61-.25 1.17-.59 1.69-.98l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/>' +
      '</svg>';
  }

  function buildMenu() {
    menu = document.createElement('div');
    menu.className = 'site-settings__menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');

    var currencyBtn = document.createElement('button');
    currencyBtn.type = 'button';
    currencyBtn.className = 'site-settings__item';
    currencyBtn.setAttribute('data-settings-panel', 'currency');
    currencyBtn.setAttribute('aria-expanded', 'false');
    currencyBtn.setAttribute('aria-haspopup', 'true');
    currencyLabel = document.createElement('span');
    currencyLabel.className = 'site-settings__current';
    currencyBtn.innerHTML = '<span>Currency</span>';
    currencyBtn.appendChild(currencyLabel);
    currencyBtn.insertAdjacentHTML('beforeend', '<span class="site-settings__chevron" aria-hidden="true"></span>');
    currencyBtn.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      openPanelFor('currency', currencyBtn);
    });

    var themeBtn = document.createElement('button');
    themeBtn.type = 'button';
    themeBtn.className = 'site-settings__item';
    themeBtn.setAttribute('data-settings-panel', 'theme');
    themeBtn.setAttribute('aria-expanded', 'false');
    themeBtn.setAttribute('aria-haspopup', 'true');
    themeSwatch = document.createElement('span');
    themeSwatch.className = 'site-settings__current-swatch';
    themeSwatch.setAttribute('aria-hidden', 'true');
    themeBtn.innerHTML = '<span>Theme</span>';
    themeBtn.appendChild(themeSwatch);
    themeBtn.insertAdjacentHTML('beforeend', '<span class="site-settings__chevron" aria-hidden="true"></span>');
    themeBtn.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      openPanelFor('theme', themeBtn);
    });

    currencyFlyout = document.createElement('div');
    currencyFlyout.className = 'site-settings__flyout';
    currencyFlyout.hidden = true;
    currencyFlyout.setAttribute('role', 'menu');
    CURRENCIES.forEach(function (entry) {
      var choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'site-settings__choice';
      choice.setAttribute('data-currency', entry.code);
      choice.setAttribute('role', 'menuitemradio');
      choice.textContent = entry.label;
      choice.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        setCurrency(entry.code);
        closeMenu();
      });
      currencyFlyout.appendChild(choice);
    });

    themeFlyout = document.createElement('div');
    themeFlyout.className = 'site-settings__flyout site-settings__flyout--colors';
    themeFlyout.hidden = true;
    themeFlyout.setAttribute('role', 'menu');
    THEMES.forEach(function (entry) {
      var choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'site-settings__color';
      choice.style.background = entry.swatch;
      choice.setAttribute('data-theme-choice', entry.id);
      choice.setAttribute('role', 'menuitemradio');
      choice.setAttribute('aria-label', entry.label);
      choice.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        applyTheme(entry.id);
        closeMenu();
      });
      themeFlyout.appendChild(choice);
    });

    menu.appendChild(currencyBtn);
    menu.appendChild(themeBtn);
    menu.appendChild(currencyFlyout);
    menu.appendChild(themeFlyout);
    syncCurrencyLabel();
    syncThemeSwatch();
    return menu;
  }

  function mount() {
    var login = document.querySelector('.login-btn');
    if (!login || document.querySelector('.site-settings')) return;

    var actions = document.querySelector('.header-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'header-actions';
      var account = login.closest('.account-menu');
      var anchor = account || login;
      anchor.parentNode.insertBefore(actions, anchor);
      actions.appendChild(anchor);
    }

    root = document.createElement('div');
    root.className = 'site-settings';

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'site-settings__btn';
    toggle.setAttribute('aria-label', 'Settings');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-haspopup', 'true');
    toggle.innerHTML = gearIcon();
    toggle.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      var willOpen = menu.hidden;
      if (willOpen) {
        menu.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
      } else {
        closeMenu();
      }
    });

    root.appendChild(toggle);
    root.appendChild(buildMenu());
    actions.insertBefore(root, actions.firstChild);
  }

  document.addEventListener('click', function (event) {
    if (!root || !menu || menu.hidden) return;
    if (root.contains(event.target)) return;
    closeMenu();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeMenu();
  });

  function refreshRates() {
    var raw = readStorage(RATES_KEY);
    var fresh = false;
    if (raw) {
      try {
        var saved = JSON.parse(raw);
        fresh = saved && saved.at && (Date.now() - saved.at) < RATES_MAX_AGE;
      } catch (error) {
        fresh = false;
      }
    }
    if (fresh) return;
    var codes = CURRENCIES.map(function (entry) { return entry.code; }).filter(function (code) {
      return code !== 'USD';
    }).join(',');
    fetch('https://api.frankfurter.app/latest?from=USD&to=' + codes)
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (!data || !data.rates) return;
        var next = { USD: 1 };
        var changed = false;
        Object.keys(data.rates).forEach(function (code) {
          var rate = Number(data.rates[code]);
          if (!Number.isFinite(rate) || rate <= 0) return;
          if (state.rates[code] !== rate) changed = true;
          next[code] = rate;
          state.rates[code] = rate;
        });
        writeStorage(RATES_KEY, JSON.stringify({ at: Date.now(), rates: state.rates }));
        if (changed && state.currency !== 'USD') emitCurrency();
      })
      .catch(function () { /* keep cached or fallback rates */ });
  }

  function start() {
    mount();
    refreshRates();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
