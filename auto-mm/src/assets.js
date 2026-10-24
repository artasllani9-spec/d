const ASSETS = {
  BTC: {
    key: 'BTC',
    label: 'BTC',
    symbol: 'BTC',
    family: 'btc',
    kind: 'utxo',
    decimals: 8,
    confirmations: 2,
  },
  LTC: {
    key: 'LTC',
    label: 'LTC',
    symbol: 'LTC',
    family: 'ltc',
    kind: 'utxo',
    decimals: 8,
    confirmations: 6,
  },
  ETH: {
    key: 'ETH',
    label: 'ETH',
    symbol: 'ETH',
    family: 'evm',
    kind: 'evm-native',
    chain: 'eth',
    gasSymbol: 'ETH',
    decimals: 18,
    confirmations: 12,
  },
  SOL: {
    key: 'SOL',
    label: 'SOL',
    symbol: 'SOL',
    family: 'sol',
    kind: 'sol-native',
    decimals: 9,
    confirmations: 32,
  },
  'USDT-ERC20': {
    key: 'USDT-ERC20',
    label: 'USDT (ERC-20)',
    symbol: 'USDT',
    family: 'evm',
    kind: 'evm-token',
    chain: 'eth',
    gasSymbol: 'ETH',
    decimals: 6,
    contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    confirmations: 12,
  },
  'USDC-ERC20': {
    key: 'USDC-ERC20',
    label: 'USDC (ERC-20)',
    symbol: 'USDC',
    family: 'evm',
    kind: 'evm-token',
    chain: 'eth',
    gasSymbol: 'ETH',
    decimals: 6,
    contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    confirmations: 12,
  },
  'USDT-BEP20': {
    key: 'USDT-BEP20',
    label: 'USDT (BEP-20)',
    symbol: 'USDT',
    family: 'evm',
    kind: 'evm-token',
    chain: 'bsc',
    gasSymbol: 'BNB',
    decimals: 18,
    contract: '0x55d398326f99059fF775485246999027B3197955',
    confirmations: 15,
  },
  'USDC-BEP20': {
    key: 'USDC-BEP20',
    label: 'USDC (BEP-20)',
    symbol: 'USDC',
    family: 'evm',
    kind: 'evm-token',
    chain: 'bsc',
    gasSymbol: 'BNB',
    decimals: 18,
    contract: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    confirmations: 15,
  },
  'USDT-SOL': {
    key: 'USDT-SOL',
    label: 'USDT (SOL)',
    symbol: 'USDT',
    family: 'sol',
    kind: 'spl',
    decimals: 6,
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    confirmations: 32,
  },
  'USDC-SOL': {
    key: 'USDC-SOL',
    label: 'USDC (SOL)',
    symbol: 'USDC',
    family: 'sol',
    kind: 'spl',
    decimals: 6,
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    confirmations: 32,
  },
};

const ASSET_LIST = Object.values(ASSETS);

const SLUGS = {
  BTC: 'btc',
  ETH: 'eth',
  LTC: 'ltc',
  SOL: 'sol',
  'USDT-ERC20': 'usdteth',
  'USDC-ERC20': 'usdceth',
  'USDT-BEP20': 'usdtbnb',
  'USDC-BEP20': 'usdcbnb',
  'USDT-SOL': 'usdtsol',
  'USDC-SOL': 'usdcsol',
};

const CATEGORIES = {
  BTC: 'BTC',
  ETH: 'ETH',
  LTC: 'LTC',
  SOL: 'SOL',
  'USDT-ERC20': 'USDT ETH',
  'USDC-ERC20': 'USDC ETH',
  'USDT-BEP20': 'USDT BNB',
  'USDC-BEP20': 'USDC BNB',
  'USDT-SOL': 'USDT SOL',
  'USDC-SOL': 'USDC SOL',
};

function ticketName(assetKey, id) {
  return `${SLUGS[assetKey] || 'ticket'}-${id}`;
}

function categoryName(assetKey) {
  return CATEGORIES[assetKey] || 'Escrow';
}

function getAsset(key) {
  const asset = ASSETS[key];
  if (!asset) {
    const error = new Error('Choose one of the listed coins.');
    error.public = true;
    throw error;
  }
  return asset;
}

module.exports = { ASSETS, ASSET_LIST, getAsset, ticketName, categoryName };
