const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function first(...names) {
  for (const name of names) {
    const value = (process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function must(...names) {
  const value = first(...names);
  if (!value) {
    const error = new Error(`Missing ${names.join(' or ')} in .env`);
    error.public = true;
    throw error;
  }
  return value;
}

function isEnvName(name) {
  return typeof name === 'string' && /^[A-Z][A-Z0-9_]*$/.test(name);
}

function optional(...args) {
  if (args.length === 0) return '';
  const last = args[args.length - 1];
  const lastIsEnv = isEnvName(last);
  const names = lastIsEnv ? args : args.slice(0, -1);
  const fallback = lastIsEnv ? '' : String(last ?? '');
  return first(...names) || fallback;
}

module.exports = {
  token: must('AUTO_MM_DISCORD_BOT_TOKEN', 'DISCORD_BOT_TOKEN'),
  clientId: must('AUTO_MM_DISCORD_CLIENT_ID', 'DISCORD_CLIENT_ID'),
  mnemonic: must('AUTO_MM_WALLET_MNEMONIC', 'WALLET_MNEMONIC'),
  staffRoleId: optional('AUTO_MM_STAFF_ROLE_ID', 'STAFF_ROLE_ID'),
  categoryId: optional('AUTO_MM_ESCROW_CATEGORY_ID', 'ESCROW_CATEGORY_ID'),
  ethRpc: optional('ETH_RPC', 'https://ethereum.publicnode.com'),
  bscRpc: optional('BSC_RPC', 'https://bsc-dataseed.binance.org'),
  solRpc: optional('SOL_RPC', 'https://api.mainnet-beta.solana.com'),
  btcApi: optional('BTC_API', 'https://blockstream.info/api').replace(/\/$/, ''),
  ltcApi: optional('LTC_API', 'https://litecoinspace.org/api').replace(/\/$/, ''),
  dbPath: optional('AUTO_MM_DB_PATH', 'DB_PATH', path.join(__dirname, '..', 'data', 'escrow.db')),
  dealsChannelId: optional('AUTO_MM_DEALS_CHANNEL_ID', 'DEALS_CHANNEL_ID', '1561503374149427260'),
};
