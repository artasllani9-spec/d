const bitcoin = require('bitcoinjs-lib');
const { ECPairFactory } = require('ecpair');
const ecc = require('@bitcoinerlab/secp256k1');
const { ethers } = require('ethers');
const {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');
const {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
} = require('@solana/spl-token');
const config = require('./config');
const { getAsset } = require('./assets');
const { userError } = require('./money');
const { request } = require('./http');
const wallet = require('./wallet');

const ECPair = ECPairFactory(ecc);
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount)',
];

const providers = {};

function evmProvider(chain) {
  if (!providers[chain]) {
    const url = chain === 'bsc' ? config.bscRpc : config.ethRpc;
    const chainId = chain === 'bsc' ? 56 : 1;
    providers[chain] = new ethers.JsonRpcProvider(url, chainId, { staticNetwork: true });
  }
  return providers[chain];
}

function solana() {
  if (!providers.sol) providers.sol = new Connection(config.solRpc, 'confirmed');
  return providers.sol;
}

function apiBase(assetKey) {
  return assetKey === 'LTC' ? config.ltcApi : config.btcApi;
}

function esploraGet(assetKey, path) {
  return request(`${apiBase(assetKey)}${path}`, {
    timeoutMs: assetKey === 'LTC' ? 8000 : 20000,
  });
}

const LTC_BOOKS = {
  zelcore: 'https://blockbook.ltc.zelcore.io/api/v2',
  atomic: 'https://litecoin.atomicwallet.io/api/v2',
};
const ltcCool = {};
let ltcPrefer = 'zelcore';

function ltcOrder(names) {
  const ready = names.filter((name) => (ltcCool[name] || 0) <= Date.now());
  if (!ready.includes(ltcPrefer)) return ready;
  return [ltcPrefer, ...ready.filter((name) => name !== ltcPrefer)];
}

function coolLtc(name, error) {
  const message = String((error && error.message) || '');
  if (/429|430|403|502|503|504|timed out/i.test(message)) ltcCool[name] = Date.now() + 45000;
}

async function ltcRead(read) {
  const primaries = ltcOrder(['zelcore', 'atomic', 'space']);
  let empty = null;
  let errors = 0;
  let last;
  for (const name of primaries) {
    try {
      const value = await read(name);
      if (Array.isArray(value) && value.length === 0) {
        empty = value;
        continue;
      }
      ltcPrefer = name;
      return value;
    } catch (error) {
      errors += 1;
      last = error;
      coolLtc(name, error);
    }
  }
  if (empty && errors < primaries.length) return empty;
  if ((ltcCool.blockcypher || 0) <= Date.now()) {
    try {
      const value = await read('blockcypher');
      ltcPrefer = 'blockcypher';
      return value;
    } catch (error) {
      last = error;
      coolLtc('blockcypher', error);
    }
  }
  if (empty) return empty;
  throw last || new Error('Every Litecoin source failed.');
}

function sameUtxoAddress(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (/^(bc1|ltc1)/i.test(a) || /^(bc1|ltc1)/i.test(b)) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

function blockcypherPayments(payload, address, direction) {
  const payments = [];
  for (const tx of (payload && payload.txs) || []) {
    const received = (tx.outputs || [])
      .filter((output) => (output.addresses || []).some((item) => sameUtxoAddress(item, address)))
      .reduce((sum, output) => sum + BigInt(output.value || 0), 0n);
    const spent = (tx.inputs || [])
      .filter((input) => (input.addresses || []).some((item) => sameUtxoAddress(item, address)))
      .reduce((sum, input) => sum + BigInt(input.output_value || 0), 0n);
    const incoming = received > spent;
    if (direction === 'in' && !incoming) continue;
    if (direction === 'out' && incoming) continue;
    const amount = direction === 'in' ? received - spent : spent - received;
    if (amount <= 0n) continue;
    const outputs = (tx.outputs || []).map((output) => ({
      address: output.addresses && output.addresses[0],
      amount: BigInt(output.value || 0),
    }));
    payments.push({
      txid: tx.hash,
      amount,
      confirmations: Number(tx.confirmations || 0),
      outputs,
    });
  }
  return payments;
}

function blockscout(chain) {
  return chain === 'bsc' ? 'https://bsc.blockscout.com/api/v2' : 'https://eth.blockscout.com/api/v2';
}

function sameEvm(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function userFacing(error, fallback) {
  if (error && error.public) return error;
  const raw = String((error && error.message) || '').replace(/https?:\/\/\S+/g, '[rpc]');
  const wrapped = new Error(raw ? `${fallback} ${raw.slice(0, 180)}` : fallback);
  wrapped.public = true;
  wrapped.cause = error;
  return wrapped;
}

function normalizeAddress(assetKey, value) {
  const text = String(value || '').trim();
  const asset = getAsset(assetKey);
  if ((asset.family === 'btc' || asset.family === 'ltc') && /^(bc1|ltc1)/i.test(text)) return text.toLowerCase();
  if (asset.family === 'evm' && ethers.isAddress(text)) return ethers.getAddress(text);
  return text;
}

function validAddress(assetKey, value) {
  const text = normalizeAddress(assetKey, value);
  if (!text) return false;
  const asset = getAsset(assetKey);
  try {
    if (asset.family === 'btc' || asset.family === 'ltc') {
      bitcoin.address.toOutputScript(text, wallet.networkFor(asset.family === 'ltc' ? 'LTC' : 'BTC'));
      return true;
    }
    if (asset.family === 'evm') {
      return ethers.isAddress(text) && text !== ethers.ZeroAddress;
    }
    const key = new PublicKey(text);
    return PublicKey.isOnCurve(key.toBytes());
  } catch {
    return false;
  }
}

function utxoNetworkBuffer(rate, inputs = 1) {
  const vbytes = 11 + inputs * 68 + 31;
  const one = BigInt(Math.ceil(Number(rate) * vbytes));
  return one * 2n;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function fallbackNetworkCost(asset, leftover) {
  if (asset.kind === 'utxo') {
    return { depositExtra: utxoNetworkBuffer(asset.key === 'LTC' ? 2 : 8), relay: 0n };
  }
  if (asset.kind === 'evm-native') {
    return { depositExtra: 21000n * 20_000_000_000n * 2n, relay: 0n };
  }
  if (asset.kind === 'sol-native') {
    const rent = 890880n;
    let extra = 10000n;
    if (leftover < rent) extra += rent - leftover;
    return { depositExtra: extra, relay: 0n };
  }
  if (asset.kind === 'evm-token') {
    const gas = asset.chain === 'bsc' ? 100000n : 80000n;
    const price = asset.chain === 'bsc' ? 3_000_000_000n : 20_000_000_000n;
    return { depositExtra: 0n, relay: gas * price * 2n };
  }
  if (asset.kind === 'spl') {
    return { depositExtra: 0n, relay: 2039280n + 10000n };
  }
  return { depositExtra: 0n, relay: 0n };
}

async function evmGasPrice(chain) {
  const feeData = await withTimeout(evmProvider(chain).getFeeData(), 8000);
  const price = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (price == null || price <= 0n) throw new Error('no gas price');
  return price;
}

async function estimateNetworkCost(assetKey, leftover = 0n) {
  const asset = getAsset(assetKey);
  const left = BigInt(leftover) > 0n ? BigInt(leftover) : 0n;
  try {
    if (asset.kind === 'utxo') {
      return { depositExtra: utxoNetworkBuffer(await utxoFeeRate(assetKey)), relay: 0n };
    }
    if (asset.kind === 'evm-native') {
      return { depositExtra: 21000n * (await evmGasPrice(asset.chain)) * 2n, relay: 0n };
    }
    if (asset.kind === 'sol-native') {
      const rent = BigInt(await withTimeout(solana().getMinimumBalanceForRentExemption(0), 8000));
      let extra = 10000n;
      if (left < rent) extra += rent - left;
      return { depositExtra: extra, relay: 0n };
    }
    if (asset.kind === 'evm-token') {
      const gas = asset.chain === 'bsc' ? 100000n : 80000n;
      return { depositExtra: 0n, relay: gas * (await evmGasPrice(asset.chain)) * 2n };
    }
    if (asset.kind === 'spl') {
      const rent = BigInt(await withTimeout(solana().getMinimumBalanceForRentExemption(165), 8000));
      return { depositExtra: 0n, relay: rent + 10000n };
    }
  } catch {
    return fallbackNetworkCost(asset, left);
  }
  return { depositExtra: 0n, relay: 0n };
}

async function utxoFeeRate(assetKey) {
  try {
    const estimates = await esploraGet(assetKey, '/fee-estimates');
    const rate = Number(estimates[6] || estimates[3] || estimates[1]);
    if (Number.isFinite(rate) && rate > 0) return rate;
  } catch {
    /* use the fallback below */
  }
  return assetKey === 'LTC' ? 2 : 8;
}

function confirmedEsploraUtxos(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row.status && row.status.confirmed);
}

async function blockbookUtxos(base, address) {
  const rows = await request(`${base}/utxo/${address}`, { timeoutMs: 8000 });
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => Number(row.confirmations) > 0)
    .map((row) => ({
      txid: row.txid,
      vout: row.vout,
      value: row.value,
      status: { confirmed: true },
    }));
}

async function blockcypherUtxos(address) {
  const payload = await request(`https://api.blockcypher.com/v1/ltc/main/addrs/${address}?unspentOnly=true`, { timeoutMs: 8000 });
  return []
    .concat((payload && payload.txrefs) || [])
    .filter((row) => row && row.spent !== true && Number(row.confirmations) > 0 && row.tx_output_n != null)
    .map((row) => ({
      txid: row.tx_hash,
      vout: row.tx_output_n,
      value: row.value,
      status: { confirmed: true },
    }));
}

async function ltcUtxos(name, address) {
  if (name === 'space') return confirmedEsploraUtxos(await esploraGet('LTC', `/address/${address}/utxo`));
  if (name === 'blockcypher') return blockcypherUtxos(address);
  return blockbookUtxos(LTC_BOOKS[name], address);
}

async function listUtxos(assetKey, address) {
  if (assetKey === 'LTC') return ltcRead((name) => ltcUtxos(name, address));
  return confirmedEsploraUtxos(await esploraGet(assetKey, `/address/${address}/utxo`));
}

async function tipHeight(assetKey) {
  const height = await esploraGet(assetKey, '/blocks/tip/height');
  return Number(height);
}

async function blockbookPayments(base, address, direction) {
  const payload = await request(`${base}/address/${address}?details=txs&pageSize=25`, { timeoutMs: 8000 });
  const payments = [];
  for (const tx of (payload && payload.transactions) || []) {
    const received = (tx.vout || [])
      .filter((output) => (output.addresses || []).some((item) => sameUtxoAddress(item, address)))
      .reduce((sum, output) => sum + BigInt(output.value || 0), 0n);
    const spent = (tx.vin || [])
      .filter((input) => (input.addresses || []).some((item) => sameUtxoAddress(item, address)))
      .reduce((sum, input) => sum + BigInt(input.value || 0), 0n);
    const incoming = received > spent;
    if (direction === 'in' && !incoming) continue;
    if (direction === 'out' && incoming) continue;
    const amount = direction === 'in' ? received - spent : spent - received;
    if (amount <= 0n) continue;
    payments.push({
      txid: tx.txid,
      amount,
      confirmations: Number(tx.confirmations || 0),
      outputs: (tx.vout || []).map((output) => ({
        address: output.addresses && output.addresses[0],
        amount: BigInt(output.value || 0),
      })),
    });
  }
  return payments;
}

async function ltcPayments(name, address, direction) {
  if (name === 'space') return esploraPayments('LTC', address, direction);
  if (name === 'blockcypher') {
    const payload = await request(`https://api.blockcypher.com/v1/ltc/main/addrs/${address}/full?limit=50`, { timeoutMs: 8000 });
    return blockcypherPayments(payload, address, direction);
  }
  return blockbookPayments(LTC_BOOKS[name], address, direction);
}

async function utxoPayments(assetKey, address, direction) {
  if (assetKey === 'LTC') return ltcRead((name) => ltcPayments(name, address, direction));
  return esploraPayments(assetKey, address, direction);
}

async function esploraPayments(assetKey, address, direction) {
  const [txs, tip] = await Promise.all([
    esploraGet(assetKey, `/address/${address}/txs`),
    tipHeight(assetKey),
  ]);
  const payments = [];
  for (const tx of Array.isArray(txs) ? txs : []) {
    const received = (tx.vout || [])
      .filter((output) => sameUtxoAddress(output.scriptpubkey_address, address))
      .reduce((sum, output) => sum + BigInt(output.value), 0n);
    const spent = (tx.vin || [])
      .filter((input) => input.prevout && sameUtxoAddress(input.prevout.scriptpubkey_address, address))
      .reduce((sum, input) => sum + BigInt(input.prevout.value), 0n);
    const incoming = received > spent;
    if (direction === 'in' && !incoming) continue;
    if (direction === 'out' && incoming) continue;
    const amount = direction === 'in' ? received - spent : spent - received;
    if (amount <= 0n) continue;
    let confirmations = 0;
    if (tx.status && tx.status.confirmed && tx.status.block_height != null && Number.isFinite(tip)) {
      confirmations = tip - Number(tx.status.block_height) + 1;
    }
    const outputs = (tx.vout || []).map((output) => ({
      address: output.scriptpubkey_address,
      amount: BigInt(output.value),
    }));
    payments.push({ txid: tx.txid, amount, confirmations, outputs });
  }
  return payments;
}

async function evmNativePayments(chain, address) {
  const payload = await request(`${blockscout(chain)}/addresses/${address}/transactions`);
  const items = payload && Array.isArray(payload.items) ? payload.items : [];
  return items
    .filter((item) => item.status === 'ok' || item.result === 'success' || item.status === 'success')
    .map((item) => ({
      txid: item.hash,
      from: item.from && item.from.hash,
      to: item.to && item.to.hash,
      amount: BigInt(item.value || '0'),
      confirmations: Number(item.confirmations || 0),
    }));
}

async function evmTokenPayments(chain, address, contract) {
  const payload = await request(`${blockscout(chain)}/addresses/${address}/token-transfers?type=ERC-20`);
  const items = payload && Array.isArray(payload.items) ? payload.items : [];
  const matched = items.filter((item) => {
    const token = item.token && (item.token.address_hash || item.token.address);
    return sameEvm(token, contract);
  });
  const payments = [];
  for (const item of matched) {
    const txid = item.tx_hash || item.transaction_hash;
    let confirmations = Number(item.confirmations || 0);
    if (!confirmations && txid) {
      try {
        const tx = await request(`${blockscout(chain)}/transactions/${txid}`);
        confirmations = Number(tx.confirmations || 0);
        if (!confirmations && tx.status && tx.status !== 'ok') continue;
      } catch {
        confirmations = 0;
      }
    }
    payments.push({
      txid,
      from: item.from && item.from.hash,
      to: item.to && item.to.hash,
      amount: BigInt(item.total && item.total.value ? item.total.value : '0'),
      confirmations,
    });
  }
  return payments;
}

function solConfirmations(status) {
  if (status === 'finalized') return 32;
  if (status === 'confirmed') return 1;
  return 0;
}

function solKeys(message) {
  const keys = message.accountKeys || [];
  return keys.map((key) => (typeof key === 'string' ? key : key.pubkey));
}

async function solanaTransactions(address) {
  const connection = solana();
  const key = new PublicKey(address);
  const signatures = await connection.getSignaturesForAddress(key, { limit: 25 });
  if (signatures.length === 0) return [];
  const parsed = await connection.getParsedTransactions(
    signatures.map((row) => row.signature),
    { maxSupportedTransactionVersion: 0 }
  );
  return signatures.map((row, index) => ({
    signature: row.signature,
    confirmations: solConfirmations(row.confirmationStatus),
    parsed: parsed[index],
  })).filter((row) => row.parsed && !row.parsed.meta?.err);
}

async function incoming(assetKey, address) {
  const asset = getAsset(assetKey);
  if (asset.kind === 'utxo') {
    const rows = await utxoPayments(assetKey, address, 'in');
    return rows.map((row) => ({ txid: row.txid, amount: row.amount, confirmations: row.confirmations }));
  }
  if (asset.kind === 'evm-native') {
    const rows = await evmNativePayments(asset.chain, address);
    return rows
      .filter((row) => sameEvm(row.to, address) && row.amount > 0n)
      .map((row) => ({ txid: row.txid, amount: row.amount, confirmations: row.confirmations }));
  }
  if (asset.kind === 'evm-token') {
    const rows = await evmTokenPayments(asset.chain, address, asset.contract);
    return rows
      .filter((row) => sameEvm(row.to, address) && row.amount > 0n)
      .map((row) => ({ txid: row.txid, amount: row.amount, confirmations: row.confirmations }));
  }
  const rows = await solanaTransactions(address);
  const payments = [];
  for (const row of rows) {
    if (asset.kind === 'sol-native') {
      const keys = solKeys(row.parsed.transaction.message);
      const index = keys.indexOf(address);
      if (index < 0) continue;
      const delta = BigInt(row.parsed.meta.postBalances[index]) - BigInt(row.parsed.meta.preBalances[index]);
      if (delta > 0n) payments.push({ txid: row.signature, amount: delta, confirmations: row.confirmations });
    } else {
      const after = (row.parsed.meta.postTokenBalances || []).find(
        (balance) => balance.owner === address && balance.mint === asset.mint
      );
      const before = (row.parsed.meta.preTokenBalances || []).find(
        (balance) => balance.owner === address && balance.mint === asset.mint
      );
      const next = BigInt(after ? after.uiTokenAmount.amount : '0');
      const prev = BigInt(before ? before.uiTokenAmount.amount : '0');
      if (next > prev) payments.push({ txid: row.signature, amount: next - prev, confirmations: row.confirmations });
    }
  }
  return payments;
}

async function findOutgoing(assetKey, from, to, amount) {
  const asset = getAsset(assetKey);
  const expected = BigInt(amount);
  if (asset.kind === 'utxo') {
    const rows = await utxoPayments(assetKey, from, 'out');
    return rows.find((row) => row.outputs.some((output) => sameUtxoAddress(output.address, to) && output.amount === expected)) || null;
  }
  if (asset.kind === 'evm-native') {
    const rows = await evmNativePayments(asset.chain, from);
    return rows.find((row) => sameEvm(row.from, from) && sameEvm(row.to, to) && row.amount === expected) || null;
  }
  if (asset.kind === 'evm-token') {
    const rows = await evmTokenPayments(asset.chain, from, asset.contract);
    return rows.find((row) => sameEvm(row.from, from) && sameEvm(row.to, to) && row.amount === expected) || null;
  }
  const rows = await solanaTransactions(from);
  for (const row of rows) {
    if (asset.kind === 'sol-native') {
      const keys = solKeys(row.parsed.transaction.message);
      const dest = keys.indexOf(to);
      if (dest < 0) continue;
      const delta = BigInt(row.parsed.meta.postBalances[dest]) - BigInt(row.parsed.meta.preBalances[dest]);
      if (delta === expected) return { txid: row.signature, amount: delta, confirmations: row.confirmations };
    } else {
      const after = (row.parsed.meta.postTokenBalances || []).find(
        (balance) => balance.owner === to && balance.mint === asset.mint
      );
      const before = (row.parsed.meta.preTokenBalances || []).find(
        (balance) => balance.owner === to && balance.mint === asset.mint
      );
      const next = BigInt(after ? after.uiTokenAmount.amount : '0');
      const prev = BigInt(before ? before.uiTokenAmount.amount : '0');
      if (next - prev === expected) return { txid: row.signature, amount: expected, confirmations: row.confirmations };
    }
  }
  return null;
}

async function balanceOf(assetKey, address) {
  const asset = getAsset(assetKey);
  if (asset.kind === 'utxo') {
    const utxos = await listUtxos(assetKey, address);
    return utxos.reduce((sum, utxo) => sum + BigInt(utxo.value), 0n);
  }
  if (asset.kind === 'evm-native') {
    return evmProvider(asset.chain).getBalance(address);
  }
  if (asset.kind === 'evm-token') {
    const contract = new ethers.Contract(asset.contract, ERC20_ABI, evmProvider(asset.chain));
    return contract.balanceOf(address);
  }
  const connection = solana();
  const owner = new PublicKey(address);
  if (asset.kind === 'sol-native') return BigInt(await connection.getBalance(owner));
  const mint = new PublicKey(asset.mint);
  const ata = await getAssociatedTokenAddress(mint, owner);
  try {
    const account = await getAccount(connection, ata);
    return account.amount;
  } catch {
    return 0n;
  }
}

function planUtxo(total, amount, rate, inputs, dust) {
  const oneOut = 11 + inputs * 68 + 31;
  const twoOut = oneOut + 31;
  const minTwo = BigInt(Math.ceil(twoOut * Number(rate)));
  const minOne = BigInt(Math.ceil(oneOut * Number(rate)));
  let send = BigInt(amount);
  let fee = minTwo;
  let change = total - send - fee;
  if (change < dust) {
    if (total < send + minOne) send = total - minOne;
    if (send < dust) return null;
    change = 0n;
    fee = total - send;
  }
  if (fee < minOne || total < send + fee || send <= 0n) return null;
  return { send, fee, change };
}

async function fitUtxoAmount(assetKey, index, amount) {
  const asset = getAsset(assetKey);
  const payment = wallet.utxoPayment(assetKey, index);
  const utxos = await listUtxos(assetKey, payment.address);
  if (utxos.length === 0) throw userError('The deposit address has no confirmed coins to send yet.');
  const total = utxos.reduce((sum, utxo) => sum + BigInt(utxo.value), 0n);
  const dust = assetKey === 'LTC' ? 5460n : 546n;
  const plan = planUtxo(total, amount, await utxoFeeRate(assetKey), utxos.length, dust);
  if (!plan) throw userError(`The deposit address needs more ${asset.symbol} to pay the network fee.`);
  return plan.send;
}

async function sendUtxo(assetKey, index, to, amount) {
  const asset = getAsset(assetKey);
  const network = wallet.networkFor(assetKey);
  const node = wallet.utxoNode(assetKey, index);
  const payment = wallet.utxoPayment(assetKey, index);
  const utxos = await listUtxos(assetKey, payment.address);
  if (utxos.length === 0) throw userError('The deposit address has no confirmed coins to send yet.');
  const total = utxos.reduce((sum, utxo) => sum + BigInt(utxo.value), 0n);
  const dust = assetKey === 'LTC' ? 5460n : 546n;
  const plan = planUtxo(total, amount, await utxoFeeRate(assetKey), utxos.length, dust);
  if (!plan) throw userError(`The deposit address needs more ${asset.symbol} to pay the network fee.`);
  amount = plan.send;
  const { change } = plan;
  const pair = ECPair.fromPrivateKey(node.privateKey);
  const psbt = new bitcoin.Psbt({ network });
  for (const utxo of utxos) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: { script: payment.output, value: Number(utxo.value) },
    });
  }
  psbt.addOutput({ address: to, value: Number(amount) });
  if (change > 0n) psbt.addOutput({ address: payment.address, value: Number(change) });
  for (let i = 0; i < utxos.length; i += 1) psbt.signInput(i, pair);
  psbt.finalizeAllInputs();
  const hex = psbt.extractTransaction().toHex();
  return { txid: await broadcastUtxo(assetKey, hex), amount };
}

function txidOf(value) {
  const id = String(value || '').trim();
  return /^[a-f0-9]{64}$/i.test(id) ? id : '';
}

async function ltcPush(name, hex) {
  if (name === 'space') return txidOf(await request(`${config.ltcApi}/tx`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: hex,
    timeoutMs: 8000,
  }));
  if (name === 'blockcypher') {
    const payload = await request('https://api.blockcypher.com/v1/ltc/main/txs/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tx: hex }),
      timeoutMs: 8000,
    });
    return txidOf(payload && payload.tx && payload.tx.hash);
  }
  const payload = await request(`${LTC_BOOKS[name]}/sendtx/`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: hex,
    timeoutMs: 8000,
  });
  return txidOf(payload && payload.result);
}

async function broadcastUtxo(assetKey, hex) {
  if (assetKey !== 'LTC') {
    const txid = txidOf(await request(`${apiBase(assetKey)}/tx`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: hex,
    }));
    if (!txid) throw userError('The network returned an unreadable transaction id.');
    return txid;
  }
  const names = ['zelcore', 'atomic', 'space', 'blockcypher'];
  const ordered = names.includes(ltcPrefer) ? [ltcPrefer, ...names.filter((name) => name !== ltcPrefer)] : names;
  let last;
  for (const name of ordered) {
    try {
      const txid = await ltcPush(name, hex);
      if (!txid) throw userError('The network returned an unreadable transaction id.');
      ltcPrefer = name;
      return txid;
    } catch (error) {
      last = error;
      console.error(`[ltc] ${name} broadcast failed`, error.message);
      coolLtc(name, error);
    }
  }
  throw last || userError('The transfer could not be broadcast.');
}

async function sendEvm(asset, index, to, amount) {
  const provider = evmProvider(asset.chain);
  const signer = wallet.evmWallet(index).connect(provider);
  const feeData = await provider.getFeeData();
  const price = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (price == null) throw userError('Could not read the network fee. Try again in a minute.');
  if (asset.kind === 'evm-native') {
    const gasLimit = 21000n;
    const needed = amount + gasLimit * price;
    const balance = await provider.getBalance(signer.address);
    if (balance < needed) {
      throw userError(`The deposit address needs more ${asset.symbol} to pay the network fee.`);
    }
    const tx = await signer.sendTransaction({ to, value: amount, gasLimit });
    return tx.hash;
  }
  const contract = new ethers.Contract(asset.contract, ERC20_ABI, signer);
  const tokenBalance = await contract.balanceOf(signer.address);
  if (tokenBalance < amount) throw userError('The deposit address does not have the token amount to send.');
  const data = contract.interface.encodeFunctionData('transfer', [to, amount]);
  let gasLimit = 120000n;
  try {
    gasLimit = (await signer.estimateGas({ to: asset.contract, data })) * 12n / 10n;
  } catch {
    gasLimit = 120000n;
  }
  const native = await provider.getBalance(signer.address);
  if (native < gasLimit * price) {
    throw userError(
      `The deposit address needs a small amount of ${asset.gasSymbol} to pay the network fee before the tokens can be sent.`
    );
  }
  const tx = await signer.sendTransaction({ to: asset.contract, data, gasLimit });
  return tx.hash;
}

async function sendSol(asset, index, to, amount) {
  const connection = solana();
  const signer = wallet.solanaKeypair(index);
  const destination = new PublicKey(to);
  const balance = BigInt(await connection.getBalance(signer.publicKey));
  if (asset.kind === 'sol-native') {
    const fee = 5000n;
    const rent = BigInt(await connection.getMinimumBalanceForRentExemption(0));
    if (balance < amount + fee) throw userError('The deposit address needs more SOL to pay the network fee.');
    const remain = balance - amount - fee;
    if (remain > 0n && remain < rent) {
      throw userError('Send a little extra SOL to the deposit address so the network fee can be paid.');
    }
    const tx = new Transaction().add(SystemProgram.transfer({
      fromPubkey: signer.publicKey,
      toPubkey: destination,
      lamports: amount,
    }));
    return sendAndConfirmTransaction(connection, tx, [signer]);
  }
  const mint = new PublicKey(asset.mint);
  const fromAta = await getAssociatedTokenAddress(mint, signer.publicKey);
  const toAta = await getAssociatedTokenAddress(mint, destination);
  const source = await getAccount(connection, fromAta).catch(() => null);
  if (!source || source.amount < amount) throw userError('The deposit address does not have the token amount to send.');
  const instructions = [];
  const destinationAccount = await connection.getAccountInfo(toAta);
  let rent = 0n;
  if (!destinationAccount) {
    rent = BigInt(await connection.getMinimumBalanceForRentExemption(165));
    instructions.push(createAssociatedTokenAccountInstruction(signer.publicKey, toAta, destination, mint));
  }
  if (balance < rent + 5000n) {
    throw userError('The deposit address needs a small amount of SOL to pay the network fee before the tokens can be sent.');
  }
  instructions.push(createTransferInstruction(fromAta, toAta, signer.publicKey, amount));
  const tx = new Transaction().add(...instructions);
  return sendAndConfirmTransaction(connection, tx, [signer]);
}

async function sendPayment(assetKey, index, to, amount) {
  const asset = getAsset(assetKey);
  try {
    if (asset.kind === 'utxo') return await sendUtxo(assetKey, index, to, amount);
    if (asset.family === 'evm') return { txid: await sendEvm(asset, index, to, amount), amount };
    return { txid: await sendSol(asset, index, to, amount), amount };
  } catch (error) {
    throw userFacing(error, 'The transfer could not be broadcast. The ticket was not marked complete.');
  }
}

async function readTokenDecimals(asset) {
  if (asset.kind === 'evm-token') {
    const contract = new ethers.Contract(asset.contract, ERC20_ABI, evmProvider(asset.chain));
    return Number(await contract.decimals());
  }
  if (asset.kind === 'spl') {
    const mint = await solana().getParsedAccountInfo(new PublicKey(asset.mint));
    return mint.value.data.parsed.info.decimals;
  }
  return asset.decimals;
}

module.exports = {
  normalizeAddress,
  validAddress,
  incoming,
  blockcypherPayments,
  findOutgoing,
  balanceOf,
  sendPayment,
  readTokenDecimals,
  estimateNetworkCost,
  utxoNetworkBuffer,
  planUtxo,
  fitUtxoAmount,
};
