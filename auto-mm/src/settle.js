const chain = require('./chain');
const config = require('./config');
const flow = require('./flow');
const present = require('./present');
const ranks = require('./ranks');
const { getAsset } = require('./assets');

async function locate(escrow) {
  return chain.findOutgoing(escrow.asset, escrow.deposit_address, escrow.payout_address, escrow.payout_raw);
}

async function publishDeal(client, escrow) {
  if (escrow.status !== 'COMPLETED' || !escrow.payout_tx || !config.dealsChannelId) return;
  const channel = await client.channels.fetch(config.dealsChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.error(`[escrow ${escrow.id}] deals channel is missing`);
    return;
  }
  await channel.send(present.dealCompleteMessage(escrow));
}

async function finish(channel, escrow, txid) {
  const done = flow.markComplete(escrow.id, txid);
  if (!done) return;
  await channel.send(present.messageFrom(await present.stage(done)));
  await publishDeal(channel.client, done).catch((error) => {
    console.error(`[escrow ${done.id}] deal post`, error.message);
  });
  if (done.status === 'COMPLETED') {
    const people = [done.sender_id, done.receiver_id].filter(Boolean);
    await ranks.sync(channel.client, people).catch((error) => {
      console.error(`[escrow ${done.id}] ranks`, error.message);
    });
  }
  const history = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  if (!history) return;
  for (const message of history.values()) {
    if (message.author.id !== channel.client.user.id) continue;
    const description = message.embeds[0]?.description || '';
    const stale = description.includes('The send was interrupted')
      || description.includes('The coins are being sent')
      || message.content === 'This send is already in progress.';
    if (stale) await message.delete().catch(() => {});
  }
}

async function settle(channel, escrow) {
  const claimed = flow.claimSend(escrow.id);
  if (!claimed) {
    await channel.send('This send is already in progress.');
    return;
  }
  try {
    const existing = await locate(claimed);
    if (existing) {
      await finish(channel, claimed, existing.txid);
      return;
    }
    let amount = BigInt(claimed.payout_raw);
    if (getAsset(claimed.asset).kind === 'utxo') {
      amount = await chain.fitUtxoAmount(claimed.asset, claimed.hd_index, amount);
      if (amount < BigInt(claimed.payout_raw)) {
        const updated = flow.reducePayout(claimed.id, amount);
        if (!updated) return;
      }
    } else {
      const balance = await chain.balanceOf(claimed.asset, claimed.deposit_address);
      if (balance < amount) {
        const review = flow.markReview(claimed.id, 'The deposit address no longer has enough to send, so nothing new was sent.');
        await channel.send(present.messageFrom(
          await present.stage(review),
          'There is not enough left on the deposit address to send. Check it on a block explorer before you press Retry.'
        ));
        return;
      }
    }
    const sent = await chain.sendPayment(
      claimed.asset,
      claimed.hd_index,
      claimed.payout_address,
      amount
    );
    await finish(channel, claimed, sent.txid);
  } catch (error) {
    console.error(`[escrow ${claimed.id}] send failed`, error.cause ? error.cause.message : error.message);
    try {
      const existing = await locate(claimed);
      if (existing) {
        await finish(channel, claimed, existing.txid);
        return;
      }
    } catch (lookupError) {
      console.error(`[escrow ${claimed.id}] lookup failed`, lookupError.message);
    }
    const review = flow.markReview(claimed.id, error.message);
    await channel.send(present.messageFrom(
      await present.stage(review),
      error.public ? error.message : 'The transfer could not be sent. The ticket was not marked complete.'
    ));
  }
}

async function recover(client, id) {
  const escrow = flow.getEscrow(id);
  if (!escrow || escrow.status !== 'BROADCASTING' || !escrow.channel_id) return;
  const channel = await client.channels.fetch(escrow.channel_id).catch(() => null);
  if (!channel) return;
  try {
    const existing = await locate(escrow);
    if (existing) {
      await finish(channel, escrow, existing.txid);
      return;
    }
  } catch (error) {
    console.error(`[escrow ${id}] recover`, error.message);
  }
  const review = flow.markReview(id, 'Restarted while a transaction was being broadcast.');
  if (review && review.status === 'SETTLEMENT_REVIEW') {
    await channel.send(present.messageFrom(await present.stage(review)));
  }
}

function resumeBroadcasts(client) {
  for (const escrow of flow.listStatus(['BROADCASTING'])) {
    const wait = Math.max(0, 120000 - (Date.now() - Number(escrow.updated_at || 0)));
    setTimeout(() => {
      recover(client, escrow.id).catch((error) => console.error(`[escrow ${escrow.id}] recover`, error.message));
    }, wait);
  }
}

module.exports = { settle, resumeBroadcasts };
