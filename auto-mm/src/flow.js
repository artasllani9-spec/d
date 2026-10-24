const db = require('./db');
const { getAsset } = require('./assets');
const { quote } = require('./money');
const wallet = require('./wallet');

const EARLY = [
  'AWAITING_PARTNER',
  'ROLE_SELECTION',
  'ROLE_CONFIRMATION',
  'AWAITING_AMOUNT',
  'AMOUNT_CONFIRMATION',
  'FEE_SELECTION',
  'FEE_CONFIRMATION',
];
const COLUMNS = new Set([
  'channel_id', 'partner_id', 'sender_id', 'receiver_id', 'asset', 'amount_raw', 'usd_raw', 'price_raw', 'fee_raw', 'network_raw', 'deposit_raw', 'received_raw',
  'payout_raw', 'fee_payer', 'status', 'hd_family', 'hd_index', 'deposit_address', 'deposit_tx',
  'deposit_confirmations', 'notice_tx', 'payout_address', 'payout_tx', 'settlement',
  'role_ok_sender', 'role_ok_receiver', 'amount_ok_sender', 'amount_ok_receiver', 'fee_ok_sender', 'fee_ok_receiver', 'prompt_message_id',
  'unlocks_at', 'idle_warned',
]);

function fail(message) {
  return { ok: false, error: message };
}

function ok(row, extra = {}) {
  return { ok: true, row, ...extra };
}

function isParticipant(row, userId) {
  return userId === row.creator_id || (row.partner_id && userId === row.partner_id);
}

function audit(escrowId, actorId, event, detail = '') {
  db.run(
    'INSERT INTO audit_log (escrow_id, actor_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)',
    escrowId,
    actorId || '',
    event,
    detail,
    Date.now()
  );
  console.log(`[escrow ${escrowId}] ${event}`);
}

function getEscrow(id) {
  return db.get('SELECT * FROM escrows WHERE id = ?', id);
}

function getByChannel(channelId) {
  return db.get(
    "SELECT * FROM escrows WHERE channel_id = ? AND status != 'CLOSED' ORDER BY id DESC LIMIT 1",
    channelId
  );
}

function save(id, fromStatuses, fields) {
  const keys = Object.keys(fields);
  for (const key of keys) {
    if (!COLUMNS.has(key)) throw new Error(`Unknown escrow column ${key}`);
  }
  const assignments = keys.map((key) => `${key} = ?`).join(', ');
  const params = keys.map((key) => fields[key]);
  params.push(Date.now(), id, ...fromStatuses);
  const result = db.run(
    `UPDATE escrows SET ${assignments}, updated_at = ? WHERE id = ? AND status IN (${fromStatuses.map(() => '?').join(', ')})`,
    ...params
  );
  if (result.changes !== 1) return null;
  return getEscrow(id);
}

function createDraft(guildId, userId, partnerId, amountText) {
  db.run('DELETE FROM drafts WHERE created_at < ?', Date.now() - 30 * 60 * 1000);
  const result = db.run(
    'INSERT INTO drafts (guild_id, user_id, partner_id, amount_text, created_at) VALUES (?, ?, ?, ?, ?)',
    guildId,
    userId,
    partnerId,
    amountText,
    Date.now()
  );
  return result.lastInsertRowid;
}

function peekDraft(id, userId) {
  return db.get('SELECT * FROM drafts WHERE id = ? AND user_id = ?', id, userId);
}

function deleteDraft(id) {
  db.run('DELETE FROM drafts WHERE id = ?', id);
}

function createEscrow({ guildId, creatorId, asset, partnerId = '', amountRaw = null }) {
  const now = Date.now();
  const ready = Boolean(partnerId) && amountRaw != null;
  const result = db.run(
    `INSERT INTO escrows (
      guild_id, creator_id, partner_id, asset, amount_raw, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    guildId,
    creatorId,
    partnerId || '',
    asset,
    amountRaw == null ? null : amountRaw.toString(),
    ready ? 'ROLE_SELECTION' : 'AWAITING_PARTNER',
    now,
    now
  );
  const row = getEscrow(result.lastInsertRowid);
  audit(row.id, creatorId, 'created', asset);
  return row;
}

function setPartner(id, userId, partnerId) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || row.status !== 'AWAITING_PARTNER') return fail('This ticket is not waiting for a user ID.');
    if (userId !== row.creator_id) return fail('Only the person who opened the ticket can add the other person.');
    if (!partnerId || partnerId === row.creator_id) return fail('Paste the other person\'s user ID, not your own.');
    const next = save(id, ['AWAITING_PARTNER'], { partner_id: partnerId, status: 'ROLE_SELECTION' });
    if (!next) return fail('This ticket is no longer waiting for a user ID.');
    audit(id, userId, 'partner');
    return ok(next);
  });
}

function setAmount(id, userId, amountRaw, usdRaw = null, priceRaw = null) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || row.status !== 'AWAITING_AMOUNT') return fail('This ticket is not waiting for an amount.');
    if (userId !== row.sender_id) return fail('Only the sender can enter the deal amount.');
    const fields = {
      amount_raw: amountRaw.toString(),
      status: 'AMOUNT_CONFIRMATION',
      amount_ok_sender: 0,
      amount_ok_receiver: 0,
    };
    if (usdRaw != null) fields.usd_raw = usdRaw.toString();
    if (priceRaw != null) fields.price_raw = priceRaw.toString();
    const next = save(id, ['AWAITING_AMOUNT'], fields);
    if (!next) return fail('This ticket is no longer waiting for an amount.');
    audit(id, userId, 'amount', amountRaw.toString());
    return ok(next);
  });
}

function setChannel(id, channelId) {
  db.run('UPDATE escrows SET channel_id = ?, updated_at = ? WHERE id = ?', channelId, Date.now(), id);
  return getEscrow(id);
}

function removeEscrow(id) {
  db.run('DELETE FROM escrows WHERE id = ? AND channel_id IS NULL', id);
}

function chooseRole(id, userId, role) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row) return fail('This escrow no longer exists.');
    if (row.status !== 'ROLE_SELECTION') return fail('Roles are not being selected right now.');
    if (!isParticipant(row, userId)) return fail('Only the two people in this ticket can choose a role.');
    if (role === 'sender' && row.sender_id === userId) return fail('You already selected Sender.');
    if (role === 'receiver' && row.receiver_id === userId) return fail('You already selected Receiver.');
    if (role === 'sender' && row.sender_id && row.sender_id !== userId) return fail('Sender is already taken.');
    if (role === 'receiver' && row.receiver_id && row.receiver_id !== userId) return fail('Receiver is already taken.');
    if (role === 'sender' && row.receiver_id === userId) return fail('You already selected Receiver.');
    if (role === 'receiver' && row.sender_id === userId) return fail('You already selected Sender.');
    const fields = role === 'sender' ? { sender_id: userId } : { receiver_id: userId };
    let next = save(id, ['ROLE_SELECTION'], fields);
    if (!next) return fail('Roles changed while you clicked. Look at the latest message.');
    audit(id, userId, 'role', role);
    if (next.sender_id && next.receiver_id) {
      next = save(id, ['ROLE_SELECTION'], {
        status: 'ROLE_CONFIRMATION',
        role_ok_sender: 0,
        role_ok_receiver: 0,
      });
    }
    return ok(next);
  });
}

function confirmRoles(id, userId) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || row.status !== 'ROLE_CONFIRMATION') return fail('Role confirmation is not open.');
    if (userId !== row.sender_id && userId !== row.receiver_id) return fail('Only the Sender and Receiver can confirm.');
    const field = userId === row.sender_id ? 'role_ok_sender' : 'role_ok_receiver';
    if (row[field]) return fail('You already confirmed.');
    let next = save(id, ['ROLE_CONFIRMATION'], { [field]: 1 });
    if (!next) return fail('That confirmation is no longer available.');
    audit(id, userId, 'role-confirm');
    if (next.role_ok_sender && next.role_ok_receiver) {
      next = next.amount_raw
        ? save(id, ['ROLE_CONFIRMATION'], {
          status: 'AMOUNT_CONFIRMATION',
          amount_ok_sender: 0,
          amount_ok_receiver: 0,
        })
        : save(id, ['ROLE_CONFIRMATION'], { status: 'AWAITING_AMOUNT' });
    }
    return ok(next);
  });
}

function confirmAmount(id, userId) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || row.status !== 'AMOUNT_CONFIRMATION') return fail('Amount confirmation is not open.');
    if (userId !== row.sender_id && userId !== row.receiver_id) return fail('Only the Sender and Receiver can confirm.');
    const field = userId === row.sender_id ? 'amount_ok_sender' : 'amount_ok_receiver';
    if (row[field]) return fail('You already confirmed.');
    let next = save(id, ['AMOUNT_CONFIRMATION'], { [field]: 1 });
    if (!next) return fail('That confirmation is no longer available.');
    audit(id, userId, 'amount-confirm');
    if (next.amount_ok_sender && next.amount_ok_receiver) {
      next = save(id, ['AMOUNT_CONFIRMATION'], { status: 'FEE_SELECTION' });
    }
    return ok(next);
  });
}

function redoAmount(id, userId) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || row.status !== 'AMOUNT_CONFIRMATION') return fail('The amount can only be redone during confirmation.');
    if (!isParticipant(row, userId)) return fail('Only the two people in this ticket can redo the amount.');
    const next = save(id, ['AMOUNT_CONFIRMATION'], {
      status: 'AWAITING_AMOUNT',
      amount_raw: null,
      usd_raw: null,
      price_raw: null,
      amount_ok_sender: 0,
      amount_ok_receiver: 0,
    });
    if (!next) return fail('The amount already changed.');
    audit(id, userId, 'amount-redo');
    return ok(next);
  });
}

function redoRoles(id, userId) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || row.status !== 'ROLE_CONFIRMATION') return fail('Roles can only be redone during confirmation.');
    if (!isParticipant(row, userId)) return fail('Only the two people in this ticket can redo the roles.');
    const next = save(id, ['ROLE_CONFIRMATION'], {
      status: 'ROLE_SELECTION',
      sender_id: null,
      receiver_id: null,
      role_ok_sender: 0,
      role_ok_receiver: 0,
    });
    if (!next) return fail('Roles already changed.');
    audit(id, userId, 'role-redo');
    return ok(next);
  });
}

function chooseFee(id, userId, payer, networkRaw = 0n) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || row.status !== 'FEE_SELECTION') return fail('The fee choice is not open.');
    if (!isParticipant(row, userId)) return fail('Only the two people in this ticket can choose the fee.');
    let priced;
    try {
      priced = quote(BigInt(row.amount_raw), payer, row.usd_raw);
    } catch (error) {
      return fail(error.message);
    }
    const network = BigInt(networkRaw) > 0n ? BigInt(networkRaw) : 0n;
    const next = save(id, ['FEE_SELECTION'], {
      status: 'FEE_CONFIRMATION',
      fee_payer: payer,
      fee_raw: priced.fee.toString(),
      network_raw: network.toString(),
      deposit_raw: (priced.deposit + network).toString(),
      payout_raw: priced.payout.toString(),
      fee_ok_sender: 0,
      fee_ok_receiver: 0,
    });
    if (!next) return fail('The fee choice is no longer open.');
    audit(id, userId, 'fee', payer);
    return ok(next);
  });
}

function confirmFee(id, userId) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || row.status !== 'FEE_CONFIRMATION') return fail('Fee confirmation is not open.');
    if (userId !== row.sender_id && userId !== row.receiver_id) return fail('Only the Sender and Receiver can confirm.');
    const field = userId === row.sender_id ? 'fee_ok_sender' : 'fee_ok_receiver';
    if (row[field]) return fail('You already confirmed.');
    let next = save(id, ['FEE_CONFIRMATION'], { [field]: 1 });
    if (!next) return fail('That confirmation is no longer available.');
    audit(id, userId, 'fee-confirm');
    if (!(next.fee_ok_sender && next.fee_ok_receiver)) return ok(next);
    const asset = getAsset(next.asset);
    const highest = db.get('SELECT COALESCE(MAX(hd_index), -1) AS value FROM escrows WHERE hd_family = ?', asset.family);
    const index = Number(highest.value) + 1;
    const depositAddress = wallet.address(next.asset, index);
    next = save(id, ['FEE_CONFIRMATION'], {
      status: 'AWAITING_DEPOSIT',
      hd_family: asset.family,
      hd_index: index,
      deposit_address: depositAddress,
    });
    if (!next) return fail('Could not reserve a deposit address. Try confirming again.');
    audit(id, userId, 'deposit-address', depositAddress);
    return ok(next, { freshDeposit: true });
  });
}

function redoFee(id, userId) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || row.status !== 'FEE_CONFIRMATION') return fail('The fee can only be redone during confirmation.');
    if (!isParticipant(row, userId)) return fail('Only the two people in this ticket can redo the fee.');
    const next = save(id, ['FEE_CONFIRMATION'], {
      status: 'FEE_SELECTION',
      fee_payer: null,
      fee_raw: null,
      network_raw: null,
      deposit_raw: null,
      payout_raw: null,
      fee_ok_sender: 0,
      fee_ok_receiver: 0,
    });
    if (!next) return fail('The fee choice already changed.');
    audit(id, userId, 'fee-redo');
    return ok(next);
  });
}

function observeDeposit(id, payment, required) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || !['AWAITING_DEPOSIT', 'CONFIRMING_DEPOSIT', 'DEAL_CANCEL'].includes(row.status)) return { ignore: true };
    const used = db.get('SELECT escrow_id FROM used_txs WHERE txid = ? AND asset = ?', payment.txid, row.asset);
    if (used) return { ignore: true };
    if (payment.amount !== BigInt(row.deposit_raw)) return { wrong: true, row, txid: payment.txid };
    if (payment.confirmations < required) {
      const next = save(id, ['AWAITING_DEPOSIT', 'CONFIRMING_DEPOSIT', 'DEAL_CANCEL'], {
        status: 'CONFIRMING_DEPOSIT',
        deposit_tx: payment.txid,
        deposit_confirmations: payment.confirmations,
      });
      return { pending: true, row: next || row, first: row.status === 'AWAITING_DEPOSIT' || row.status === 'DEAL_CANCEL' };
    }
    try {
      db.run(
        'INSERT INTO used_txs (txid, asset, escrow_id, purpose) VALUES (?, ?, ?, ?)',
        payment.txid,
        row.asset,
        id,
        'deposit'
      );
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) return { ignore: true };
      throw error;
    }
    const next = save(id, ['AWAITING_DEPOSIT', 'CONFIRMING_DEPOSIT', 'DEAL_CANCEL'], {
      status: 'FUNDED',
      deposit_tx: payment.txid,
      deposit_confirmations: payment.confirmations,
    });
    if (!next) return { ignore: true };
    audit(id, '', 'funded', payment.txid);
    return { funded: true, row: next };
  });
}

function markWrongAmount(id, txid) {
  const row = getEscrow(id);
  if (!row || row.notice_tx === txid) return false;
  db.run('UPDATE escrows SET notice_tx = ?, updated_at = ? WHERE id = ?', txid, Date.now(), id);
  return true;
}

const WRONG_OPEN = ['WRONG_AMOUNT', 'WRONG_CONTINUE', 'WRONG_CANCEL'];

function openWrongAmount(id, payment) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || row.status !== 'AWAITING_DEPOSIT') return { ignore: true };
    const used = db.get('SELECT escrow_id FROM used_txs WHERE txid = ? AND asset = ?', payment.txid, row.asset);
    if (used) return { ignore: true };
    const next = save(id, ['AWAITING_DEPOSIT'], {
      status: 'WRONG_AMOUNT',
      deposit_tx: payment.txid,
      received_raw: payment.amount.toString(),
      deposit_confirmations: payment.confirmations,
    });
    if (!next) return { ignore: true };
    audit(id, '', 'wrong-amount', payment.txid);
    return { first: true, row: next };
  });
}

function touchWrongAmount(id, confirmations) {
  const row = getEscrow(id);
  if (!row || !WRONG_OPEN.includes(row.status)) return row;
  if (Number(row.deposit_confirmations) === confirmations) return row;
  return save(id, WRONG_OPEN, { deposit_confirmations: confirmations }) || row;
}

function proposeWrong(id, userId, choice) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || row.status !== 'WRONG_AMOUNT') return fail('That choice is not open.');
    if (userId !== row.sender_id && userId !== row.receiver_id) return fail('Only the Sender and Receiver can choose.');
    const status = choice === 'continue' ? 'WRONG_CONTINUE' : 'WRONG_CANCEL';
    const next = save(id, ['WRONG_AMOUNT'], { status, settlement: userId });
    if (!next) return fail('That choice is no longer open.');
    audit(id, userId, choice === 'continue' ? 'wrong-continue' : 'wrong-cancel');
    return ok(next);
  });
}

function declineWrong(id, userId) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || !['WRONG_CONTINUE', 'WRONG_CANCEL'].includes(row.status)) return fail('That choice is not open.');
    if (userId === row.settlement) return fail('The other person has to answer.');
    if (userId !== row.sender_id && userId !== row.receiver_id) return fail('Only the Sender and Receiver can answer.');
    const next = save(id, ['WRONG_CONTINUE', 'WRONG_CANCEL'], { status: 'WRONG_AMOUNT', settlement: null });
    if (!next) return fail('That choice is no longer open.');
    audit(id, userId, 'wrong-declined');
    return ok(next);
  });
}

function acceptWrong(id, userId, confirmations) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || !['WRONG_CONTINUE', 'WRONG_CANCEL'].includes(row.status)) return fail('That choice is not open.');
    if (userId === row.settlement) return fail('The other person has to confirm.');
    if (userId !== row.sender_id && userId !== row.receiver_id) return fail('Only the Sender and Receiver can confirm.');
    const required = getAsset(row.asset).confirmations;
    if (confirmations < required) {
      return fail(`Waiting for confirmations: ${confirmations}/${required}.`);
    }
    const received = BigInt(row.received_raw);
    try {
      db.run(
        'INSERT INTO used_txs (txid, asset, escrow_id, purpose) VALUES (?, ?, ?, ?)',
        row.deposit_tx,
        row.asset,
        id,
        'deposit'
      );
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) return fail('That payment was already used.');
      throw error;
    }
    if (row.status === 'WRONG_CONTINUE') {
      const agreed = BigInt(row.payout_raw);
      const payout = received < agreed ? received : agreed;
      const next = save(id, ['WRONG_CONTINUE'], {
        status: 'FUNDED',
        deposit_raw: received.toString(),
        payout_raw: payout.toString(),
        deposit_confirmations: confirmations,
        settlement: null,
      });
      if (!next) return fail('That choice is no longer open.');
      audit(id, userId, 'wrong-accepted');
      return ok(next);
    }
    const next = save(id, ['WRONG_CANCEL'], {
      status: 'AWAITING_REFUND_ADDRESS',
      settlement: 'refund',
      payout_raw: received.toString(),
      payout_address: null,
      deposit_confirmations: confirmations,
    });
    if (!next) return fail('That choice is no longer open.');
    audit(id, userId, 'wrong-refund');
    return ok(next);
  });
}

function requestRelease(id, userId) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || row.status !== 'FUNDED') return fail('Release is not available right now.');
    if (userId !== row.sender_id) return fail('Only the sender can release the funds.');
    const next = save(id, ['FUNDED'], {
      status: 'RELEASE_CONFIRMATION',
      unlocks_at: Date.now() + 5000,
    });
    if (!next) return fail('Release is no longer available.');
    audit(id, userId, 'release-requested');
    return ok(next);
  });
}

function confirmRelease(id, userId) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || row.status !== 'RELEASE_CONFIRMATION') return fail('Release confirmation is not open.');
    if (userId !== row.sender_id) return fail('Only the sender can confirm the release.');
    if (Date.now() < Number(row.unlocks_at || 0)) return fail('Wait a few seconds, then try again.');
    const next = save(id, ['RELEASE_CONFIRMATION'], {
      status: 'AWAITING_PAYOUT_ADDRESS',
      settlement: 'payout',
      payout_address: null,
      unlocks_at: null,
    });
    if (!next) return fail('Release confirmation is no longer open.');
    audit(id, userId, 'release-confirmed');
    return ok(next);
  });
}

function returnToFunded(id, userId, expected) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || row.status !== expected) return fail('That menu is no longer open.');
    const allowed = expected === 'RELEASE_CONFIRMATION' ? row.sender_id : row.receiver_id;
    if (userId !== allowed) return fail('Only the person who was asked can go back.');
    const next = save(id, [expected], { status: 'FUNDED', unlocks_at: null, payout_address: null });
    if (!next) return fail('That menu already changed.');
    audit(id, userId, 'returned');
    return ok(next);
  });
}

function claimIdleNotice(id) {
  const result = db.run(
    'UPDATE escrows SET idle_warned = 1 WHERE id = ? AND status = ? AND deposit_tx IS NULL AND COALESCE(idle_warned, 0) = 0',
    id,
    'AWAITING_DEPOSIT'
  );
  if (result.changes === 1) audit(id, '', 'idle-notice');
  return result.changes === 1;
}

function requestDealCancel(id, userId) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || row.status !== 'AWAITING_DEPOSIT') return fail('This deal cannot be cancelled right now.');
    if (!isParticipant(row, userId)) return fail('Only the two people in this ticket can cancel it.');
    if (row.deposit_tx) return fail('A payment was already seen, so this deal cannot be cancelled here.');
    const next = save(id, ['AWAITING_DEPOSIT'], { status: 'DEAL_CANCEL', settlement: userId });
    if (!next) return fail('This deal can no longer be cancelled.');
    audit(id, userId, 'deal-cancel');
    return ok(next);
  });
}

function confirmDealCancel(id, userId) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || row.status !== 'DEAL_CANCEL') return fail('Cancel confirmation is not open.');
    if (userId !== row.sender_id && userId !== row.receiver_id) return fail('Only the Sender and Receiver can confirm.');
    if (userId === row.settlement) return fail('The other person has to confirm the cancellation.');
    if (row.deposit_tx) return fail('A payment was already seen, so this deal cannot be cancelled.');
    const next = save(id, ['DEAL_CANCEL'], { status: 'CLOSED' });
    if (!next) return fail('This deal can no longer be cancelled.');
    audit(id, userId, 'deal-cancelled');
    return ok(next);
  });
}

function undoDealCancel(id, userId) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || row.status !== 'DEAL_CANCEL') return fail('That menu is no longer open.');
    if (!isParticipant(row, userId)) return fail('Only the two people in this ticket can do that.');
    const next = save(id, ['DEAL_CANCEL'], { status: 'AWAITING_DEPOSIT', settlement: null, idle_warned: 0 });
    if (!next) return fail('That menu already changed.');
    audit(id, userId, 'deal-cancel-return');
    return ok(next);
  });
}

function requestCancel(id, userId) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || row.status !== 'FUNDED') return fail('Cancel is not available right now.');
    if (userId !== row.sender_id) return fail('Only the sender can request a cancel.');
    const next = save(id, ['FUNDED'], { status: 'CANCEL_REQUEST' });
    if (!next) return fail('Cancel is no longer available.');
    audit(id, userId, 'cancel-requested');
    return ok(next);
  });
}

function confirmCancel(id, userId) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || row.status !== 'CANCEL_REQUEST') return fail('Cancel confirmation is not open.');
    if (userId !== row.receiver_id) return fail('Only the receiver can confirm the cancel.');
    const next = save(id, ['CANCEL_REQUEST'], {
      status: 'AWAITING_REFUND_ADDRESS',
      settlement: 'refund',
      payout_address: null,
    });
    if (!next) return fail('Cancel confirmation is no longer open.');
    audit(id, userId, 'cancel-confirmed');
    return ok(next);
  });
}

function submitAddress(id, userId, address) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row) return fail('This escrow no longer exists.');
    const payout = row.status === 'AWAITING_PAYOUT_ADDRESS';
    const refund = row.status === 'AWAITING_REFUND_ADDRESS';
    if (!payout && !refund) return fail('This ticket is not waiting for an address.');
    const expected = payout ? row.receiver_id : row.sender_id;
    if (userId !== expected) return fail('Only the person who was asked can paste the address.');
    if (address.toLowerCase() === String(row.deposit_address || '').toLowerCase()) {
      return fail('That is this ticket\'s deposit address. Paste the wallet that should receive the coins.');
    }
    const next = save(id, [row.status], {
      status: payout ? 'PAYOUT_CONFIRM' : 'REFUND_CONFIRM',
      payout_address: address,
      settlement: payout ? 'payout' : 'refund',
    });
    if (!next) return fail('This ticket is no longer waiting for an address.');
    audit(id, userId, 'address', address);
    return ok(next);
  });
}

function redoAddress(id, userId) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || !['PAYOUT_CONFIRM', 'REFUND_CONFIRM'].includes(row.status)) return fail('There is no address to change.');
    const expected = row.settlement === 'refund' ? row.sender_id : row.receiver_id;
    if (userId !== expected) return fail('Only the person who supplied the address can change it.');
    const next = save(id, [row.status], {
      status: row.settlement === 'refund' ? 'AWAITING_REFUND_ADDRESS' : 'AWAITING_PAYOUT_ADDRESS',
      payout_address: null,
    });
    if (!next) return fail('That address can no longer be changed.');
    audit(id, userId, 'address-redo');
    return ok(next);
  });
}

function reducePayout(id, amountRaw) {
  const next = save(id, ['BROADCASTING'], { payout_raw: BigInt(amountRaw).toString() });
  if (next) audit(id, '', 'payout-adjusted');
  return next;
}

function claimSend(id) {
  const next = save(id, ['PAYOUT_CONFIRM', 'REFUND_CONFIRM', 'SETTLEMENT_REVIEW'], { status: 'BROADCASTING' });
  if (next) audit(id, '', 'broadcasting', next.payout_address);
  return next;
}

function markComplete(id, txid) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row || !['BROADCASTING', 'SETTLEMENT_REVIEW'].includes(row.status)) return null;
    const status = row.settlement === 'refund' ? 'REFUNDED' : 'COMPLETED';
    db.run(
      'INSERT OR IGNORE INTO used_txs (txid, asset, escrow_id, purpose) VALUES (?, ?, ?, ?)',
      txid,
      row.asset,
      id,
      row.settlement || 'payout'
    );
    const next = save(id, [row.status], { status, payout_tx: txid });
    if (next) audit(id, '', status.toLowerCase(), txid);
    return next;
  });
}

function markReview(id, detail) {
  const next = save(id, ['BROADCASTING'], { status: 'SETTLEMENT_REVIEW' });
  if (next) audit(id, '', 'review', detail);
  return next || getEscrow(id);
}

function closeTicket(id, userId, staff) {
  return db.tx(() => {
    const row = getEscrow(id);
    if (!row) return fail('This escrow no longer exists.');
    if (!EARLY.includes(row.status)) return fail('A ticket can only be closed before a deposit address is created.');
    if (!staff && !isParticipant(row, userId)) return fail('Only the two people in this ticket can close it.');
    const next = save(id, EARLY, { status: 'CLOSED' });
    if (!next) return fail('This ticket can no longer be closed.');
    audit(id, userId, 'closed');
    return ok(next);
  });
}

function listWithChannel() {
  return db.all('SELECT id, asset, channel_id FROM escrows WHERE channel_id IS NOT NULL');
}

function completedVolumes() {
  const rows = db.all("SELECT sender_id, receiver_id, usd_raw FROM escrows WHERE status = 'COMPLETED'");
  const totals = new Map();
  for (const row of rows) {
    const cents = row.usd_raw == null ? 0n : BigInt(row.usd_raw);
    const people = new Set([row.sender_id, row.receiver_id].filter(Boolean));
    for (const person of people) {
      const current = totals.get(person) || { completed: 0, cents: 0n, biggest: 0n };
      current.completed += 1;
      current.cents += cents;
      if (cents > current.biggest) current.biggest = cents;
      totals.set(person, current);
    }
  }
  const extras = db.all('SELECT user_id, cents FROM stat_adjustments');
  for (const row of extras) {
    const added = BigInt(row.cents);
    const current = totals.get(row.user_id) || { completed: 0, cents: 0n, biggest: 0n };
    current.cents += added;
    if (added > current.biggest) current.biggest = added;
    totals.set(row.user_id, current);
  }
  for (const stats of totals.values()) {
    if (stats.biggest > stats.cents) stats.biggest = stats.cents > 0n ? stats.cents : 0n;
  }
  return totals;
}

function addStats(userId, cents, actorId) {
  db.run(
    'INSERT INTO stat_adjustments (user_id, cents, actor_id, created_at) VALUES (?, ?, ?, ?)',
    String(userId),
    BigInt(cents).toString(),
    String(actorId || ''),
    Date.now()
  );
  return userStats(userId);
}

function removeStats(userId, cents, actorId) {
  const current = userStats(userId);
  const remove = BigInt(cents) > current.cents ? current.cents : BigInt(cents);
  if (remove <= 0n) return { ...current, removed: 0n };
  db.run(
    'INSERT INTO stat_adjustments (user_id, cents, actor_id, created_at) VALUES (?, ?, ?, ?)',
    String(userId),
    (-remove).toString(),
    String(actorId || ''),
    Date.now()
  );
  return { ...userStats(userId), removed: remove };
}

function userStats(userId) {
  const totals = completedVolumes();
  const mine = totals.get(String(userId)) || { completed: 0, cents: 0n, biggest: 0n };
  let rank = null;
  if (mine.completed > 0 || mine.cents > 0n) {
    let ahead = 0;
    for (const stats of totals.values()) {
      if (stats.cents > mine.cents) ahead += 1;
    }
    rank = ahead + 1;
  }
  return { completed: mine.completed, cents: mine.cents, rank, biggest: mine.biggest || 0n };
}

function clients() {
  return [...completedVolumes().entries()].map(([id, stats]) => ({
    id,
    completed: stats.completed,
    cents: stats.cents,
  }));
}

function leaderboard(limit = 10) {
  const totals = [...completedVolumes().entries()];
  totals.sort((a, b) => {
    if (a[1].cents !== b[1].cents) return a[1].cents > b[1].cents ? -1 : 1;
    if (a[1].completed !== b[1].completed) return b[1].completed - a[1].completed;
    return a[0] < b[0] ? -1 : 1;
  });
  return totals.slice(0, limit).map(([id, stats]) => {
    let ahead = 0;
    for (const [, other] of totals) {
      if (other.cents > stats.cents) ahead += 1;
    }
    return { id, completed: stats.completed, cents: stats.cents, rank: ahead + 1 };
  });
}

function listStatus(statuses) {
  return db.all(
    `SELECT * FROM escrows WHERE status IN (${statuses.map(() => '?').join(', ')}) ORDER BY id`,
    ...statuses
  );
}

function rememberPrompt(id, messageId) {
  db.run('UPDATE escrows SET prompt_message_id = ?, updated_at = ? WHERE id = ?', messageId, Date.now(), id);
}

module.exports = {
  EARLY,
  audit,
  getEscrow,
  getByChannel,
  createDraft,
  peekDraft,
  deleteDraft,
  createEscrow,
  setPartner,
  setAmount,
  setChannel,
  removeEscrow,
  chooseRole,
  confirmRoles,
  redoRoles,
  confirmAmount,
  redoAmount,
  chooseFee,
  confirmFee,
  redoFee,
  observeDeposit,
  markWrongAmount,
  openWrongAmount,
  touchWrongAmount,
  proposeWrong,
  declineWrong,
  acceptWrong,
  requestRelease,
  confirmRelease,
  returnToFunded,
  requestDealCancel,
  claimIdleNotice,
  confirmDealCancel,
  undoDealCancel,
  requestCancel,
  confirmCancel,
  submitAddress,
  redoAddress,
  claimSend,
  reducePayout,
  markComplete,
  markReview,
  closeTicket,
  listStatus,
  listWithChannel,
  userStats,
  addStats,
  removeStats,
  clients,
  leaderboard,
  rememberPrompt,
  isParticipant,
};
