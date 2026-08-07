const fs = require('fs');
const path = require('path');

const MAX_STORED_TRADES = 2000;
const MEMORY_CACHE_TTL_MS = 2500;
const UPDATE_MAX_ATTEMPTS = 6;
const LOCAL_DATA_FILE = path.join(__dirname, 'data', 'trades.json');
const VERCEL_DATA_FILE = '/tmp/demandgg-trades.json';
const GITHUB_REPO = process.env.GITHUB_REPO || 'artasllani9-spec/d';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_PATH = process.env.TRADES_GITHUB_PATH || 'data/trades.json';
const BLOB_PATHNAME = 'demandgg-trades.json';

let memoryStore = null;
let memoryStoreAt = 0;
let githubSha = null;
let blobReadUrl = process.env.TRADES_BLOB_URL || null;
let writeQueue = Promise.resolve();

const SITE_OWNER_ID = '3519737769';

function emptyStore() {
  return { posted: [], accepted: [], moderators: [], bans: [], blocks: [], reports: [] };
}

function normalizeBan(ban) {
  if (!ban || ban.userId == null || ban.userId === '') return null;
  return {
    userId: String(ban.userId),
    bannedBy: ban.bannedBy != null && ban.bannedBy !== '' ? String(ban.bannedBy) : null,
    bannedAt: Number(ban.bannedAt) || Date.now(),
  };
}

function normalizeBlock(block) {
  if (!block || block.blockerId == null || block.blockedId == null) return null;
  const blockerId = String(block.blockerId);
  const blockedId = String(block.blockedId);
  if (!blockerId || !blockedId || blockerId === blockedId) return null;
  return {
    blockerId,
    blockedId,
    blockedAt: Number(block.blockedAt) || Date.now(),
  };
}

function normalizeReport(report) {
  if (!report || report.reportedId == null || report.reporterId == null) return null;
  const reason = String(report.reason || '').trim();
  if (!reason) return null;
  return {
    id: report.id != null ? String(report.id) : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    reporterId: String(report.reporterId),
    reporterUsername: report.reporterUsername ? String(report.reporterUsername) : null,
    reportedId: String(report.reportedId),
    reportedUsername: report.reportedUsername ? String(report.reportedUsername) : null,
    reason,
    createdAt: Number(report.createdAt) || Date.now(),
  };
}

function normalizeStore(store) {
  const moderators = Array.isArray(store && store.moderators)
    ? [...new Set(store.moderators.map((id) => String(id)).filter(Boolean))]
    : [];
  const bans = Array.isArray(store && store.bans)
    ? store.bans.map(normalizeBan).filter(Boolean)
    : [];
  const blocks = Array.isArray(store && store.blocks)
    ? store.blocks.map(normalizeBlock).filter(Boolean)
    : [];
  const reports = Array.isArray(store && store.reports)
    ? store.reports.map(normalizeReport).filter(Boolean)
    : [];

  return {
    posted: Array.isArray(store && store.posted) ? store.posted : [],
    accepted: Array.isArray(store && store.accepted) ? store.accepted : [],
    moderators,
    bans,
    blocks,
    reports,
  };
}

function cloneStore(store) {
  const normalized = normalizeStore(store);
  return {
    posted: [...normalized.posted],
    accepted: [...normalized.accepted],
    moderators: [...normalized.moderators],
    bans: normalized.bans.map((ban) => ({ ...ban })),
    blocks: normalized.blocks.map((block) => ({ ...block })),
    reports: normalized.reports.map((report) => ({ ...report })),
  };
}

function storeContentScore(store) {
  const normalized = normalizeStore(store);
  return (
    normalized.posted.length +
    normalized.accepted.length +
    normalized.moderators.length +
    normalized.bans.length +
    normalized.blocks.length +
    normalized.reports.length
  );
}

function isEmptyStore(store) {
  return storeContentScore(store) === 0;
}

function isSiteOwner(userId) {
  return Boolean(userId) && String(userId) === SITE_OWNER_ID;
}

function isSiteModerator(store, userId) {
  if (!userId) return false;
  const id = String(userId);
  if (isSiteOwner(id)) return true;
  const moderators = store && Array.isArray(store.moderators) ? store.moderators : [];
  return moderators.some((modId) => String(modId) === id);
}

function getBanRecord(store, userId) {
  if (!userId || !store || !Array.isArray(store.bans)) return null;
  const id = String(userId);
  return store.bans.find((ban) => String(ban.userId) === id) || null;
}

function isBannedUser(store, userId) {
  return Boolean(getBanRecord(store, userId));
}

function hasUserBlocked(store, blockerId, blockedId) {
  if (!store || !Array.isArray(store.blocks) || !blockerId || !blockedId) return false;
  const blocker = String(blockerId);
  const blocked = String(blockedId);
  return store.blocks.some(
    (block) => String(block.blockerId) === blocker && String(block.blockedId) === blocked,
  );
}

function getBlockedIdsForUser(store, blockerId) {
  if (!store || !Array.isArray(store.blocks) || !blockerId) return [];
  const blocker = String(blockerId);
  return store.blocks
    .filter((block) => String(block.blockerId) === blocker)
    .map((block) => String(block.blockedId));
}

function getGitHubToken() {
  return process.env.TRADES_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '';
}

function getUpstashConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || '';
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ''), token };
}

function getBlobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN || '';
}

function usesRemoteStore() {
  return Boolean(process.env.VERCEL || getGitHubToken() || getUpstashConfig() || getBlobToken());
}

function hasDurableBackend() {
  return Boolean(getGitHubToken() || getUpstashConfig() || getBlobToken());
}

function setMemory(store) {
  memoryStore = normalizeStore(store);
  memoryStoreAt = Date.now();
  return cloneStore(memoryStore);
}

function memoryIsFresh() {
  return Boolean(memoryStore) && (Date.now() - memoryStoreAt) < MEMORY_CACHE_TTL_MS;
}

function readLocalFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return normalizeStore(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return null;
  }
}

function writeLocalFile(filePath, store) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(normalizeStore(store), null, 2));
}

async function readFromUpstash() {
  const config = getUpstashConfig();
  if (!config) return null;
  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['GET', 'demandgg:trades']),
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  if (!data || data.result == null) return null;
  try {
    return normalizeStore(typeof data.result === 'string' ? JSON.parse(data.result) : data.result);
  } catch {
    return null;
  }
}

async function writeToUpstash(store) {
  const config = getUpstashConfig();
  if (!config) return false;
  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['SET', 'demandgg:trades', JSON.stringify(normalizeStore(store))]),
  });
  return response.ok;
}

async function readFromBlob() {
  const token = getBlobToken();
  if (blobReadUrl) {
    const response = await fetch(blobReadUrl, { cache: 'no-store' });
    if (response.ok) {
      return normalizeStore(await response.json());
    }
    if (response.status === 404) return null;
  }

  if (!token) return null;

  const listResponse = await fetch(`https://blob.vercel-storage.com?prefix=${encodeURIComponent(BLOB_PATHNAME)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listResponse.ok) return null;
  const listData = await listResponse.json().catch(() => null);
  const match = (listData && listData.blobs ? listData.blobs : []).find((blob) => (
    blob.pathname === BLOB_PATHNAME || String(blob.url || '').includes(BLOB_PATHNAME)
  ));
  if (!match || !match.url) return null;
  blobReadUrl = match.url;
  const response = await fetch(match.url, { cache: 'no-store' });
  if (!response.ok) return null;
  return normalizeStore(await response.json());
}

async function writeToBlob(store) {
  const token = getBlobToken();
  if (!token) return false;
  const response = await fetch(`https://blob.vercel-storage.com/${BLOB_PATHNAME}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-vercel-blob-access': 'public',
      'x-vercel-blob-allow-overwrite': 'true',
    },
    body: JSON.stringify(normalizeStore(store)),
  });
  if (!response.ok) return false;
  const data = await response.json().catch(() => null);
  if (data && data.url) blobReadUrl = data.url;
  return true;
}

async function readFromGitHub() {
  const token = getGitHubToken();
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'demandgg-trades',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_PATH}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
  const response = await fetch(apiUrl, { headers });

  if (response.status === 404) {
    githubSha = null;
    return null;
  }

  if (!response.ok) {
    const rawUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${GITHUB_PATH}`;
    const rawResponse = await fetch(`${rawUrl}?t=${Date.now()}`, { cache: 'no-store' });
    if (!rawResponse.ok) return null;
    try {
      return normalizeStore(await rawResponse.json());
    } catch {
      return null;
    }
  }

  const data = await response.json();
  githubSha = data.sha || null;
  try {
    const content = Buffer.from(data.content || '', 'base64').toString('utf8');
    return normalizeStore(JSON.parse(content || '{}'));
  } catch {
    return null;
  }
}

async function writeToGitHub(store, { allowConflictRetry = true } = {}) {
  const token = getGitHubToken();
  if (!token) return { ok: false, conflict: false };

  const body = {
    message: `chore: sync trades ${new Date().toISOString()}`,
    content: Buffer.from(JSON.stringify(normalizeStore(store), null, 2)).toString('base64'),
    branch: GITHUB_BRANCH,
  };
  if (githubSha) body.sha = githubSha;

  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_PATH}`, {
    method: 'PUT',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'demandgg-trades',
    },
    body: JSON.stringify(body),
  });

  if (response.status === 409) {
    githubSha = null;
    if (allowConflictRetry) {
      await readFromGitHub();
    }
    return { ok: false, conflict: true };
  }

  if (!response.ok) return { ok: false, conflict: false };
  const data = await response.json().catch(() => null);
  githubSha = data && data.content ? data.content.sha : githubSha;
  return { ok: true, conflict: false };
}

function mergeStores(...stores) {
  const postedMap = new Map();
  const acceptedMap = new Map();
  const moderatorSet = new Set();
  const bansMap = new Map();
  const blocksMap = new Map();
  const reportsMap = new Map();

  stores.filter(Boolean).forEach((store) => {
    const normalized = normalizeStore(store);
    normalized.posted.forEach((trade) => {
      if (!trade || trade.id == null) return;
      const current = postedMap.get(trade.id);
      if (!current || (trade.postedAt || 0) >= (current.postedAt || 0)) {
        postedMap.set(trade.id, trade);
      }
    });
    normalized.accepted.forEach((trade) => {
      if (!trade || trade.id == null) return;
      const current = acceptedMap.get(trade.id);
      const currentTime = Math.max(current?.acceptedAt || 0, current?.completedAt || 0, current?.failedAt || 0, current?.postedAt || 0);
      const nextTime = Math.max(trade.acceptedAt || 0, trade.completedAt || 0, trade.failedAt || 0, trade.postedAt || 0);
      if (!current || nextTime >= currentTime) {
        acceptedMap.set(trade.id, trade);
      }
    });
    normalized.moderators.forEach((id) => moderatorSet.add(String(id)));
    normalized.bans.forEach((ban) => {
      const current = bansMap.get(ban.userId);
      if (!current || (ban.bannedAt || 0) >= (current.bannedAt || 0)) {
        bansMap.set(ban.userId, ban);
      }
    });
    normalized.blocks.forEach((block) => {
      const key = `${block.blockerId}:${block.blockedId}`;
      const current = blocksMap.get(key);
      if (!current || (block.blockedAt || 0) >= (current.blockedAt || 0)) {
        blocksMap.set(key, block);
      }
    });
    normalized.reports.forEach((report) => {
      const current = reportsMap.get(report.id);
      if (!current || (report.createdAt || 0) >= (current.createdAt || 0)) {
        reportsMap.set(report.id, report);
      }
    });
  });

  acceptedMap.forEach((_trade, id) => {
    postedMap.delete(id);
  });

  return {
    posted: [...postedMap.values()].sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0)),
    accepted: [...acceptedMap.values()].sort((a, b) => (b.acceptedAt || b.postedAt || 0) - (a.acceptedAt || a.postedAt || 0)),
    moderators: [...moderatorSet],
    bans: [...bansMap.values()].sort((a, b) => (b.bannedAt || 0) - (a.bannedAt || 0)),
    blocks: [...blocksMap.values()].sort((a, b) => (b.blockedAt || 0) - (a.blockedAt || 0)),
    reports: [...reportsMap.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
  };
}

function preferRichestStores(pieces) {
  const valid = pieces.filter(Boolean);
  if (!valid.length) return [];
  const nonEmpty = valid.filter((store) => !isEmptyStore(store));
  return nonEmpty.length ? nonEmpty : valid;
}

async function loadRemotePieces() {
  const pieces = [];

  try {
    if (getUpstashConfig()) {
      const remote = await readFromUpstash();
      if (remote) pieces.push(remote);
    }
  } catch {
    // ignore
  }

  try {
    if (getBlobToken() || blobReadUrl) {
      const remote = await readFromBlob();
      if (remote) pieces.push(remote);
    }
  } catch {
    // ignore
  }

  try {
    if (getGitHubToken() || process.env.VERCEL) {
      const remote = await readFromGitHub();
      if (remote) pieces.push(remote);
    }
  } catch {
    // ignore
  }

  return pieces;
}

async function readStore({ force = false } = {}) {
  if (!force && memoryIsFresh()) {
    return cloneStore(memoryStore);
  }

  if (!usesRemoteStore() && !process.env.VERCEL) {
    const local = readLocalFile(LOCAL_DATA_FILE) || emptyStore();
    return setMemory(local);
  }

  const pieces = preferRichestStores(await loadRemotePieces());

  const fallback = readLocalFile(process.env.VERCEL ? VERCEL_DATA_FILE : LOCAL_DATA_FILE);
  if (fallback && (!isEmptyStore(fallback) || !pieces.length)) {
    pieces.push(fallback);
  }

  if (memoryStore && !isEmptyStore(memoryStore) && !preferRichestStores(pieces).some((p) => !isEmptyStore(p))) {
    pieces.push(memoryStore);
  }

  const richest = preferRichestStores(pieces);
  if (!richest.length) {
    return setMemory(emptyStore());
  }

  return setMemory(mergeStores(...richest));
}

function assertSafeWrite(previous, next, { allowWipe = false } = {}) {
  if (allowWipe) return;
  if (!isEmptyStore(previous) && isEmptyStore(next)) {
    const error = new Error('Refusing to overwrite trade data with an empty store.');
    error.status = 509;
    error.code = 'STORE_WIPE_REFUSED';
    throw error;
  }
}

async function persistStore(store, { allowWipe = false } = {}) {
  const next = normalizeStore(store);
  const previous = memoryStore ? normalizeStore(memoryStore) : emptyStore();
  assertSafeWrite(previous, next, { allowWipe });
  setMemory(next);

  const persist = async () => {
    if (process.env.VERCEL && !hasDurableBackend()) {
      const error = new Error(
        'Trade storage is not configured. Set GITHUB_TOKEN (or Upstash/Blob) so data survives across serverless instances.',
      );
      error.status = 503;
      error.code = 'STORE_NOT_CONFIGURED';
      throw error;
    }

    const results = {
      upstash: null,
      blob: null,
      github: null,
      conflict: false,
    };

    if (getUpstashConfig()) {
      results.upstash = await writeToUpstash(next);
    }
    if (getBlobToken()) {
      results.blob = await writeToBlob(next);
    }
    if (getGitHubToken()) {
      const githubResult = await writeToGitHub(next);
      results.github = githubResult.ok;
      results.conflict = githubResult.conflict;
    }

    const backupFile = process.env.VERCEL ? VERCEL_DATA_FILE : LOCAL_DATA_FILE;
    try {
      writeLocalFile(backupFile, next);
    } catch {
      // /tmp can fail; durable backends matter more on Vercel
    }

    const remoteAttempted = results.upstash !== null || results.blob !== null || results.github !== null;
    const remoteSaved = Boolean(results.upstash || results.blob || results.github);

    if (remoteAttempted && !remoteSaved) {
      return { ok: false, conflict: results.conflict };
    }

    if (process.env.VERCEL && !remoteSaved && !hasDurableBackend()) {
      return { ok: false, conflict: false };
    }

    return { ok: true, conflict: false };
  };

  const run = writeQueue.then(persist, persist);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function writeStore(store, options = {}) {
  const result = await persistStore(store, options);
  if (!result.ok && result.conflict) {
    const error = new Error('Trade store write conflict. Retry the request.');
    error.status = 409;
    error.code = 'STORE_CONFLICT';
    throw error;
  }
  if (!result.ok) {
    const error = new Error('Could not persist trade data.');
    error.status = 503;
    error.code = 'STORE_WRITE_FAILED';
    throw error;
  }
  return cloneStore(memoryStore);
}

/**
 * Atomically apply a mutation with conflict retries.
 * Mutator receives a draft store to modify and may return a value.
 * Throw errors with `.status` for HTTP mapping in the API layer.
 */
async function updateStore(mutator, { allowWipe = false } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt < UPDATE_MAX_ATTEMPTS; attempt += 1) {
    const current = await readStore({ force: attempt > 0 });
    const draft = cloneStore(current);
    const mutatorResult = await mutator(draft);
    const next = normalizeStore(draft);

    try {
      const persistResult = await persistStore(next, { allowWipe });
      if (persistResult.ok) {
        return {
          store: cloneStore(memoryStore),
          result: mutatorResult,
        };
      }
      if (persistResult.conflict) {
        lastError = new Error('Trade store write conflict.');
        lastError.status = 409;
        continue;
      }
      lastError = new Error('Could not persist trade data.');
      lastError.status = 503;
    } catch (error) {
      if (error && error.code === 'STORE_WIPE_REFUSED') throw error;
      if (error && error.code === 'STORE_NOT_CONFIGURED') throw error;
      lastError = error;
      if (error && error.status && error.status < 500 && error.status !== 409) throw error;
    }
  }

  throw lastError || Object.assign(new Error('Could not save trade data after retries.'), { status: 503 });
}

function isValidTradeSide(items) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.some((item) => !item.isSign);
}

function canPostTrade(yourSide, theirSide) {
  return isValidTradeSide(yourSide) && isValidTradeSide(theirSide);
}

function createTradeId() {
  return Date.now() + Math.floor(Math.random() * 1000);
}

function isTradeParticipant(trade, userId) {
  if (!trade || userId == null || userId === '') return false;
  const id = String(userId);
  return String(trade.postedBy) === id || String(trade.acceptedBy) === id;
}

function httpError(status, message, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
}

module.exports = {
  MAX_STORED_TRADES,
  SITE_OWNER_ID,
  readStore,
  writeStore,
  updateStore,
  httpError,
  canPostTrade,
  createTradeId,
  isTradeParticipant,
  isSiteOwner,
  isSiteModerator,
  isBannedUser,
  getBanRecord,
  hasUserBlocked,
  getBlockedIdsForUser,
};
