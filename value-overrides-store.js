const fs = require('fs');
const path = require('path');

const LOCAL_FILE = path.join(__dirname, 'data', 'value-overrides.json');
const VERCEL_FILE = '/tmp/valuedex-value-overrides.json';
const GITHUB_REPO = process.env.GITHUB_REPO || 'artasllani9-spec/d';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_PATH = process.env.VALUES_GITHUB_PATH || 'data/value-overrides.json';
const BLOB_PATHNAME = 'valuedex-value-overrides.json';
const UPSTASH_KEY = 'valuedex:value-overrides';

let memory = null;
let memoryAt = 0;
let githubSha = null;
let blobReadUrl = process.env.VALUES_BLOB_URL || null;
let writeQueue = Promise.resolve();

const MEMORY_TTL_MS = 2000;

function emptyOverrides() {
  return {
    pets: {},
    items: {},
    acronyms: {},
    customPets: {},
    customItems: {},
    updatedAt: null,
  };
}

function normalizeAcronymKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const CUSTOM_ITEM_CATEGORIES = new Set([
  'pet-wear',
  'strollers',
  'food',
  'vehicles',
  'toys',
  'gifts',
  'stickers',
  'houses',
]);

function normalizeOverrides(raw) {
  const pets = raw && raw.pets && typeof raw.pets === 'object' && !Array.isArray(raw.pets)
    ? raw.pets
    : {};
  const items = raw && raw.items && typeof raw.items === 'object' && !Array.isArray(raw.items)
    ? raw.items
    : {};
  const acronyms = raw && raw.acronyms && typeof raw.acronyms === 'object' && !Array.isArray(raw.acronyms)
    ? raw.acronyms
    : {};
  const customPets =
    raw && raw.customPets && typeof raw.customPets === 'object' && !Array.isArray(raw.customPets)
      ? raw.customPets
      : {};
  const customItems =
    raw && raw.customItems && typeof raw.customItems === 'object' && !Array.isArray(raw.customItems)
      ? raw.customItems
      : {};

  const cleanPets = {};
  for (const [name, values] of Object.entries(pets)) {
    if (!values || typeof values !== 'object') continue;
    const fr = Number(values.fr);
    const nfr = Number(values.nfr);
    const mfr = Number(values.mfr);
    if (![fr, nfr, mfr].every((n) => Number.isFinite(n) && n >= 0)) continue;
    cleanPets[name] = { fr, nfr, mfr };
  }

  const cleanItems = {};
  for (const [name, value] of Object.entries(items)) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) continue;
    cleanItems[name] = amount;
  }

  const cleanAcronyms = {};
  for (const [acro, itemName] of Object.entries(acronyms)) {
    const key = normalizeAcronymKey(acro);
    const mappedName = String(itemName || '').trim();
    if (!key || !mappedName) continue;
    cleanAcronyms[key] = mappedName;
  }

  const cleanCustomPets = {};
  for (const [name, entry] of Object.entries(customPets)) {
    const petName = String(name || '').trim();
    if (!petName || !entry || typeof entry !== 'object') continue;
    const image = String(entry.image || '').trim();
    const fr = Number(entry.fr);
    const nfr = Number(entry.nfr);
    const mfr = Number(entry.mfr);
    if (!image || !/^https?:\/\//i.test(image)) continue;
    if (![fr, nfr, mfr].every((n) => Number.isFinite(n) && n >= 0)) continue;
    cleanCustomPets[petName] = { image, fr, nfr, mfr };
    cleanPets[petName] = { fr, nfr, mfr };
  }

  const cleanCustomItems = {};
  for (const [name, entry] of Object.entries(customItems)) {
    const itemName = String(name || '').trim();
    if (!itemName || !entry || typeof entry !== 'object') continue;
    const image = String(entry.image || '').trim();
    const category = String(entry.category || '').trim().toLowerCase();
    const value = Number(entry.value);
    if (!image || !/^https?:\/\//i.test(image)) continue;
    if (!CUSTOM_ITEM_CATEGORIES.has(category)) continue;
    if (!Number.isFinite(value) || value < 0) continue;
    cleanCustomItems[itemName] = { image, category, value };
    cleanItems[itemName] = value;
  }

  return {
    pets: cleanPets,
    items: cleanItems,
    acronyms: cleanAcronyms,
    customPets: cleanCustomPets,
    customItems: cleanCustomItems,
    updatedAt: raw && raw.updatedAt != null ? Number(raw.updatedAt) || null : null,
  };
}

function cloneOverrides(data) {
  const normalized = normalizeOverrides(data);
  return {
    pets: { ...normalized.pets },
    items: { ...normalized.items },
    acronyms: { ...normalized.acronyms },
    customPets: { ...normalized.customPets },
    customItems: { ...normalized.customItems },
    updatedAt: normalized.updatedAt,
  };
}

function setMemory(data) {
  memory = normalizeOverrides(data);
  memoryAt = Date.now();
  return cloneOverrides(memory);
}

function memoryIsFresh() {
  return Boolean(memory) && Date.now() - memoryAt < MEMORY_TTL_MS;
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

function hasDurableBackend() {
  return Boolean(getGitHubToken() || getUpstashConfig() || getBlobToken());
}

function usesRemoteStore() {
  return Boolean(process.env.VERCEL || hasDurableBackend());
}

function readLocalFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return normalizeOverrides(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return null;
  }
}

function writeLocalFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(normalizeOverrides(data), null, 2) + '\n');
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
    body: JSON.stringify(['GET', UPSTASH_KEY]),
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  if (!data || data.result == null) return null;
  try {
    return normalizeOverrides(typeof data.result === 'string' ? JSON.parse(data.result) : data.result);
  } catch {
    return null;
  }
}

async function writeToUpstash(data) {
  const config = getUpstashConfig();
  if (!config) return false;
  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['SET', UPSTASH_KEY, JSON.stringify(normalizeOverrides(data))]),
  });
  return response.ok;
}

async function readFromBlob() {
  const token = getBlobToken();
  if (blobReadUrl) {
    const response = await fetch(blobReadUrl, { cache: 'no-store' });
    if (response.ok) return normalizeOverrides(await response.json());
    if (response.status === 404) return null;
  }
  if (!token) return null;

  const listResponse = await fetch(
    `https://blob.vercel-storage.com?prefix=${encodeURIComponent(BLOB_PATHNAME)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!listResponse.ok) return null;
  const listData = await listResponse.json().catch(() => null);
  const match = (listData && listData.blobs ? listData.blobs : []).find(
    (blob) => blob.pathname === BLOB_PATHNAME || String(blob.url || '').includes(BLOB_PATHNAME)
  );
  if (!match || !match.url) return null;
  blobReadUrl = match.url;
  const response = await fetch(match.url, { cache: 'no-store' });
  if (!response.ok) return null;
  return normalizeOverrides(await response.json());
}

async function writeToBlob(data) {
  const token = getBlobToken();
  if (!token) return false;
  const response = await fetch(`https://blob.vercel-storage.com/${BLOB_PATHNAME}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-vercel-blob-access': 'public',
    },
    body: JSON.stringify(normalizeOverrides(data)),
  });
  if (!response.ok) return false;
  const result = await response.json().catch(() => null);
  if (result && result.url) blobReadUrl = result.url;
  return true;
}

async function readFromGitHub() {
  const token = getGitHubToken();
  if (!token) return null;
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_PATH}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'valuedex-values',
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) return null;
  const payload = await response.json();
  githubSha = payload.sha || null;
  const content = Buffer.from(payload.content || '', 'base64').toString('utf8');
  return normalizeOverrides(JSON.parse(content));
}

async function writeToGitHub(data) {
  const token = getGitHubToken();
  if (!token) return false;
  if (!githubSha) {
    try {
      await readFromGitHub();
    } catch {
      // new file
    }
  }
  const body = {
    message: 'Update value overrides',
    content: Buffer.from(JSON.stringify(normalizeOverrides(data), null, 2) + '\n').toString('base64'),
    branch: GITHUB_BRANCH,
  };
  if (githubSha) body.sha = githubSha;

  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_PATH}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'valuedex-values',
      },
      body: JSON.stringify(body),
    }
  );
  if (!response.ok) return false;
  const payload = await response.json().catch(() => null);
  if (payload && payload.content && payload.content.sha) {
    githubSha = payload.content.sha;
  }
  return true;
}

async function readValueOverrides({ force = false } = {}) {
  if (!force && memoryIsFresh()) {
    return cloneOverrides(memory);
  }

  if (!usesRemoteStore() && !process.env.VERCEL) {
    return setMemory(readLocalFile(LOCAL_FILE) || emptyOverrides());
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

  const local = readLocalFile(process.env.VERCEL ? VERCEL_FILE : LOCAL_FILE);
  if (local) pieces.push(local);
  if (memory) pieces.push(memory);

  if (!pieces.length) return setMemory(emptyOverrides());

  // Prefer the most recently updated payload.
  pieces.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
  return setMemory(pieces[0]);
}

async function writeValueOverrides(nextRaw) {
  const next = normalizeOverrides({
    ...nextRaw,
    updatedAt: Date.now(),
  });

  writeQueue = writeQueue.then(async () => {
    setMemory(next);

    if (!usesRemoteStore() && !process.env.VERCEL) {
      writeLocalFile(LOCAL_FILE, next);
      return next;
    }

    if (!hasDurableBackend() && process.env.VERCEL) {
      writeLocalFile(VERCEL_FILE, next);
      const err = new Error(
        'Value override storage is not configured. Set GITHUB_TOKEN (or Upstash/Blob) so edits survive on Vercel.'
      );
      err.status = 503;
      throw err;
    }

    const results = {};
    if (getUpstashConfig()) results.upstash = await writeToUpstash(next);
    if (getBlobToken()) results.blob = await writeToBlob(next);
    if (getGitHubToken()) results.github = await writeToGitHub(next);
    writeLocalFile(process.env.VERCEL ? VERCEL_FILE : LOCAL_FILE, next);

    if (process.env.VERCEL && !Object.values(results).some(Boolean)) {
      const err = new Error('Failed to persist value overrides to a durable backend.');
      err.status = 502;
      throw err;
    }

    return next;
  });

  return writeQueue;
}

module.exports = {
  readValueOverrides,
  writeValueOverrides,
  normalizeOverrides,
  emptyOverrides,
};
