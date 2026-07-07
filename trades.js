const POSTED_TRADES_KEY = 'demandgg-posted-trades';
const ACCEPTED_TRADES_KEY = 'demandgg-accepted-trades';
const FAILED_TRADES_KEY = 'demandgg-failed-trades';
const VIEW_TRADE_SESSION_KEY = 'demandgg-view-trade';
const USER_ID_KEY = 'demandgg-user-id';
const MAX_STORED_TRADES = 100;
const TRADES_API_BASE = '/api/trades';

let postedTradesCache = [];
let acceptedTradesCache = [];
let tradesSyncPromise = null;

function usesTradeApi() {
  return typeof window !== 'undefined' && window.location.protocol !== 'file:';
}

function readLocalPostedTrades() {
  try {
    const trades = JSON.parse(localStorage.getItem(POSTED_TRADES_KEY) || '[]');
    return Array.isArray(trades) ? trades : [];
  } catch {
    return [];
  }
}

function readLocalAcceptedTrades() {
  try {
    const trades = JSON.parse(localStorage.getItem(ACCEPTED_TRADES_KEY) || '[]');
    return Array.isArray(trades) ? trades : [];
  } catch {
    return [];
  }
}

function writeLocalPostedTrades(trades) {
  localStorage.setItem(POSTED_TRADES_KEY, JSON.stringify(trades.slice(0, MAX_STORED_TRADES)));
}

function writeLocalAcceptedTrades(trades) {
  localStorage.setItem(ACCEPTED_TRADES_KEY, JSON.stringify(trades.slice(0, MAX_STORED_TRADES)));
}

async function tradeApiRequest(path, options = {}) {
  const response = await fetch(`${TRADES_API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    let message = 'Trade request failed.';
    try {
      const data = await response.json();
      if (data?.message) message = data.message;
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function refreshTradesFromServer() {
  if (!usesTradeApi()) {
    postedTradesCache = readLocalPostedTrades();
    acceptedTradesCache = readLocalAcceptedTrades();
    return;
  }

  const userId = getCurrentUserId();
  const requests = [tradeApiRequest('/posted')];
  if (userId) {
    requests.push(tradeApiRequest(`/accepted?userId=${encodeURIComponent(userId)}`));
  }

  const [posted, accepted] = await Promise.all(requests);
  postedTradesCache = Array.isArray(posted) ? posted : [];
  acceptedTradesCache = Array.isArray(accepted) ? accepted : [];
}

function ensureTradesSynced() {
  if (!tradesSyncPromise) {
    tradesSyncPromise = refreshTradesFromServer().catch(() => {
      if (!usesTradeApi()) return;
      postedTradesCache = readLocalPostedTrades();
      acceptedTradesCache = readLocalAcceptedTrades();
    }).finally(() => {
      tradesSyncPromise = null;
    });
  }
  return tradesSyncPromise;
}

function getPostedTrades() {
  return postedTradesCache;
}

function getPostedTradeById(id) {
  return getPostedTrades().find((trade) => trade.id === id) ?? null;
}

function getAcceptedTrades() {
  return acceptedTradesCache;
}

function getAcceptedTradeById(id) {
  return getAcceptedTrades().find((trade) => trade.id === id) ?? null;
}

function getAcceptedTradesForUser() {
  const userId = getCurrentUserId();
  if (!userId) return [];

  migrateFailedTradesIntoAccepted();

  const trades = getAcceptedTrades().filter(
    (trade) => trade.postedBy === userId || trade.acceptedBy === userId,
  );

  return trades.sort((a, b) => {
    const rank = (trade) => {
      if (trade.failedAt) return 2;
      if (trade.completedAt) return 1;
      return 0;
    };
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    return (b.acceptedAt || b.postedAt) - (a.acceptedAt || a.postedAt);
  });
}

function migrateFailedTradesIntoAccepted() {
  if (usesTradeApi()) return;

  const failedTrades = getFailedTrades();
  if (!failedTrades.length) return;

  const acceptedTrades = readLocalAcceptedTrades();
  const existingIds = new Set(acceptedTrades.map((trade) => trade.id));
  let changed = false;

  failedTrades.forEach((trade) => {
    if (!existingIds.has(trade.id)) {
      acceptedTrades.push(trade);
      changed = true;
    }
  });

  if (changed) {
    writeLocalAcceptedTrades(acceptedTrades);
    acceptedTradesCache = acceptedTrades;
  }

  localStorage.setItem(FAILED_TRADES_KEY, '[]');
}

function canUserAcceptTrade(trade) {
  const userId = getCurrentUserId();
  if (!userId || !trade) return false;
  if (trade.postedBy && trade.postedBy === userId) return false;
  return true;
}

function canUserMarkAcceptedTradeFailed(trade) {
  const userId = getCurrentUserId();
  if (!userId || !trade || trade.failedAt || trade.completedAt) return false;
  return trade.postedBy === userId || trade.acceptedBy === userId;
}

function canUserMarkAcceptedTradeCompleted(trade) {
  const userId = getCurrentUserId();
  if (!userId || !trade || trade.failedAt || trade.completedAt) return false;
  return trade.postedBy === userId || trade.acceptedBy === userId;
}

function getFailedTrades() {
  try {
    const trades = JSON.parse(localStorage.getItem(FAILED_TRADES_KEY) || '[]');
    return Array.isArray(trades) ? trades : [];
  } catch {
    return [];
  }
}

function getFailedTradesForUser() {
  const userId = getCurrentUserId();
  if (!userId) return [];

  return getFailedTrades().filter(
    (trade) => trade.postedBy === userId || trade.acceptedBy === userId,
  );
}

async function markAcceptedTradeFailed(tradeId) {
  const trade = getAcceptedTradeById(tradeId);
  if (!trade || !canUserMarkAcceptedTradeFailed(trade)) return false;

  const userId = getCurrentUserId();
  if (!userId) return false;

  if (usesTradeApi()) {
    try {
      const updated = await tradeApiRequest(`/accepted/${tradeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ userId, failedAt: true }),
      });
      acceptedTradesCache = acceptedTradesCache.map((item) => (
        item.id === tradeId ? updated : item
      ));
      return true;
    } catch {
      return false;
    }
  }

  const acceptedTrades = acceptedTradesCache.map((item) => {
    if (item.id !== tradeId) return item;
    return {
      ...item,
      failedAt: Date.now(),
      failedBy: userId,
    };
  });

  writeLocalAcceptedTrades(acceptedTrades);
  acceptedTradesCache = acceptedTrades;
  return true;
}

async function markAcceptedTradeCompleted(tradeId) {
  const trade = getAcceptedTradeById(tradeId);
  if (!trade || !canUserMarkAcceptedTradeCompleted(trade)) return false;

  const userId = getCurrentUserId();
  if (!userId) return false;

  if (usesTradeApi()) {
    try {
      const updated = await tradeApiRequest(`/accepted/${tradeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ userId, completedAt: true }),
      });
      acceptedTradesCache = acceptedTradesCache.map((item) => (
        item.id === tradeId ? updated : item
      ));
      return true;
    } catch {
      return false;
    }
  }

  const acceptedTrades = acceptedTradesCache.map((item) => {
    if (item.id !== tradeId) return item;
    return {
      ...item,
      completedAt: Date.now(),
      completedBy: userId,
    };
  });

  writeLocalAcceptedTrades(acceptedTrades);
  acceptedTradesCache = acceptedTrades;
  return true;
}

async function acceptPostedTrade(tradeId) {
  const trade = getPostedTradeById(tradeId);
  if (!trade || !canUserAcceptTrade(trade)) return false;

  const accepterId = getCurrentUserId();
  if (!accepterId) return false;

  if (usesTradeApi()) {
    try {
      const acceptedTrade = await tradeApiRequest(`/posted/${tradeId}/accept`, {
        method: 'POST',
        body: JSON.stringify({ userId: accepterId }),
      });
      postedTradesCache = postedTradesCache.filter((item) => item.id !== tradeId);
      acceptedTradesCache = [acceptedTrade, ...acceptedTradesCache.filter((item) => item.id !== tradeId)];
      return true;
    } catch {
      return false;
    }
  }

  const acceptedTrade = {
    ...trade,
    acceptedAt: Date.now(),
    acceptedBy: accepterId,
  };

  const postedTrades = postedTradesCache.filter((item) => item.id !== tradeId);
  const acceptedTrades = [acceptedTrade, ...acceptedTradesCache];

  writeLocalPostedTrades(postedTrades);
  writeLocalAcceptedTrades(acceptedTrades);
  postedTradesCache = postedTrades;
  acceptedTradesCache = acceptedTrades;
  return true;
}

function getCurrentUserId() {
  try {
    let id = localStorage.getItem(USER_ID_KEY);
    if (!id) {
      id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      localStorage.setItem(USER_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

function canUserDeleteTrade(trade) {
  const userId = getCurrentUserId();
  return Boolean(userId && trade?.postedBy && trade.postedBy === userId);
}

async function deletePostedTrade(tradeId) {
  const trade = getPostedTradeById(tradeId);
  if (!trade || !canUserDeleteTrade(trade)) return false;

  const userId = getCurrentUserId();
  if (!userId) return false;

  if (usesTradeApi()) {
    try {
      await tradeApiRequest(`/posted/${tradeId}?userId=${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });
      postedTradesCache = postedTradesCache.filter((item) => item.id !== tradeId);
      return true;
    } catch {
      return false;
    }
  }

  const trades = postedTradesCache.filter((item) => item.id !== tradeId);
  writeLocalPostedTrades(trades);
  postedTradesCache = trades;
  return true;
}

async function savePostedTrade(trade) {
  const yourSide = trade.yourSide || [];
  const theirSide = trade.theirSide || [];
  if (!canPostTrade(yourSide, theirSide)) return false;

  const postedBy = getCurrentUserId();
  if (!postedBy) return false;

  if (usesTradeApi()) {
    try {
      const savedTrade = await tradeApiRequest('/posted', {
        method: 'POST',
        body: JSON.stringify({
          yourSide,
          theirSide,
          offerer: trade.offerer || '—',
          postedBy,
        }),
      });
      postedTradesCache = [savedTrade, ...postedTradesCache.filter((item) => item.id !== savedTrade.id)];
      return true;
    } catch {
      return false;
    }
  }

  const savedTrade = {
    id: Date.now(),
    postedAt: Date.now(),
    postedBy,
    offerer: trade.offerer || '—',
    yourSide,
    theirSide,
  };
  const trades = [savedTrade, ...postedTradesCache];
  writeLocalPostedTrades(trades);
  postedTradesCache = trades;
  return true;
}

function isValidTradeSide(items) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.some((item) => !item.isSign);
}

function canPostTrade(yourSide, theirSide) {
  return isValidTradeSide(yourSide) && isValidTradeSide(theirSide);
}

function getPostTradeValidationError(yourSide, theirSide) {
  if (!yourSide.length) return 'Add at least one item to your side.';
  if (!theirSide.length) return 'Add at least one item to their side.';
  if (yourSide.every((item) => item.isSign)) return "Your side can't include only Signs.";
  if (theirSide.every((item) => item.isSign)) return "Their side can't include only Signs.";
  return null;
}

function setViewTradeSession(tradeId, source = 'posted') {
  const trade = source === 'accepted'
    ? getAcceptedTradeById(tradeId)
    : getPostedTradeById(tradeId);
  if (!trade) return false;

  sessionStorage.setItem(VIEW_TRADE_SESSION_KEY, JSON.stringify({
    tradeId: trade.id,
    source,
    offerer: trade.offerer || '—',
    postedAt: trade.postedAt,
    yourSide: trade.theirSide || [],
    theirSide: trade.yourSide || [],
  }));
  return true;
}

function consumeViewTradeSession() {
  try {
    const raw = sessionStorage.getItem(VIEW_TRADE_SESSION_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(VIEW_TRADE_SESSION_KEY);
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch {
    return null;
  }
}

function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function buildTradeSlotBadgesHTML(potions) {
  if (!potions) return '';
  const badges = [];
  if (potions.mega) badges.push('<span class="trade-slot__badge trade-slot__badge--mega" aria-label="Mega">M</span>');
  if (potions.neon) badges.push('<span class="trade-slot__badge trade-slot__badge--neon" aria-label="Neon">N</span>');
  if (potions.fly) badges.push('<span class="trade-slot__badge trade-slot__badge--fly" aria-label="Fly">F</span>');
  if (potions.ride) badges.push('<span class="trade-slot__badge trade-slot__badge--ride" aria-label="Ride">R</span>');
  if (badges.length === 0) return '';
  return `<div class="trade-slot__badges">${badges.join('')}</div>`;
}

function buildTradeSlotHTML(item) {
  const name = escapeHtml(item.name);
  const signClass = item.isSign ? ' trade-slot--sign' : '';
  return `<div class="trade-slot trade-slot--filled${signClass}">
    <div class="trade-slot__card">
      <img class="trade-slot__img" src="${item.image}" alt="${name}">
      ${buildTradeSlotBadgesHTML(item.potions)}
    </div>
  </div>`;
}

const VIEW_TRADE_INITIAL_CAPACITY = 9;
const VIEW_TRADE_ROW_SIZE = 3;
const VIEW_TRADE_MAX_PETS = 18;

function getViewTradeGridCapacity(itemCount) {
  let capacity = VIEW_TRADE_INITIAL_CAPACITY;
  while (capacity < itemCount && capacity < VIEW_TRADE_MAX_PETS) {
    capacity += VIEW_TRADE_ROW_SIZE;
  }
  return capacity;
}

function buildReadOnlyTradeGridHTML(items) {
  const safeItems = Array.isArray(items) ? items : [];
  const capacity = getViewTradeGridCapacity(safeItems.length);
  const filled = safeItems.map(buildTradeSlotHTML).join('');
  const emptySlots = Array.from({ length: capacity - safeItems.length }, () => '<div class="trade-slot"></div>').join('');
  return filled + emptySlots;
}

function getPostedTradeVisibleRows(itemCount) {
  if (itemCount <= 0) return 1;
  if (itemCount <= 3) return 1;
  if (itemCount <= 6) return 2;
  return 3;
}

function getPostedTradeGridMeta(itemCount) {
  if (itemCount <= 0) {
    return { cols: 1, rows: 1, scrollable: false };
  }

  const cols = itemCount === 1 ? 1 : itemCount === 2 ? 2 : 3;
  const rows = getPostedTradeVisibleRows(itemCount);

  return {
    cols,
    rows,
    scrollable: itemCount > 9,
  };
}

function buildPostedTradeSideHTML(items, label, options = {}) {
  const { showLabel = true } = options;
  const safeLabel = escapeHtml(label);
  const itemCount = items.length;
  const { cols, rows, scrollable } = getPostedTradeGridMeta(itemCount);
  const scrollClass = scrollable ? ' posted-trade__grid-scroll--scrollable' : '';
  const gridStyle = `--posted-trade-cols: ${cols}; --posted-trade-rows: ${rows};`;

  const gridContent = itemCount
    ? `<div class="trade-grid posted-trade__grid" style="${gridStyle}">${items.map(buildTradeSlotHTML).join('')}</div>`
    : '<div class="posted-trade__empty-side">Empty</div>';

  const labelHTML = showLabel
    ? `<h3 class="trade-side__label posted-trade__side-label">${safeLabel}</h3>`
    : '';

  return `<div class="posted-trade__side" data-item-count="${itemCount}">
    ${labelHTML}
    <div class="trade-panel posted-trade__panel">
      <div class="trade-grid-scroll posted-trade__grid-scroll${scrollClass}" style="${gridStyle}">
        ${gridContent}
      </div>
    </div>
  </div>`;
}

function buildPostedTradeArrowsHTML(compact) {
  const iconClass = compact ? 'trade-center__icon trade-center__icon--posted-compact' : 'trade-center__icon trade-center__icon--posted-detail';
  return `<div class="trade-center trade-center--posted${compact ? ' trade-center--posted-compact' : ' trade-center--posted-detail'}">
    <svg class="${iconClass}" viewBox="0 0 64 64" aria-hidden="true">
      <g class="trade-center__icon-shape">
        <rect x="6" y="16" width="34" height="12"/>
        <polygon points="40,10 58,22 40,34"/>
        <rect x="24" y="38" width="34" height="12"/>
        <polygon points="24,52 6,44 24,28"/>
      </g>
    </svg>
  </div>`;
}

function buildPostedTradeHTML(trade, options = {}) {
  const { accepted = false, failed = false, completed = false } = options;
  const viewerYourSide = trade.theirSide || [];
  const viewerTheirSide = trade.yourSide || [];
  const offerer = escapeHtml(trade.offerer || '—');
  const userId = getCurrentUserId();
  const isAccepter = Boolean(userId && trade.acceptedBy === userId);
  const isPoster = Boolean(userId && trade.postedBy === userId);

  let timer;
  if (failed && trade.failedAt) {
    timer = `Failed ${formatTimeAgo(trade.failedAt)}`;
  } else if (completed && trade.completedAt) {
    timer = `Completed ${formatTimeAgo(trade.completedAt)}`;
  } else if (accepted && trade.acceptedAt) {
    timer = `Accepted ${formatTimeAgo(trade.acceptedAt)}`;
  } else {
    timer = formatTimeAgo(trade.postedAt);
  }

  const yourMeta = getPostedTradeGridMeta(viewerYourSide.length);
  const theirMeta = getPostedTradeGridMeta(viewerTheirSide.length);
  const maxRows = Math.max(yourMeta.rows, theirMeta.rows, 1);
  const barStyle = `--posted-trade-max-rows: ${maxRows};`;

  let roleBadge = '';
  if (failed) {
    roleBadge = '<span class="posted-trade__role posted-trade__role--failed">Failed</span>';
  } else if (completed) {
    roleBadge = '<span class="posted-trade__role posted-trade__role--completed">Completed</span>';
  } else if (accepted) {
    if (isAccepter) {
      roleBadge = '<span class="posted-trade__role posted-trade__role--accepted">You accepted</span>';
    } else if (isPoster) {
      roleBadge = '<span class="posted-trade__role posted-trade__role--posted">Your trade was accepted</span>';
    }
  }

  const deleteBtn = !accepted && !failed && canUserDeleteTrade(trade)
    ? '<button type="button" class="posted-trade__btn posted-trade__btn--delete">Delete</button>'
    : '';

  const acceptBtn = !accepted && !failed && canUserAcceptTrade(trade)
    ? '<button type="button" class="posted-trade__btn posted-trade__btn--accept">Accept</button>'
    : '';

  let secondaryBtn = '';
  if (accepted && !failed && !completed) {
    const markCompletedBtn = canUserMarkAcceptedTradeCompleted(trade)
      ? '<button type="button" class="posted-trade__btn posted-trade__btn--mark-completed">Mark Completed</button>'
      : '';
    const markFailedBtn = canUserMarkAcceptedTradeFailed(trade)
      ? '<button type="button" class="posted-trade__btn posted-trade__btn--mark-failed">Mark Failed</button>'
      : '';
    secondaryBtn = markCompletedBtn + markFailedBtn;
  } else if (!accepted && !failed) {
    secondaryBtn = '<button type="button" class="posted-trade__btn posted-trade__btn--view">View Trade</button>';
  }

  const viewSource = accepted ? 'accepted' : 'posted';
  const articleModifier = failed
    ? ' posted-trade--failed'
    : completed
      ? ' posted-trade--completed'
      : accepted
        ? ' posted-trade--accepted'
        : '';
  const timerDate = failed && trade.failedAt
    ? trade.failedAt
    : completed && trade.completedAt
      ? trade.completedAt
      : accepted && trade.acceptedAt
        ? trade.acceptedAt
        : trade.postedAt;

  return `<article class="posted-trade${articleModifier}" data-trade-id="${trade.id}" data-trade-source="${viewSource}">
    <div class="posted-trade__bar" style="${barStyle}">
      <div class="posted-trade__offerer">
        <span class="posted-trade__offerer-name">${offerer}</span>
      </div>
      ${buildPostedTradeSideHTML(viewerYourSide, 'Your Side', { showLabel: false })}
      ${buildPostedTradeSideHTML(viewerTheirSide, 'Their Side', { showLabel: false })}
      <div class="posted-trade__meta">
        ${roleBadge}
        <time class="posted-trade__timer" datetime="${new Date(timerDate).toISOString()}">${timer}</time>
        <div class="posted-trade__actions">
          ${deleteBtn}
          ${acceptBtn}
          ${secondaryBtn}
        </div>
      </div>
    </div>
  </article>`;
}

function buildAcceptedTradeHTML(trade) {
  const failed = Boolean(trade.failedAt);
  const completed = Boolean(trade.completedAt) && !failed;
  return buildPostedTradeHTML(trade, { accepted: true, failed, completed });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

if (typeof window !== 'undefined') {
  postedTradesCache = readLocalPostedTrades();
  acceptedTradesCache = readLocalAcceptedTrades();
  ensureTradesSynced();
}
