const fs = require('fs');
const path = require('path');

const MAX_STORED_TRADES = 100;
const LOCAL_DATA_FILE = path.join(__dirname, 'data', 'trades.json');
const VERCEL_DATA_FILE = '/tmp/demandgg-trades.json';
const GITHUB_REPO = process.env.GITHUB_REPO || 'artasllani9-spec/d';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_PATH = process.env.TRADES_GITHUB_PATH || 'data/trades.json';
const BLOB_PATHNAME = 'demandgg-trades.json';

let memoryStore = null;
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

function setMemory(store) {
  memoryStore = normalizeStore(store);
  return cloneStore(memoryStore);
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
  if (!data || data.result == null) return emptyStore();
  try {
    return normalizeStore(typeof data.result === 'string' ? JSON.parse(data.result) : data.result);
  } catch {
    return emptyStore();
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
  if (!match || !match.url) return emptyStore();
  blobReadUrl = match.url;
  const response = await fetch(match.url, { cache: 'no-store' });
  if (!response.ok) return emptyStore();
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
    return emptyStore();
  }

  if (!response.ok) {
    const rawUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${GITHUB_PATH}`;
    const rawResponse = await fetch(`${rawUrl}?t=${Date.now()}`, { cache: 'no-store' });
    if (!rawResponse.ok) return null;
    return normalizeStore(await rawResponse.json());
  }

  const data = await response.json();
  githubSha = data.sha || null;
  const content = Buffer.from(data.content || '', 'base64').toString('utf8');
  return normalizeStore(JSON.parse(content || '{}'));
}

async function writeToGitHub(store) {
  const token = getGitHubToken();
  if (!token) return false;

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
    const latest = await readFromGitHub();
    if (latest) setMemory(latest);
    return false;
  }

  if (!response.ok) return false;
  const data = await response.json().catch(() => null);
  githubSha = data && data.content ? data.content.sha : githubSha;
  return true;
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

async function readStore() {
  // Keep a short-lived memory cache locally; on Vercel always reload shared storage
  // so every instance sees the latest posted/accepted trades.
  if (!process.env.VERCEL && memoryStore) {
    return cloneStore(memoryStore);
  }

  if (!usesRemoteStore() && !process.env.VERCEL) {
    const local = readLocalFile(LOCAL_DATA_FILE) || emptyStore();
    return setMemory(local);
  }

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

  const fallback = readLocalFile(process.env.VERCEL ? VERCEL_DATA_FILE : LOCAL_DATA_FILE);
  if (fallback) pieces.push(fallback);

  if (!pieces.length) {
    return setMemory(emptyStore());
  }

  return setMemory(mergeStores(...pieces));
}

async function writeStore(store) {
  const next = normalizeStore(store);
  setMemory(next);

  const persist = async () => {
    let savedRemote = false;

    if (getUpstashConfig()) {
      savedRemote = (await writeToUpstash(next)) || savedRemote;
    }
    if (getBlobToken()) {
      savedRemote = (await writeToBlob(next)) || savedRemote;
    }
    if (getGitHubToken()) {
      for (let attempt = 0; attempt < 3 && !savedRemote; attempt += 1) {
        savedRemote = (await writeToGitHub(next)) || savedRemote;
        if (!savedRemote) await readFromGitHub();
      }
    }

    const backupFile = process.env.VERCEL ? VERCEL_DATA_FILE : LOCAL_DATA_FILE;
    writeLocalFile(backupFile, next);
    return savedRemote;
  };

  writeQueue = writeQueue.then(persist, persist);
  await writeQueue;
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

module.exports = {
  MAX_STORED_TRADES,
  SITE_OWNER_ID,
  readStore,
  writeStore,
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
