const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function must(name) {
  const value = (process.env[name] || '').trim();
  if (!value) {
    const error = new Error(`Missing ${name} in .env`);
    error.public = true;
    throw error;
  }
  return value;
}

function optional(name, fallback = '') {
  const value = (process.env[name] || '').trim();
  return value || fallback;
}

module.exports = {
  token: must('DISCORD_BOT_TOKEN'),
  clientId: must('DISCORD_CLIENT_ID'),
  mnemonic: must('WALLET_MNEMONIC'),
  staffRoleId: optional('STAFF_ROLE_ID'),
  categoryId: optional('ESCROW_CATEGORY_ID'),
  ethRpc: optional('ETH_RPC', 'https://ethereum.publicnode.com'),
  bscRpc: optional('BSC_RPC', 'https://bsc-dataseed.binance.org'),
  solRpc: optional('SOL_RPC', 'https://api.mainnet-beta.solana.com'),
  btcApi: optional('BTC_API', 'https://blockstream.info/api').replace(/\/$/, ''),
  ltcApi: optional('LTC_API', 'https://litecoinspace.org/api').replace(/\/$/, ''),
  dbPath: optional('DB_PATH', path.join(__dirname, '..', 'data', 'escrow.db')),
  dealsChannelId: optional('DEALS_CHANNEL_ID', '1561503374149427260'),
};
