const { getAsset } = require('./assets');

function userError(message) {
  const error = new Error(message);
  error.public = true;
  return error;
}

function parseAmount(input, decimals) {
  const text = String(input || '').trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(text)) throw userError('Enter the amount as a number, such as 100 or 0.015.');
  const [whole, fraction = ''] = text.split('.');
  if (whole.length > 12) throw userError('That amount is too large.');
  if (fraction.length > decimals) {
    throw userError(`This coin only supports ${decimals} decimal places.`);
  }
  const scale = 10n ** BigInt(decimals);
  const raw = BigInt(whole) * scale + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (raw <= 0n) throw userError('Enter an amount greater than 0.');
  return raw;
}

function formatAmount(raw, decimals) {
  const negative = raw < 0n;
  const value = negative ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  const text = fraction ? `${whole}.${fraction}` : whole.toString();
  return negative ? `-${text}` : text;
}

function formatAssetAmount(raw, assetKey) {
  const asset = getAsset(assetKey);
  return `${formatAmount(BigInt(raw), asset.decimals)} ${asset.symbol}`;
}

/** 0.1% rounded up so the fee can never round down to zero. */
function feeOf(amount) {
  if (amount <= 0n) throw userError('Enter an amount greater than 0.');
  return (amount + 999n) / 1000n;
}

function quote(amount, payer) {
  const fee = feeOf(amount);
  if (payer === 'sender') {
    return { fee, deposit: amount + fee, payout: amount };
  }
  if (payer === 'receiver') {
    if (amount <= fee) throw userError('This amount is too small for the Receiver to pay the fee.');
    return { fee, deposit: amount, payout: amount - fee };
  }
  if (payer === 'split') {
    const senderExtra = (fee + 1n) / 2n;
    const receiverCut = fee - senderExtra;
    if (amount <= receiverCut) throw userError('This amount is too small to split the fee.');
    return { fee, deposit: amount + senderExtra, payout: amount - receiverCut };
  }
  throw userError('Choose who pays the fee.');
}

module.exports = { userError, parseAmount, formatAmount, formatAssetAmount, feeOf, quote };
