const { getAsset } = require('./assets');
const chain = require('./chain');
const flow = require('./flow');
const present = require('./present');

const IDLE_MS = 20 * 60 * 1000;

async function checkDeposit(client, escrow) {
  const asset = getAsset(escrow.asset);
  const payments = await chain.incoming(escrow.asset, escrow.deposit_address);
  const exact = payments
    .filter((payment) => payment.amount === BigInt(escrow.deposit_raw))
    .sort((left, right) => right.confirmations - left.confirmations);
  if (exact.length > 0) {
    const result = flow.observeDeposit(escrow.id, exact[0], asset.confirmations);
    if ((result.funded || result.first) && result.row && result.row.channel_id) {
      const channel = await client.channels.fetch(result.row.channel_id);
      const { postStage } = require('./bot');
      await postStage(channel, result.row, { previousStatus: escrow.status });
    }
    return 'found';
  }
  if (escrow.status !== 'AWAITING_DEPOSIT') return 'none';
  const wrong = payments.find((payment) => payment.amount !== BigInt(escrow.deposit_raw));
  if (!wrong) return 'none';
  const opened = flow.openWrongAmount(escrow.id, wrong);
  if (!opened.first || !opened.row || !opened.row.channel_id) return 'found';
  const channel = await client.channels.fetch(opened.row.channel_id);
  const { postStage } = require('./bot');
  await postStage(channel, opened.row, { previousStatus: escrow.status });
  return 'found';
}

async function maybeIdle(client, escrow) {
  if (escrow.status !== 'AWAITING_DEPOSIT' || escrow.deposit_tx || Number(escrow.idle_warned)) return;
  if (!escrow.updated_at || Date.now() - Number(escrow.updated_at) < IDLE_MS) return;
  const fresh = flow.getEscrow(escrow.id);
  if (!fresh || fresh.status !== 'AWAITING_DEPOSIT' || fresh.deposit_tx || !fresh.channel_id) return;
  const channel = await client.channels.fetch(fresh.channel_id).catch(() => null);
  if (!channel) return;
  const sent = await channel.send(present.idleCancelMessage(fresh));
  if (!flow.claimIdleNotice(fresh.id)) {
    await sent.delete().catch(() => {});
    return;
  }
  flow.rememberPrompt(fresh.id, sent.id);
}

async function trackWrong(client, escrow) {
  const payments = await chain.incoming(escrow.asset, escrow.deposit_address);
  const match = payments.find((payment) => payment.txid === escrow.deposit_tx);
  if (!match) return;
  flow.touchWrongAmount(escrow.id, match.confirmations);
}

async function refreshDepositButtons(client) {
  const rows = flow.listStatus(['AWAITING_DEPOSIT']);
  for (const escrow of rows) {
    if (!escrow.prompt_message_id || !escrow.channel_id || escrow.deposit_tx) continue;
    try {
      const channel = await client.channels.fetch(escrow.channel_id).catch(() => null);
      if (!channel) continue;
      const message = await channel.messages.fetch(escrow.prompt_message_id).catch(() => null);
      if (!message) continue;
      const view = await present.stage(escrow);
      await message.edit({ components: view.payload.components }).catch(() => {});
    } catch (error) {
      console.error(`[escrow ${escrow.id}] refresh`, error.message);
    }
  }
}

function start(client) {
  let running = false;
  refreshDepositButtons(client).catch((error) => console.error('[watch] refresh', error.message));
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const rows = flow.listStatus(['AWAITING_DEPOSIT', 'CONFIRMING_DEPOSIT', 'DEAL_CANCEL']);
      for (const escrow of rows) {
        try {
          const found = await checkDeposit(client, escrow);
          if (found === 'none') await maybeIdle(client, escrow);
        } catch (error) {
          console.error(`[escrow ${escrow.id}] watch`, error.message);
        }
      }
      const wrong = flow.listStatus(['WRONG_AMOUNT', 'WRONG_CONTINUE', 'WRONG_CANCEL']);
      for (const escrow of wrong) {
        try {
          await trackWrong(client, escrow);
        } catch (error) {
          console.error(`[escrow ${escrow.id}] watch`, error.message);
        }
      }
    } finally {
      running = false;
    }
  };
  setInterval(() => {
    tick().catch((error) => console.error('[watch]', error.message));
  }, 30000);
  tick().catch((error) => console.error('[watch]', error.message));
}

module.exports = { start, scanDeposit: checkDeposit };
