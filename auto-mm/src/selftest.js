const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(os.tmpdir(), `auto-mm-${process.pid}.db`);

const { quote, feeOf, feeCentsFor, parseAmount, formatAmount } = require('./money');
const { usdToRaw, stableRaw, nativeToToken } = require('./prices');
const wallet = require('./wallet');
const { validAddress, utxoNetworkBuffer, blockcypherPayments, planUtxo } = require('./chain');
const config = require('./config');
const db = require('./db');
const flow = require('./flow');

function check(name, fn) {
  fn();
  console.log(`ok ${name}`);
}

check('litecoin backup reads a payment', () => {
  const rows = blockcypherPayments({
    txs: [{
      hash: 'aa',
      confirmations: 6,
      inputs: [{ addresses: ['ltc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqx8z4n'], output_value: 200000 }],
      outputs: [
        { addresses: ['ltc1pqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpn5kw'], value: 150000 },
        { addresses: ['ltc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqx8z4n'], value: 40000 },
      ],
    }],
  }, 'ltc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqx8z4n', 'out');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].amount, 160000n);
  assert.strictEqual(rows[0].confirmations, 6);
});

check('short litecoin deposit still pays the miner', () => {
  const plan = planUtxo(142542n, 142399n, 2, 1, 5460n);
  assert.strictEqual(plan.send, 142322n);
  assert.strictEqual(plan.fee, 220n);
  assert.strictEqual(planUtxo(143000n, 142399n, 2, 1, 5460n).send, 142399n);
});

check('network buffer covers one send', () => {
  assert.strictEqual(utxoNetworkBuffer(8), 1760n);
  assert.strictEqual(utxoNetworkBuffer(2), 440n);
});

check('fee is conserved', () => {
  for (const usd of [4999n, 5000n, 29999n, 30000n, 100000n]) {
    const amount = stableRaw(usd, 6);
    for (const payer of ['sender', 'receiver', 'split']) {
      const priced = quote(amount, payer, usd);
      assert.strictEqual(priced.deposit - priced.payout, priced.fee);
      assert.ok(priced.payout > 0n);
    }
  }
  assert.throws(() => quote(1000n, 'sender'));
});

check('fee follows the USD tiers', () => {
  assert.strictEqual(feeCentsFor(1n), 0n);
  assert.strictEqual(feeCentsFor(4999n), 0n);
  assert.strictEqual(feeCentsFor(5000n), 50n);
  assert.strictEqual(feeCentsFor(29999n), 50n);
  assert.strictEqual(feeCentsFor(30000n), 100n);
  assert.strictEqual(feeOf(stableRaw(4999n, 6), 4999n), 0n);
  assert.strictEqual(feeOf(stableRaw(5000n, 6), 5000n), 500000n);
  assert.strictEqual(feeOf(stableRaw(30000n, 18), 30000n), 1000000000000000000n);
  const sol = usdToRaw(10000n, 14235000000n, 9);
  assert.strictEqual(feeOf(sol, 10000n), (sol * 50n + 9999n) / 10000n);
});

check('stable network fee is priced in the token', () => {
  assert.strictEqual(nativeToToken(3200000000000000n, 300000000000n, 18, 6), 9600000n);
});

check('usd converts into the selected coin', () => {
  assert.strictEqual(stableRaw(10000n, 6), 100000000n);
  assert.strictEqual(stableRaw(10000n, 18), 100000000000000000000n);
  assert.strictEqual(usdToRaw(10000n, 14235000000n, 9), 702493853n);
});

check('amounts round trip', () => {
  assert.strictEqual(parseAmount('1.001', 6), 1_001_000n);
  assert.strictEqual(formatAmount(1_001_000n, 6), '1.001');
  assert.strictEqual(formatAmount(1n, 8), '0.00000001');
  assert.throws(() => parseAmount('1.000000001', 8));
});

check('phrase derives each chain', () => {
  wallet.load();
  const btc = wallet.address('BTC', 0);
  const ltc = wallet.address('LTC', 0);
  const eth = wallet.address('ETH', 0);
  const sol = wallet.address('SOL', 0);
  assert.ok(btc.startsWith('bc1'));
  assert.ok(ltc.startsWith('ltc1'));
  assert.ok(eth.startsWith('0x') && eth.length === 42);
  assert.ok(sol.length >= 32);
  assert.strictEqual(validAddress('BTC', btc), true);
  assert.strictEqual(validAddress('LTC', ltc), true);
  assert.strictEqual(validAddress('ETH', eth), true);
  assert.strictEqual(validAddress('USDT-ERC20', eth), true);
  assert.strictEqual(validAddress('USDT-BEP20', eth), true);
  assert.strictEqual(validAddress('SOL', sol), true);
  assert.strictEqual(validAddress('USDT-SOL', sol), true);
  assert.strictEqual(validAddress('USDC-SOL', sol), true);
  assert.strictEqual(validAddress('BTC', eth), false);
  assert.strictEqual(validAddress('ETH', 'hello'), false);
  assert.strictEqual(wallet.address('USDT-ERC20', 0), eth);
  assert.strictEqual(wallet.address('USDT-BEP20', 0), eth);
});

check('ticket reaches a deposit address', () => {
  db.open(config.dbPath);
  const fresh = flow.createEscrow({ guildId: '1', creatorId: '111', asset: 'SOL' });
  assert.strictEqual(fresh.status, 'AWAITING_PARTNER');
  assert.strictEqual(flow.setPartner(fresh.id, '222', '333').ok, false);
  const added = flow.setPartner(fresh.id, '111', '222');
  assert.strictEqual(added.row.status, 'ROLE_SELECTION');
  assert.strictEqual(flow.setAmount(fresh.id, '111', 1000n).ok, false);
  assert.strictEqual(flow.chooseRole(fresh.id, '111', 'sender').ok, true);
  assert.strictEqual(flow.chooseRole(fresh.id, '222', 'receiver').row.status, 'ROLE_CONFIRMATION');
  flow.confirmRoles(fresh.id, '111');
  const readyForAmount = flow.confirmRoles(fresh.id, '222');
  assert.strictEqual(readyForAmount.row.status, 'AWAITING_AMOUNT');
  assert.strictEqual(flow.setAmount(fresh.id, '222', 1000n, 100n).ok, false);
  const priced = flow.setAmount(fresh.id, '111', 1000n, 100n);
  assert.strictEqual(priced.row.status, 'AMOUNT_CONFIRMATION');
  assert.strictEqual(priced.row.amount_raw, '1000');
  assert.strictEqual(priced.row.usd_raw, '100');

  const escrow = flow.createEscrow({
    guildId: '1',
    creatorId: '111',
    partnerId: '222',
    asset: 'USDT-ERC20',
    amountRaw: 100_000_000n,
  });
  flow.setChannel(escrow.id, 'channel');
  db.run('UPDATE escrows SET usd_raw = ?, price_raw = ? WHERE id = ?', '10000', '100000000', escrow.id);
  assert.strictEqual(flow.chooseRole(escrow.id, '111', 'sender').ok, true);
  assert.strictEqual(flow.chooseRole(escrow.id, '222', 'sender').ok, false);
  const roles = flow.chooseRole(escrow.id, '222', 'receiver');
  assert.strictEqual(roles.row.status, 'ROLE_CONFIRMATION');
  flow.confirmRoles(escrow.id, '111');
  const confirmed = flow.confirmRoles(escrow.id, '222');
  assert.strictEqual(confirmed.row.status, 'AMOUNT_CONFIRMATION');
  flow.confirmAmount(escrow.id, '111');
  const amountOk = flow.confirmAmount(escrow.id, '222');
  assert.strictEqual(amountOk.row.status, 'FEE_SELECTION');
  const fee = flow.chooseFee(escrow.id, '111', 'sender', 1_000_000n);
  assert.strictEqual(fee.row.status, 'FEE_CONFIRMATION');
  assert.strictEqual(fee.row.deposit_raw, '101500000');
  assert.strictEqual(fee.row.payout_raw, '100000000');
  flow.confirmFee(escrow.id, '111');
  const deposited = flow.confirmFee(escrow.id, '222');
  assert.strictEqual(deposited.row.status, 'AWAITING_DEPOSIT');
  assert.ok(deposited.row.deposit_address.startsWith('0x'));
  assert.strictEqual(deposited.row.deposit_raw, '101500000');
  const ltc = flow.createEscrow({
    guildId: '1',
    creatorId: '111',
    partnerId: '222',
    asset: 'LTC',
    amountRaw: 100_000_000n,
  });
  db.run('UPDATE escrows SET usd_raw = ?, price_raw = ? WHERE id = ?', '4000', '4000000000', ltc.id);
  flow.chooseRole(ltc.id, '111', 'sender');
  flow.chooseRole(ltc.id, '222', 'receiver');
  flow.confirmRoles(ltc.id, '111');
  flow.confirmRoles(ltc.id, '222');
  flow.confirmAmount(ltc.id, '111');
  flow.confirmAmount(ltc.id, '222');
  const withNet = flow.chooseFee(ltc.id, '111', 'sender', 5000n);
  const ltcQuote = quote(100_000_000n, 'sender', 4000n);
  assert.strictEqual(withNet.row.fee_raw, '0');
  assert.strictEqual(withNet.row.network_raw, '5000');
  assert.strictEqual(BigInt(withNet.row.deposit_raw), ltcQuote.deposit + 5000n);
  assert.strictEqual(withNet.row.payout_raw, ltcQuote.payout.toString());
  const wrong = flow.observeDeposit(escrow.id, { txid: 'wrong', amount: 1n, confirmations: 20 }, 12);
  assert.strictEqual(wrong.wrong, true);
  const pending = flow.observeDeposit(
    escrow.id,
    { txid: 'pay', amount: 101500000n, confirmations: 3 },
    12
  );
  assert.strictEqual(pending.pending, true);
  const funded = flow.observeDeposit(
    escrow.id,
    { txid: 'pay', amount: 101500000n, confirmations: 12 },
    12
  );
  assert.strictEqual(funded.funded, true);
  assert.strictEqual(flow.requestRelease(escrow.id, '222').ok, false);
  const release = flow.requestRelease(escrow.id, '111');
  assert.strictEqual(release.row.status, 'RELEASE_CONFIRMATION');
  assert.strictEqual(flow.confirmRelease(escrow.id, '111').ok, false);
  db.run('UPDATE escrows SET unlocks_at = ? WHERE id = ?', Date.now() - 1000, escrow.id);
  const asking = flow.confirmRelease(escrow.id, '111');
  assert.strictEqual(asking.row.status, 'AWAITING_PAYOUT_ADDRESS');
  const address = flow.submitAddress(escrow.id, '222', deposited.row.deposit_address);
  assert.strictEqual(address.ok, false);
  const payout = flow.submitAddress(escrow.id, '222', '0x1111111111111111111111111111111111111111');
  assert.strictEqual(payout.row.status, 'PAYOUT_CONFIRM');
});

db.close();
fs.rmSync(process.env.DB_PATH, { force: true });
for (const suffix of ['-wal', '-shm']) fs.rmSync(process.env.DB_PATH + suffix, { force: true });
console.log('all checks passed');
