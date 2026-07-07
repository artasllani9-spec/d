const fs = require('fs');
const path = require('path');

const MAX_STORED_TRADES = 100;
const LOCAL_DATA_FILE = path.join(__dirname, 'data', 'trades.json');
const VERCEL_DATA_FILE = '/tmp/demandgg-trades.json';

function getDataFile() {
  if (process.env.VERCEL) return VERCEL_DATA_FILE;
  return LOCAL_DATA_FILE;
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
  seedStoreIfNeeded();

  try {
    const raw = fs.readFileSync(getDataFile(), 'utf8');
    const store = JSON.parse(raw);
    return {
      posted: Array.isArray(store.posted) ? store.posted : [],
      accepted: Array.isArray(store.accepted) ? store.accepted : [],
    };
  } catch {
    return { posted: [], accepted: [] };
  }
}

function writeStore(store) {
  const dataFile = getDataFile();
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(store, null, 2));
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
