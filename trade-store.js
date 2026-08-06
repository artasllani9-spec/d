const fs = require('fs');
const path = require('path');

const MAX_STORED_TRADES = 100;
const LOCAL_DATA_FILE = path.join(__dirname, 'data', 'trades.json');
const VERCEL_DATA_FILE = '/tmp/demandgg-trades.json';

let memoryStore = null;

function getDataFile() {
  if (process.env.VERCEL) return VERCEL_DATA_FILE;
  return LOCAL_DATA_FILE;
}

function cloneStore(store) {
  return {
    posted: Array.isArray(store.posted) ? [...store.posted] : [],
    accepted: Array.isArray(store.accepted) ? [...store.accepted] : [],
  };
}

function seedStoreIfNeeded() {
  const dataFile = getDataFile();
  if (fs.existsSync(dataFile)) return;

  try {
    const seed = fs.readFileSync(LOCAL_DATA_FILE, 'utf8');
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, seed);
  } catch {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, JSON.stringify({ posted: [], accepted: [] }));
  }
}

function readStore() {
  if (memoryStore) {
    return cloneStore(memoryStore);
  }

  seedStoreIfNeeded();

  try {
    const raw = fs.readFileSync(getDataFile(), 'utf8');
    const store = JSON.parse(raw);
    memoryStore = {
      posted: Array.isArray(store.posted) ? store.posted : [],
      accepted: Array.isArray(store.accepted) ? store.accepted : [],
    };
    return cloneStore(memoryStore);
  } catch {
    memoryStore = { posted: [], accepted: [] };
    return cloneStore(memoryStore);
  }
}

function writeStore(store) {
  memoryStore = {
    posted: Array.isArray(store.posted) ? store.posted : [],
    accepted: Array.isArray(store.accepted) ? store.accepted : [],
  };

  const dataFile = getDataFile();
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(memoryStore, null, 2));
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

module.exports = {
  MAX_STORED_TRADES,
  readStore,
  writeStore,
  canPostTrade,
  createTradeId,
};
