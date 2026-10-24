const { getAsset } = require('./assets');
const { userError } = require('./money');
const { request } = require('./http');

const PAIRS = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  LTC: 'LTCUSDT',
  SOL: 'SOLUSDT',
  BNB: 'BNBUSDT',
};

const SPOT = {
  BTC: 'BTC-USD',
  ETH: 'ETH-USD',
  LTC: 'LTC-USD',
  SOL: 'SOL-USD',
  BNB: 'BNB-USD',
};

function isStable(assetKey) {
  const asset = getAsset(assetKey);
  return asset.symbol === 'USDT' || asset.symbol === 'USDC';
}

function parsePrice(text) {
  const clean = String(text || '').trim();
  if (!/^\d+(\.\d+)?$/.test(clean)) throw userError('The price feed returned an unreadable rate.');
  const [whole, fraction = ''] = clean.split('.');
  const padded = fraction.slice(0, 8).padEnd(8, '0');
  const raw = BigInt(whole) * 100000000n + BigInt(padded);
  if (raw <= 0n) throw userError('The price feed returned a zero rate.');
  return raw;
}

function usdToRaw(usdCents, priceRaw, decimals) {
  const numerator = usdCents * (10n ** (8n + BigInt(decimals)));
  const denominator = priceRaw * 100n;
  return (numerator + denominator / 2n) / denominator;
}

function stableRaw(usdCents, decimals) {
  return usdCents * (10n ** BigInt(decimals - 2));
}

function nativeToToken(nativeRaw, priceRaw, nativeDecimals, tokenDecimals) {
  const denom = (10n ** BigInt(nativeDecimals)) * 100000000n;
  const num = BigInt(nativeRaw) * BigInt(priceRaw) * (10n ** BigInt(tokenDecimals));
  if (num <= 0n) return 0n;
  return (num + denom - 1n) / denom;
}

function gasCoin(assetKey) {
  const asset = getAsset(assetKey);
  if (asset.kind === 'spl') return { key: 'SOL', decimals: 9 };
  if (asset.kind === 'evm-token') return { key: asset.chain === 'bsc' ? 'BNB' : 'ETH', decimals: 18 };
  return null;
}

async function stableNetworkFee(assetKey, nativeRaw) {
  const gas = gasCoin(assetKey);
  if (!gas || BigInt(nativeRaw) <= 0n) return 0n;
  let priceRaw;
  try {
    priceRaw = await spotPrice(gas.key);
  } catch {
    throw userError(`Could not read the ${gas.key} price. Try again in a moment.`);
  }
  const raw = nativeToToken(nativeRaw, priceRaw, gas.decimals, getAsset(assetKey).decimals);
  if (raw <= 0n) throw userError(`Could not price the ${gas.key} network fee. Try again in a moment.`);
  return raw;
}

async function spotPrice(assetKey) {
  const pair = PAIRS[assetKey];
  const spot = SPOT[assetKey];
  try {
    const ticker = await request(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`);
    return parsePrice(ticker.price);
  } catch {
    const quote = await request(`https://api.coinbase.com/v2/prices/${spot}/spot`);
    return parsePrice(quote.data.amount);
  }
}

async function quoteUsd(assetKey, usdCents) {
  const asset = getAsset(assetKey);
  if (usdCents <= 0n) throw userError('Enter a USD amount greater than 0.');
  if (isStable(assetKey)) {
    return { raw: stableRaw(usdCents, asset.decimals), priceRaw: 100000000n };
  }
  let priceRaw;
  try {
    priceRaw = await spotPrice(assetKey);
  } catch {
    throw userError(`Could not read the ${asset.symbol} price. Try again in a moment.`);
  }
  const raw = usdToRaw(usdCents, priceRaw, asset.decimals);
  if (raw <= 0n) throw userError(`That USD amount is too small to convert into ${asset.symbol}.`);
  return { raw, priceRaw };
}

module.exports = { isStable, parsePrice, usdToRaw, stableRaw, nativeToToken, stableNetworkFee, quoteUsd };
