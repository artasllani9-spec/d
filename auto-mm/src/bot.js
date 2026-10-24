const {
  ActionRowBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const config = require('./config');
const { categoryName, getAsset, ticketName } = require('./assets');
const { parseAmount, formatAmount, quote } = require('./money');
const { quoteUsd, stableNetworkFee } = require('./prices');
const { normalizeAddress, validAddress, incoming, estimateNetworkCost } = require('./chain');
const flow = require('./flow');
const present = require('./present');
const { settle } = require('./settle');
const ranks = require('./ranks');
const { scanDeposit } = require('./watcher');

const unlockTimers = new Map();
const closingChannels = new Set();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function playClosing(channel) {
  const frames = ['Closing ticket..', 'Closing ticket...'];
  let message = null;
  try {
    message = await channel.send({ embeds: [{ color: 0xda3633, description: frames[0] }] });
  } catch (error) {
    console.error('[escrow] closing notice', error.message);
  }
  const started = Date.now();
  let step = 1;
  while (Date.now() - started < 5000) {
    const remaining = 5000 - (Date.now() - started);
    if (remaining <= 0) break;
    await sleep(Math.min(700, remaining));
    if (Date.now() - started >= 5000) break;
    if (message) {
      await message.edit({ embeds: [{ color: 0xda3633, description: frames[step % 2] }] }).catch(() => {});
    }
    step += 1;
  }
  return channel.delete('Escrow ticket closed').then(() => true).catch((error) => {
    console.error(`[escrow] delete channel`, error.message);
    return false;
  });
}

function usd(cents) {
  const value = BigInt(cents);
  const whole = (value / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (value % 100n).toString().padStart(2, '0');
  return `$${whole}.${fraction}`;
}

function deny(interaction, text) {
  const payload = { content: text, flags: MessageFlags.Ephemeral };
  if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

function unknownInteraction(error) {
  return error && (error.code === 10062 || error.rawError?.code === 10062);
}

function userIdFrom(text) {
  const match = String(text || '').match(/(\d{17,20})/);
  return match ? match[1] : '';
}

async function categoryFor(guild, assetKey) {
  const name = categoryName(assetKey);
  const cached = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory && channel.name === name
  );
  if (cached) return cached.id;
  await guild.channels.fetch().catch(() => {});
  const named = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory && channel.name === name
  );
  if (named) return named.id;
  const created = await guild.channels.create({ name, type: ChannelType.GuildCategory });
  return created.id;
}

function dropPrevious(previousStatus, nextStatus) {
  if (previousStatus === 'AWAITING_PARTNER' || previousStatus === 'AWAITING_AMOUNT' || previousStatus === 'FEE_SELECTION') return true;
  if (previousStatus === 'ROLE_SELECTION' && nextStatus === 'ROLE_CONFIRMATION') return true;
  if (previousStatus === 'ROLE_CONFIRMATION' && nextStatus === 'ROLE_SELECTION') return true;
  if (previousStatus === 'AMOUNT_CONFIRMATION' && nextStatus === 'AWAITING_AMOUNT') return true;
  if (previousStatus === 'FEE_CONFIRMATION' && nextStatus === 'FEE_SELECTION') return true;
  return false;
}

function finishedRecord(previousStatus, escrow) {
  if (!escrow) return null;
  if (previousStatus === 'ROLE_CONFIRMATION' && escrow.status !== 'ROLE_SELECTION' && escrow.status !== 'ROLE_CONFIRMATION') {
    return { ...escrow, status: 'ROLE_CONFIRMATION', role_ok_sender: 1, role_ok_receiver: 1 };
  }
  if (previousStatus === 'AMOUNT_CONFIRMATION' && escrow.status !== 'AWAITING_AMOUNT' && escrow.status !== 'AMOUNT_CONFIRMATION') {
    return { ...escrow, status: 'AMOUNT_CONFIRMATION', amount_ok_sender: 1, amount_ok_receiver: 1 };
  }
  if (previousStatus === 'FEE_CONFIRMATION' && escrow.status !== 'FEE_SELECTION' && escrow.status !== 'FEE_CONFIRMATION') {
    return { ...escrow, status: 'FEE_CONFIRMATION', fee_ok_sender: 1, fee_ok_receiver: 1 };
  }
  return null;
}

function restoresKept(previousStatus, nextStatus) {
  if (nextStatus === 'FUNDED' && (previousStatus === 'RELEASE_CONFIRMATION' || previousStatus === 'CANCEL_REQUEST')) return true;
  if (nextStatus === 'AWAITING_DEPOSIT' && previousStatus === 'DEAL_CANCEL') return true;
  if (nextStatus === 'WRONG_AMOUNT' && (previousStatus === 'WRONG_CONTINUE' || previousStatus === 'WRONG_CANCEL')) return true;
  return false;
}

function keptMessage(message, escrow) {
  if (message.author.id !== message.client.user.id) return false;
  if (escrow.status === 'AWAITING_DEPOSIT') {
    return message.embeds.some((embed) => embed.title === 'Deal Summary' || embed.title === 'Waiting for payment');
  }
  if (escrow.status === 'WRONG_AMOUNT') return message.embeds.some((embed) => embed.title === 'Wrong amount received');
  if (escrow.status === 'FUNDED') return message.embeds.some((embed) => String(embed.description || '').includes('The payment is confirmed'));
  return false;
}

async function restoreKept(channel, escrow) {
  const history = await channel.messages.fetch({ limit: 40 }).catch(() => null);
  if (!history) return false;
  const message = [...history.values()]
    .filter((item) => keptMessage(item, escrow))
    .sort((left, right) => (BigInt(right.id) > BigInt(left.id) ? 1 : -1))[0];
  if (!message) return false;
  const view = await present.stage(escrow);
  if (escrow.status === 'AWAITING_DEPOSIT') await message.edit({ components: view.payload.components }).catch(() => {});
  else await message.edit({ embeds: view.payload.embeds, components: view.payload.components }).catch(() => {});
  flow.rememberPrompt(escrow.id, message.id);
  return true;
}

async function retirePrompt(channel, previousId, { drop, previousStatus, nextStatus, escrow }) {
  if (!previousId) return;
  const previous = await channel.messages.fetch(previousId).catch(() => null);
  const record = finishedRecord(previousStatus, escrow);
  if (record && previous) {
    await previous.edit({ embeds: [present.embed(record)], components: [] }).catch(() => {});
    return;
  }
  if (previousStatus === 'AWAITING_DEPOSIT') {
    if (previous && previous.embeds.length === 0) await previous.delete().catch(() => {});
    const leavingPayment = nextStatus !== 'AWAITING_DEPOSIT' && nextStatus !== 'DEAL_CANCEL';
    if (!leavingPayment) return;
    if (previous && previous.embeds.length > 0) {
      await previous.edit({ components: [] }).catch(() => {});
      return;
    }
    const history = await channel.messages.fetch({ limit: 40 }).catch(() => null);
    const card = history && [...history.values()].find((item) => item.embeds.some((embed) => embed.title === 'Deal Summary' || embed.title === 'Waiting for payment'));
    if (card) await card.edit({ components: [] }).catch(() => {});
    return;
  }
  if (!previous) return;
  if (drop) await previous.delete().catch(() => {});
  else await previous.edit({ components: [] }).catch(() => {});
}

async function postStage(channel, escrow, { announce = true, previousStatus = null } = {}) {
  const previousId = flow.getEscrow(escrow.id)?.prompt_message_id;
  const view = await present.stage(escrow);
  const sent = await channel.send(announce ? present.messageFrom(view) : view.payload);
  flow.rememberPrompt(escrow.id, sent.id);
  await retirePrompt(channel, previousId, {
    drop: dropPrevious(previousStatus, escrow.status),
    previousStatus,
    nextStatus: escrow.status,
    escrow,
  });
  const latest = flow.getEscrow(escrow.id);
  if (latest && latest.status === 'RELEASE_CONFIRMATION' && Date.now() < Number(latest.unlocks_at || 0)) {
    scheduleUnlock(channel.client, latest);
  }
  if (escrow.deposit_address && escrow.status === 'AWAITING_DEPOSIT') await lockWelcome(channel);
  return sent;
}

async function lockWelcome(channel) {
  const history = await channel.messages.fetch({ limit: 40 }).catch(() => null);
  if (!history) return;
  const welcome = [...history.values()].find((item) => item.embeds[0]?.title === 'Auto MM' && item.components.length > 0);
  if (welcome) await welcome.edit({ components: [] }).catch(() => {});
}

async function showStage(interaction, escrow, previousStatus) {
  if (previousStatus === 'ROLE_SELECTION' && escrow.status === 'ROLE_SELECTION' && interaction.message) {
    const view = await present.stage(escrow);
    try {
      await interaction.message.edit(view.payload);
      flow.rememberPrompt(escrow.id, interaction.message.id);
      return;
    } catch (error) {
      console.error('[discord] role edit', error.message);
    }
  }
  if (previousStatus === 'FEE_CONFIRMATION' && escrow.status === 'FEE_CONFIRMATION' && interaction.message) {
    const view = await present.stage(escrow);
    try {
      await interaction.message.edit({ embeds: view.payload.embeds, components: view.payload.components });
      flow.rememberPrompt(escrow.id, interaction.message.id);
      return;
    } catch (error) {
      console.error('[discord] fee edit', error.message);
    }
  }
  if (previousStatus === 'ROLE_CONFIRMATION' && escrow.status === 'ROLE_CONFIRMATION' && interaction.message) {
    const view = await present.stage(escrow);
    try {
      await interaction.message.edit({ embeds: view.payload.embeds, components: view.payload.components });
      flow.rememberPrompt(escrow.id, interaction.message.id);
      return;
    } catch (error) {
      console.error('[discord] role confirm edit', error.message);
    }
  }
  if (previousStatus === 'AMOUNT_CONFIRMATION' && escrow.status === 'AMOUNT_CONFIRMATION' && interaction.message) {
    const view = await present.stage(escrow);
    try {
      await interaction.message.edit({ embeds: view.payload.embeds, components: view.payload.components });
      flow.rememberPrompt(escrow.id, interaction.message.id);
      return;
    } catch (error) {
      console.error('[discord] amount edit', error.message);
    }
  }
  if (restoresKept(previousStatus, escrow.status)) {
    const previousId = flow.getEscrow(escrow.id)?.prompt_message_id;
    await retirePrompt(interaction.channel, previousId, { drop: true, previousStatus, nextStatus: escrow.status });
    if (await restoreKept(interaction.channel, escrow)) return;
  }
  await postStage(interaction.channel, escrow, {
    announce: previousStatus == null || escrow.status !== previousStatus,
    previousStatus,
  });
}

async function acknowledge(interaction) {
  if (interaction.deferred || interaction.replied) return true;
  try {
    await interaction.deferUpdate();
    return true;
  } catch (error) {
    if (unknownInteraction(error)) return false;
    throw error;
  }
}

async function advance(interaction, previous, result) {
  if (!result.ok) return deny(interaction, result.error);
  await showStage(interaction, result.row, previous.status);
  return null;
}

function scheduleUnlock(client, escrow) {
  if (unlockTimers.has(escrow.id)) return;
  const delay = Math.max(0, Number(escrow.unlocks_at || 0) - Date.now());
  const timer = setTimeout(() => {
    unlockTimers.delete(escrow.id);
    enableRelease(client, escrow.id).catch((error) => {
      console.error(`[escrow ${escrow.id}] unlock`, error.message);
    });
  }, delay);
  unlockTimers.set(escrow.id, timer);
}

async function enableRelease(client, id) {
  const escrow = flow.getEscrow(id);
  if (!escrow || escrow.status !== 'RELEASE_CONFIRMATION' || !escrow.channel_id || !escrow.prompt_message_id) return;
  if (Date.now() < Number(escrow.unlocks_at || 0)) return;
  const channel = await client.channels.fetch(escrow.channel_id).catch(() => null);
  if (!channel) return;
  const message = await channel.messages.fetch(escrow.prompt_message_id).catch(() => null);
  if (!message) return;
  const view = await present.stage(escrow);
  await message.edit({ embeds: view.payload.embeds, components: view.payload.components }).catch((error) => {
    console.error(`[escrow ${id}] unlock`, error.message);
  });
}

function resumeUnlocks(client) {
  for (const escrow of flow.listStatus(['RELEASE_CONFIRMATION'])) scheduleUnlock(client, escrow);
}

async function openTicket(interaction, { assetKey }) {
  const escrow = flow.createEscrow({
    guildId: interaction.guild.id,
    creatorId: interaction.user.id,
    asset: assetKey,
  });
  try {
    const parent = await categoryFor(interaction.guild, escrow.asset);
    const allow = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AttachFiles,
    ];
    const overwrites = [
      { id: interaction.guild.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, type: OverwriteType.Member, allow },
      { id: interaction.client.user.id, type: OverwriteType.Member, allow: [...allow, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.EmbedLinks] },
    ];
    if (config.staffRoleId) {
      overwrites.push({
        id: config.staffRoleId,
        type: OverwriteType.Role,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      });
    }
    const channel = await interaction.guild.channels.create({
      name: ticketName(escrow.asset, escrow.id),
      type: ChannelType.GuildText,
      parent,
      permissionOverwrites: overwrites,
    });
    const saved = flow.setChannel(escrow.id, channel.id);
    await channel.send(present.welcomeMessage(saved));
    await postStage(channel, saved);
    await interaction.editReply(`Ticket opened: ${channel}`);
  } catch (error) {
    flow.removeEscrow(escrow.id);
    console.error('[escrow] create channel', error.message);
    await interaction.editReply('I could not create the private ticket. I need the Manage Channels permission in this server.');
  }
}

async function onButton(interaction) {
  if (interaction.customId.startsWith('panel:')) {
    const assetKey = interaction.customId.slice('panel:'.length);
    try {
      getAsset(assetKey);
    } catch {
      return deny(interaction, 'That coin is not on the list.');
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await openTicket(interaction, { assetKey });
    return null;
  }
  if (!interaction.customId.startsWith('e:')) return null;
  const [, rawId, ...rest] = interaction.customId.split(':');
  const action = rest.join(':');
  const escrow = flow.getEscrow(Number(rawId));
  if (!escrow || escrow.channel_id !== interaction.channelId) return deny(interaction, 'This button is not for this channel.');
  const userId = interaction.user.id;

  if (action === 'who' || action === 'amt') {
    if (action === 'who' && interaction.user.id !== escrow.creator_id) return deny(interaction, 'Only the person who opened the ticket can do that.');
    if (action === 'amt' && interaction.user.id !== escrow.sender_id) return deny(interaction, 'Only the sender can enter the deal amount.');
    if (action === 'who' && escrow.status !== 'AWAITING_PARTNER') return deny(interaction, 'This ticket is not waiting for a user ID.');
    if (action === 'amt' && escrow.status !== 'AWAITING_AMOUNT') return deny(interaction, 'This ticket is not waiting for an amount.');
    const modal = new ModalBuilder()
      .setCustomId(action === 'who' ? `modal:partner:${escrow.id}` : `modal:amount:${escrow.id}`)
      .setTitle(action === 'who' ? 'Other person' : 'Deal amount in USD')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('value')
          .setLabel(action === 'who' ? 'Discord user ID' : 'Deal amount in USD')
          .setPlaceholder(action === 'who' ? '123456789012345678' : '100 or 250.50')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(32)
      ));
    return interaction.showModal(modal);
  }

  if (action === 'addr:ask') {
    const waiting = escrow.status === 'AWAITING_PAYOUT_ADDRESS' || escrow.status === 'AWAITING_REFUND_ADDRESS';
    const expected = escrow.status === 'AWAITING_REFUND_ADDRESS' ? escrow.sender_id : escrow.receiver_id;
    if (!waiting) return deny(interaction, 'This ticket is not waiting for an address.');
    if (userId !== expected) return deny(interaction, 'Only the person who was asked can enter the address.');
    return interaction.showModal(new ModalBuilder()
      .setCustomId(`modal:addr:${escrow.id}`)
      .setTitle(escrow.settlement === 'refund' ? 'Refund address' : 'Payout address')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('address')
          .setLabel(`${getAsset(escrow.asset).label} address`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(120)
      )));
  }

  if (!(await acknowledge(interaction))) return null;

  if (action === 'copy') {
    if (escrow.status !== 'AWAITING_DEPOSIT' || !escrow.deposit_address) return deny(interaction, 'There is no payment address to copy yet.');
    if (!flow.isParticipant(escrow, userId)) return deny(interaction, 'Only the two people in this ticket can do that.');
    const exact = formatAmount(BigInt(escrow.deposit_raw), getAsset(escrow.asset).decimals);
    await interaction.channel.send(escrow.deposit_address);
    await interaction.channel.send(exact);
    return null;
  }
  if (action === 'deal:ok') {
    if (escrow.status !== 'DEAL_CANCEL') return deny(interaction, 'Cancel confirmation is not open.');
    let payments;
    try {
      payments = await incoming(escrow.asset, escrow.deposit_address);
    } catch {
      return deny(interaction, 'Could not check the address for a payment. Try again in a moment.');
    }
    if (payments.length) return deny(interaction, 'A payment already reached this address, so this deal cannot be cancelled.');
    const result = flow.confirmDealCancel(escrow.id, userId);
    if (!result.ok) return deny(interaction, result.error);
    const deleted = await interaction.channel.delete('Escrow deal cancelled').then(() => true).catch((error) => {
      console.error(`[escrow ${escrow.id}] delete channel`, error.message);
      return false;
    });
    if (!deleted) await showStage(interaction, result.row);
    return null;
  }

  if (action === 'role:s' || action === 'role:r') return advance(interaction, escrow, flow.chooseRole(escrow.id, userId, action === 'role:s' ? 'sender' : 'receiver'));
  if (action === 'roles:ok') return advance(interaction, escrow, flow.confirmRoles(escrow.id, userId));
  if (action === 'roles:no') return advance(interaction, escrow, flow.redoRoles(escrow.id, userId));
  if (action === 'amt:ok') return advance(interaction, escrow, flow.confirmAmount(escrow.id, userId));
  if (action === 'amt:no') return advance(interaction, escrow, flow.redoAmount(escrow.id, userId));
  if (action === 'fee:s' || action === 'fee:r' || action === 'fee:split') {
    const payer = action === 'fee:s' ? 'sender' : action === 'fee:r' ? 'receiver' : 'split';
    let network = 0n;
    try {
      const priced = quote(BigInt(escrow.amount_raw), payer, escrow.usd_raw);
      const asset = getAsset(escrow.asset);
      const cost = await estimateNetworkCost(escrow.asset, priced.deposit - priced.payout);
      network = asset.kind === 'evm-token' || asset.kind === 'spl'
        ? await stableNetworkFee(escrow.asset, cost.relay)
        : cost.depositExtra;
    } catch (error) {
      if (error.public) return deny(interaction, error.message);
    }
    return advance(interaction, escrow, flow.chooseFee(escrow.id, userId, payer, network));
  }
  if (action === 'fee:ok') return advance(interaction, escrow, flow.confirmFee(escrow.id, userId));
  if (action === 'fee:no') return advance(interaction, escrow, flow.redoFee(escrow.id, userId));
  if (action === 'deal:rescan') {
    if (escrow.status !== 'AWAITING_DEPOSIT' || escrow.deposit_tx) return deny(interaction, 'There is no open payment to rescan.');
    if (!flow.isParticipant(escrow, userId)) return deny(interaction, 'Only the two people in this ticket can do that.');
    try {
      const found = await scanDeposit(interaction.client, flow.getEscrow(escrow.id));
      if (found !== 'found') return deny(interaction, 'No payment has shown up yet.');
    } catch {
      return deny(interaction, 'Could not check the address. Try Rescan again in a moment.');
    }
    return null;
  }
  if (action === 'deal:cancel') return advance(interaction, escrow, flow.requestDealCancel(escrow.id, userId));
  if (action === 'deal:back') return advance(interaction, escrow, flow.undoDealCancel(escrow.id, userId));
  if (action === 'wrong:go') return advance(interaction, escrow, flow.proposeWrong(escrow.id, userId, 'continue'));
  if (action === 'wrong:stop') return advance(interaction, escrow, flow.proposeWrong(escrow.id, userId, 'cancel'));
  if (action === 'wrong:back') return advance(interaction, escrow, flow.declineWrong(escrow.id, userId));
  if (action === 'wrong:yes') {
    if (!['WRONG_CONTINUE', 'WRONG_CANCEL'].includes(escrow.status)) return deny(interaction, 'That choice is not open.');
    let confirmations = Number(escrow.deposit_confirmations || 0);
    try {
      const payments = await incoming(escrow.asset, escrow.deposit_address);
      const match = payments.find((payment) => payment.txid === escrow.deposit_tx);
      if (match) confirmations = match.confirmations;
    } catch {
      return deny(interaction, 'Could not check that payment. Try again in a moment.');
    }
    return advance(interaction, escrow, flow.acceptWrong(escrow.id, userId, confirmations));
  }
  if (action === 'go:release') return advance(interaction, escrow, flow.requestRelease(escrow.id, userId));
  if (action === 'go:cancel') return advance(interaction, escrow, flow.requestCancel(escrow.id, userId));
  if (action === 'rel:ok') return advance(interaction, escrow, flow.confirmRelease(escrow.id, userId));
  if (action === 'rel:back') return advance(interaction, escrow, flow.returnToFunded(escrow.id, userId, 'RELEASE_CONFIRMATION'));
  if (action === 'can:ok') return advance(interaction, escrow, flow.confirmCancel(escrow.id, userId));
  if (action === 'can:back') return advance(interaction, escrow, flow.returnToFunded(escrow.id, userId, 'CANCEL_REQUEST'));
  if (action === 'addr:no') return advance(interaction, escrow, flow.redoAddress(escrow.id, userId));
  if (action === 'close') {
    const staff = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
    const finished = escrow.status === 'COMPLETED' || escrow.status === 'REFUNDED';
    if (!finished && escrow.deposit_address) {
      return deny(interaction, 'This ticket stays open. The payment address has already been sent.');
    }
    let closed = null;
    if (finished) {
      const participant = userId === escrow.sender_id || userId === escrow.receiver_id;
      if (!staff && !participant) return deny(interaction, 'Only the two people in this ticket can close it.');
    } else {
      closed = flow.closeTicket(escrow.id, userId, staff);
      if (!closed.ok) return deny(interaction, closed.error);
    }
    if (closingChannels.has(interaction.channelId)) return null;
    closingChannels.add(interaction.channelId);
    await interaction.message?.edit({ components: [] }).catch(() => {});
    const deleted = await playClosing(interaction.channel);
    closingChannels.delete(interaction.channelId);
    if (!deleted && finished) return deny(interaction, 'The channel could not be deleted.');
    if (!deleted) await showStage(interaction, closed.row);
    return null;
  }
  if (action === 'addr:ok' || action === 'retry') {
    const expected = escrow.settlement === 'refund' ? escrow.sender_id : escrow.receiver_id;
    if (userId !== expected) return deny(interaction, 'Only the person who supplied the address can confirm it.');
    if (!['PAYOUT_CONFIRM', 'REFUND_CONFIRM', 'SETTLEMENT_REVIEW'].includes(escrow.status)) {
      return deny(interaction, 'That action is not available right now.');
    }
    await interaction.message.edit({ components: [] }).catch(() => {});
    await settle(interaction.channel, flow.getEscrow(escrow.id));
    return null;
  }
  return deny(interaction, 'That action is not available.');
}

async function applyPartner(channel, escrow, actorId, text) {
  const partnerId = userIdFrom(text);
  if (!partnerId) return 'Paste a Discord user ID. Turn on Developer Mode, right-click the person, then choose Copy User ID.';
  let member;
  try {
    member = await channel.guild.members.fetch(partnerId);
  } catch {
    return 'That user is not in this server. They have to join before you can add them.';
  }
  if (member.user.bot) return 'The other person has to be a real user, not a bot.';
  const result = flow.setPartner(escrow.id, actorId, partnerId);
  if (!result.ok) return result.error;
  await channel.permissionOverwrites.edit(partnerId, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
  }).catch(() => {});
  return result;
}

async function applyAmount(escrow, actorId, text) {
  const token = String(text || '').trim().split(/\s+/)[0].replace(/[`$,]/g, '');
  try {
    const usdCents = parseAmount(token, 2);
    const quoted = await quoteUsd(escrow.asset, usdCents);
    const result = flow.setAmount(escrow.id, actorId, quoted.raw, usdCents, quoted.priceRaw);
    if (!result.ok) return result.error;
    return result;
  } catch (error) {
    return error.public ? error.message : 'Enter the deal amount in USD, such as 100 or 250.50.';
  }
}

async function showResult(channel, result, previousStatus) {
  await postStage(channel, result.row, { previousStatus });
}

async function onSetupModal(interaction) {
  const escrow = flow.getEscrow(Number(interaction.customId.split(':')[2]));
  if (!escrow) return deny(interaction, 'This ticket no longer exists.');
  const partner = interaction.customId.startsWith('modal:partner:');
  const allowed = partner ? escrow.creator_id : escrow.sender_id;
  if (interaction.user.id !== allowed) {
    return deny(interaction, partner ? 'Only the person who opened the ticket can do that.' : 'Only the sender can enter the deal amount.');
  }
  const value = interaction.fields.getTextInputValue('value');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = partner
    ? await applyPartner(interaction.channel, escrow, interaction.user.id, value)
    : await applyAmount(escrow, interaction.user.id, value);
  if (typeof result === 'string') {
    await interaction.editReply(result);
    return;
  }
  await interaction.editReply(partner ? 'They were added to the ticket.' : 'Amount saved.');
  await showResult(interaction.channel, result, escrow.status);
}

async function onAddressModal(interaction) {
  const escrow = flow.getEscrow(Number(interaction.customId.split(':')[2]));
  if (!escrow) return deny(interaction, 'This ticket no longer exists.');
  const waiting = escrow.status === 'AWAITING_PAYOUT_ADDRESS' || escrow.status === 'AWAITING_REFUND_ADDRESS';
  const expected = escrow.status === 'AWAITING_REFUND_ADDRESS' ? escrow.sender_id : escrow.receiver_id;
  if (!waiting) return deny(interaction, 'This ticket is not waiting for an address.');
  if (interaction.user.id !== expected) return deny(interaction, 'Only the person who was asked can enter the address.');
  const found = addressTokens(interaction.fields.getTextInputValue('address'))
    .map((token) => normalizeAddress(escrow.asset, token))
    .find((token) => validAddress(escrow.asset, token));
  if (!found) {
    return deny(interaction, `That is not a valid ${getAsset(escrow.asset).label} address. Check the coin and the network, then try again.`);
  }
  const result = flow.submitAddress(escrow.id, interaction.user.id, found);
  if (!result.ok) return deny(interaction, result.error);
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: 'Address received. Confirm it in the ticket before any coins move.',
  });
  await postStage(interaction.channel, result.row, { previousStatus: escrow.status });
}

function addressTokens(text) {
  return String(text || '').replace(/[`<>]/g, ' ').split(/\s+/).filter(Boolean);
}

async function onMessage(message) {
  if (!message.guild || message.author.bot) return;
  const escrow = flow.getByChannel(message.channel.id);
  if (!escrow) return;
  if (!message.content) return;
  if (escrow.status === 'AWAITING_PARTNER' || escrow.status === 'AWAITING_AMOUNT') {
    const allowed = escrow.status === 'AWAITING_PARTNER' ? escrow.creator_id : escrow.sender_id;
    if (message.author.id !== allowed) return;
    const result = escrow.status === 'AWAITING_PARTNER'
      ? await applyPartner(message.channel, escrow, message.author.id, message.content)
      : await applyAmount(escrow, message.author.id, message.content);
    if (typeof result === 'string') {
      await message.reply(result);
      return;
    }
    await showResult(message.channel, result, escrow.status);
    return;
  }
  const waiting = escrow.status === 'AWAITING_PAYOUT_ADDRESS' || escrow.status === 'AWAITING_REFUND_ADDRESS';
  if (!waiting) return;
  const expected = escrow.status === 'AWAITING_PAYOUT_ADDRESS' ? escrow.receiver_id : escrow.sender_id;
  if (message.author.id !== expected) return;
  const found = addressTokens(message.content)
    .map((token) => normalizeAddress(escrow.asset, token))
    .find((token) => validAddress(escrow.asset, token));
  if (!found) {
    const label = getAsset(escrow.asset).label;
    await message.reply(`That is not a valid ${label} address. Check the coin and the network, then try again.`);
    return;
  }
  const result = flow.submitAddress(escrow.id, message.author.id, found);
  if (!result.ok) {
    await message.reply(result.error);
    return;
  }
  await postStage(message.channel, result.row, { previousStatus: escrow.status });
}

function start(client) {
  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.guild) {
        await deny(interaction, 'Use this bot inside a server.');
        return;
      }
      if (interaction.isChatInputCommand() && interaction.commandName === 'escrow') {
        await interaction.reply(present.panelMessage(true));
        return;
      }
      if (interaction.isChatInputCommand() && interaction.commandName === 'ranks') {
        const list = ranks.rankList();
        await interaction.reply({
          ...present.ranksMessage(list),
          allowedMentions: { roles: list.map((rank) => rank.roleId) },
        });
        return;
      }
      if (interaction.isChatInputCommand() && interaction.commandName === 'leaderboard') {
        const entries = flow.leaderboard(10);
        await interaction.reply({
          ...present.leaderboardMessage(entries),
          allowedMentions: { users: entries.map((entry) => entry.id) },
        });
        return;
      }
      if (interaction.isChatInputCommand() && interaction.commandName === 'addstats') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          await deny(interaction, 'You need the Manage Server permission to add stats.');
          return;
        }
        const target = interaction.options.getUser('user', true);
        let cents;
        try {
          cents = parseAmount(interaction.options.getString('amount', true), 2);
        } catch (error) {
          await deny(interaction, error.public ? error.message : 'Enter a USD amount such as 1000 or 250.50.');
          return;
        }
        const stats = flow.addStats(target.id, cents, interaction.user.id);
        await ranks.sync(interaction.client, [target.id]).catch((error) => {
          console.error('[ranks]', error.message);
        });
        await interaction.reply({
          content: `Added ${usd(cents)} to <@${target.id}>. Total dealt is now ${usd(stats.cents)}.`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { users: [target.id] },
        });
        return;
      }
      if (interaction.isChatInputCommand() && interaction.commandName === 'removestats') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          await deny(interaction, 'You need the Manage Server permission to remove stats.');
          return;
        }
        const target = interaction.options.getUser('user', true);
        let cents;
        try {
          cents = parseAmount(interaction.options.getString('amount', true), 2);
        } catch (error) {
          await deny(interaction, error.public ? error.message : 'Enter a USD amount such as 1000 or 250.50.');
          return;
        }
        const stats = flow.removeStats(target.id, cents, interaction.user.id);
        if (stats.removed <= 0n) {
          await deny(interaction, 'That person has no deal volume to remove.');
          return;
        }
        await ranks.sync(interaction.client, [target.id]).catch((error) => {
          console.error('[ranks]', error.message);
        });
        await interaction.reply({
          content: `Removed ${usd(stats.removed)} from <@${target.id}>. Total dealt is now ${usd(stats.cents)}.`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { users: [target.id] },
        });
        return;
      }
      if (interaction.isChatInputCommand() && interaction.commandName === 'stats') {
        const target = interaction.options.getUser('user') || interaction.user;
        const avatar = target.displayAvatarURL({ extension: 'png', size: 256 });
        const stats = flow.userStats(target.id);
        const roleId = ranks.topRole(stats);
        const next = ranks.nextRole(stats);
        await interaction.reply({
          ...present.statsMessage(target.id, avatar, stats, ranks.roleName(roleId), next, ranks.badgeColor(roleId)),
          allowedMentions: { users: [target.id], roles: next?.roleId ? [next.roleId] : [] },
        });
        return;
      }
      if (interaction.isChatInputCommand() && interaction.commandName === 'escrow-panel') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          await deny(interaction, 'You need the Manage Server permission to post the panel.');
          return;
        }
        await interaction.channel.send(present.panelMessage(false));
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Escrow panel posted. Older panel messages stay as they were, so use this new one.' });
        return;
      }
      if (interaction.isButton()) {
        await onButton(interaction);
        return;
      }
      if (interaction.isModalSubmit() && (interaction.customId.startsWith('modal:partner:') || interaction.customId.startsWith('modal:amount:'))) {
        await onSetupModal(interaction);
        return;
      }
      if (interaction.isModalSubmit() && interaction.customId.startsWith('modal:addr:')) {
        await onAddressModal(interaction);
        return;
      }
    } catch (error) {
      if (unknownInteraction(error)) return;
      console.error('[discord]', error.message);
      const text = error.public ? error.message : 'Something went wrong. No funds were sent.';
      await deny(interaction, text).catch(() => {});
    }
  });
  client.on('messageCreate', (message) => {
    onMessage(message).catch((error) => console.error('[discord] message', error.message));
  });
}

async function renameTickets(client) {
  for (const row of flow.listWithChannel()) {
    const channel = await client.channels.fetch(row.channel_id).catch(() => null);
    if (!channel || !channel.guild) continue;
    const parent = await categoryFor(channel.guild, row.asset).catch((error) => {
      console.error(`[escrow ${row.id}] category`, error.message);
      return null;
    });
    if (parent && channel.parentId !== parent) {
      await channel.setParent(parent, { lockPermissions: false }).catch((error) => {
        console.error(`[escrow ${row.id}] category`, error.message);
      });
    }
    const name = ticketName(row.asset, row.id);
    if (channel.name !== name) {
      await channel.setName(name).catch((error) => console.error(`[escrow ${row.id}] rename`, error.message));
    }
    const recent = await channel.messages.fetch({ limit: 30 }).catch(() => null);
    const blueTitles = new Set([
      'Who are you dealing with?',
      'Choose your role',
      'Confirm the roles',
      'Enter the deal amount in USD',
      'Confirm the deal amount',
      'Who pays the fee?',
      'Confirm the fee',
    ]);
    if (recent) {
      for (const item of recent.values()) {
        if (!blueTitles.has(item.embeds[0]?.title) || item.embeds[0].color === 0x2b6cff) continue;
        const data = item.embeds[0].toJSON();
        data.color = 0x2b6cff;
        await item.edit({ embeds: [data] }).catch((error) => console.error(`[escrow ${row.id}] color`, error.message));
      }
    }
    const welcome = recent && [...recent.values()].find((item) => item.embeds[0]?.title === 'Auto MM');
    if (welcome && welcome.embeds[0].color !== 0x7c3aed) {
      const data = welcome.embeds[0].toJSON();
      data.color = 0x7c3aed;
      await welcome.edit({ embeds: [data] }).catch((error) => console.error(`[escrow ${row.id}] welcome color`, error.message));
    }
  }
  for (const escrow of flow.listStatus(['AWAITING_PARTNER', 'ROLE_SELECTION', 'ROLE_CONFIRMATION', 'AWAITING_AMOUNT', 'AMOUNT_CONFIRMATION', 'FEE_SELECTION', 'FEE_CONFIRMATION', 'AWAITING_PAYOUT_ADDRESS', 'AWAITING_REFUND_ADDRESS', 'PAYOUT_CONFIRM', 'REFUND_CONFIRM'])) {
    if (!escrow.channel_id || !escrow.prompt_message_id) continue;
    const channel = await client.channels.fetch(escrow.channel_id).catch(() => null);
    if (!channel) continue;
    const message = await channel.messages.fetch(escrow.prompt_message_id).catch(() => null);
    if (!message) continue;
    const view = await present.stage(escrow);
    await message.edit({ embeds: view.payload.embeds, components: view.payload.components }).catch((error) => {
      console.error(`[escrow ${escrow.id}] prompt`, error.message);
    });
  }
}

module.exports = { start, resumeUnlocks, postStage, renameTickets };
