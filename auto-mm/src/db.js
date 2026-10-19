const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

let database;

function open(dbPath) {
  if (database) return database;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  database = new Database(dbPath);
  database.pragma('journal_mode = WAL');
  database.exec(`
    CREATE TABLE IF NOT EXISTS escrows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT,
      creator_id TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      sender_id TEXT,
      receiver_id TEXT,
      asset TEXT,
      amount_raw TEXT,
      fee_raw TEXT,
      network_raw TEXT,
      deposit_raw TEXT,
      received_raw TEXT,
      payout_raw TEXT,
      fee_payer TEXT,
      status TEXT NOT NULL,
      hd_family TEXT,
      hd_index INTEGER,
      deposit_address TEXT,
      deposit_tx TEXT,
      deposit_confirmations INTEGER NOT NULL DEFAULT 0,
      notice_tx TEXT,
      payout_address TEXT,
      payout_tx TEXT,
      settlement TEXT,
      role_ok_sender INTEGER NOT NULL DEFAULT 0,
      role_ok_receiver INTEGER NOT NULL DEFAULT 0,
      amount_ok_sender INTEGER NOT NULL DEFAULT 0,
      amount_ok_receiver INTEGER NOT NULL DEFAULT 0,
      fee_ok_sender INTEGER NOT NULL DEFAULT 0,
      fee_ok_receiver INTEGER NOT NULL DEFAULT 0,
      prompt_message_id TEXT,
      unlocks_at INTEGER,
      idle_warned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS used_txs (
      txid TEXT NOT NULL,
      asset TEXT NOT NULL,
      escrow_id INTEGER NOT NULL,
      purpose TEXT NOT NULL,
      PRIMARY KEY (txid, asset)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      escrow_id INTEGER,
      actor_id TEXT,
      event TEXT NOT NULL,
      detail TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stat_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      cents TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      amount_text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_hd ON escrows(hd_family, hd_index);
  `);
  const names = new Set(database.prepare('PRAGMA table_info(escrows)').all().map((column) => column.name));
  if (!names.has('usd_raw')) database.exec('ALTER TABLE escrows ADD COLUMN usd_raw TEXT');
  if (!names.has('price_raw')) database.exec('ALTER TABLE escrows ADD COLUMN price_raw TEXT');
  if (!names.has('received_raw')) database.exec('ALTER TABLE escrows ADD COLUMN received_raw TEXT');
  if (!names.has('network_raw')) database.exec('ALTER TABLE escrows ADD COLUMN network_raw TEXT');
  if (!names.has('amount_ok_sender')) database.exec('ALTER TABLE escrows ADD COLUMN amount_ok_sender INTEGER NOT NULL DEFAULT 0');
  if (!names.has('amount_ok_receiver')) database.exec('ALTER TABLE escrows ADD COLUMN amount_ok_receiver INTEGER NOT NULL DEFAULT 0');
  if (!names.has('idle_warned')) database.exec('ALTER TABLE escrows ADD COLUMN idle_warned INTEGER NOT NULL DEFAULT 0');
  return database;
}

function tx(fn) {
  return database.transaction(fn)();
}

function get(sql, ...params) {
  return database.prepare(sql).get(...params) || null;
}

function all(sql, ...params) {
  return database.prepare(sql).all(...params);
}

function run(sql, ...params) {
  return database.prepare(sql).run(...params);
}

function close() {
  if (!database) return;
  database.close();
  database = null;
}

module.exports = { open, tx, get, all, run, close };
