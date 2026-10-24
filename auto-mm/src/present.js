const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} = require('discord.js');
const QRCode = require('qrcode');
const { ASSET_LIST, getAsset, ticketName } = require('./assets');
const { formatAmount, feeCentsFor, FEE_TIERS_TEXT } = require('./money');

const STATUS = {
  AWAITING_PARTNER: 'Waiting for the other person',
  ROLE_SELECTION: 'Choosing roles',
  ROLE_CONFIRMATION: 'Confirming roles',
  AWAITING_AMOUNT: 'Waiting for the amount',
  AMOUNT_CONFIRMATION: 'Confirming the amount',
  FEE_SELECTION: 'Choosing who pays the fee',
  FEE_CONFIRMATION: 'Confirming the fee',
  AWAITING_DEPOSIT: 'Waiting for payment',
  WRONG_AMOUNT: 'Wrong amount received',
  WRONG_CONTINUE: 'Continue this deal?',
  WRONG_CANCEL: 'Cancel this deal?',
  DEAL_CANCEL: 'Cancelling the deal',
  CONFIRMING_DEPOSIT: 'Waiting for confirmations',
  FUNDED: 'Payment confirmed',
  RELEASE_CONFIRMATION: 'Confirming release',
  AWAITING_PAYOUT_ADDRESS: 'Waiting for the receiver address',
  PAYOUT_CONFIRM: 'Confirming the payout address',
  CANCEL_REQUEST: 'Cancel requested',
  AWAITING_REFUND_ADDRESS: 'Waiting for the refund address',
  REFUND_CONFIRM: 'Confirming the refund address',
  BROADCASTING: 'Sending the coins',
  SETTLEMENT_REVIEW: 'Send needs another look',
  COMPLETED: 'Completed',
  REFUNDED: 'Refunded',
  CLOSED: 'Closed',
};

function button(id, label, style, disabled = false) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
}

function row(...buttons) {
  return new ActionRowBuilder().addComponents(...buttons);
}

function person(id) {
  return id ? `<@${id}>` : 'Not selected';
}

function feeLabel(payer) {
  if (payer === 'sender') return 'Sender';
  if (payer === 'receiver') return 'Receiver';
  if (payer === 'split') return 'Split';
  return 'Not selected';
}

function amount(raw, assetKey) {
  if (raw == null || !assetKey) return 'Not set';
  const asset = getAsset(assetKey);
  return `${formatAmount(BigInt(raw), asset.decimals)} ${asset.symbol}`;
}

function dealAmount(escrow) {
  const crypto = amount(escrow.amount_raw, escrow.asset);
  if (escrow.usd_raw == null) return crypto;
  const usd = formatUsdFixed(BigInt(escrow.usd_raw));
  if (escrow.amount_raw == null) return usd;
  return `${usd} (${crypto})`;
}

function usdText(escrow) {
  if (escrow.usd_raw == null) return 'Not set';
  return formatUsdFixed(BigInt(escrow.usd_raw));
}

function formatUsdFixed(cents) {
  const negative = cents < 0n;
  const value = negative ? -cents : cents;
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}$${whole}.${fraction}`;
}

function feeCents(escrow) {
  return escrow.usd_raw == null ? 0n : feeCentsFor(escrow.usd_raw);
}

function feeUsdText(escrow) {
  const cents = feeCents(escrow);
  return cents === 0n ? 'Free' : formatUsdFixed(cents);
}

function feeIntro(escrow) {
  if (feeCents(escrow) === 0n) return 'Deals under $50 are free, so there is no fee for this deal.';
  return `The fee for this deal is **${feeUsdText(escrow)}**.`;
}

function feeField(escrow) {
  if (escrow.fee_raw != null) {
    if (BigInt(escrow.fee_raw) === 0n) return 'Free';
    return `${amount(escrow.fee_raw, escrow.asset)} (${feeLabel(escrow.fee_payer)})`;
  }
  return escrow.usd_raw == null ? 'Free under $50' : feeUsdText(escrow);
}

const COIN_NAME = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  LTC: 'Litecoin',
  SOL: 'Solana',
  'USDT-ERC20': 'USDT on Ethereum',
  'USDC-ERC20': 'USDC on Ethereum',
  'USDT-BEP20': 'USDT on BNB Chain',
  'USDC-BEP20': 'USDC on BNB Chain',
  'USDT-SOL': 'USDT on Solana',
  'USDC-SOL': 'USDC on Solana',
};

const COIN_EMOJI = {
  BTC: '<:btc:1556386869950947470>',
  ETH: '<:eth:1556386958232780800>',
  LTC: '<:ltc:1556387109747691560>',
  SOL: '<:sol:1556387037127647257>',
  'USDC-BEP20': '<:usdcbnb:1556387589072748565>',
  'USDC-ERC20': '<:usdceth:1556387649650958567>',
  'USDC-SOL': '<:usdcsol:1556387722392764558>',
  'USDT-BEP20': '<:usdtbnb:1556386382912552971>',
  'USDT-ERC20': '<:usdteth:1556386460381356092>',
  'USDT-SOL': '<:usdtsol:1556386557164916737>',
};

function networkUsdCents(escrow) {
  if (!escrow.network_raw || !escrow.price_raw || !escrow.asset) return 0n;
  const asset = getAsset(escrow.asset);
  const network = BigInt(escrow.network_raw);
  if (network <= 0n) return 0n;
  const scale = 10n ** BigInt(asset.decimals);
  return (network * BigInt(escrow.price_raw)) / (scale * 1000000n);
}

function depositUsdCents(escrow) {
  const deal = BigInt(escrow.usd_raw);
  const fee = feeCents(escrow);
  const base = escrow.fee_payer === 'receiver' ? deal : escrow.fee_payer === 'split' ? deal + (fee + 1n) / 2n : deal + fee;
  return base + networkUsdCents(escrow);
}

function paymentNote(escrow) {
  if (!escrow.network_raw || !escrow.asset || BigInt(escrow.network_raw) <= 0n) {
    return 'Send the exact amount in one transfer.';
  }
  return 'Send the exact amount in one transfer. The network fee is already included, so the coins can be sent out later.';
}

function paymentAmountLine(escrow) {
  const asset = getAsset(escrow.asset);
  const crypto = formatAmount(BigInt(escrow.deposit_raw), asset.decimals);
  const emoji = COIN_EMOJI[escrow.asset] || '';
  const usd = escrow.usd_raw == null ? '' : ` (${formatUsdFixed(depositUsdCents(escrow))} USD)`;
  return `${emoji} **${crypto}** ${asset.symbol}${usd}`.replace(/\s+/g, ' ').trim();
}

function paymentEmbeds(escrow) {
  const asset = getAsset(escrow.asset);
  const shown = paymentAmountLine(escrow);
  const summary = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('Deal Summary')
    .addFields(
      { name: 'Sender', value: person(escrow.sender_id), inline: true },
      { name: 'Receiver', value: person(escrow.receiver_id), inline: true },
      { name: 'Amount', value: shown, inline: false }
    )
    .setFooter({ text: `${ticketName(escrow.asset, escrow.id)} • ${escrow.deposit_address}` });
  const waiting = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('Waiting for payment')
    .setDescription(paymentNote(escrow))
    .setThumbnail(`attachment://escrow-${escrow.id}.png`)
    .addFields(
      { name: 'Amount:', value: shown },
      { name: 'Deposit Address:', value: `\`\`\`\n${escrow.deposit_address}\n\`\`\`` }
    );
  return [summary, waiting];
}

function networkFeeLine(escrow) {
  if (!escrow.network_raw || !escrow.asset || BigInt(escrow.network_raw) <= 0n) return '';
  const asset = getAsset(escrow.asset);
  return `The amount also includes **${formatAmount(BigInt(escrow.network_raw), asset.decimals)} ${asset.symbol}** for the network fee.`;
}

function releaseWarning(escrow) {
  const asset = getAsset(escrow.asset);
  const emoji = COIN_EMOJI[escrow.asset] || '';
  const coin = COIN_NAME[escrow.asset] || asset.label;
  const crypto = `${formatAmount(BigInt(escrow.payout_raw), asset.decimals)} ${asset.symbol}`;
  const usd = escrow.usd_raw == null ? '' : `\nDeal: **${formatUsdFixed(BigInt(escrow.usd_raw))}**`;
  const lines = [
    `You are about to send ${emoji} **${crypto}** (${coin}) to <@${escrow.receiver_id}>.${usd}`,
    '',
    `**Paid to:** <@${escrow.receiver_id}>`,
    '',
    'Press release only if the goods are already yours. If someone in this ticket is rushing you, or says they are staff and you must press the button, stop. Auto MM will never tell you to release.',
    '',
    'Once you release, the coins are sent. That cannot be undone.',
  ];
  if (Date.now() < Number(escrow.unlocks_at || 0)) {
    const unix = Math.ceil(Number(escrow.unlocks_at || Date.now()) / 1000);
    lines.push('', `You can use the buttons <t:${unix}:R>.`);
  }
  return lines.join('\n');
}

function feeConfirmText(escrow) {
  const who = escrow.fee_payer === 'split'
    ? 'You will split it.'
    : `<@${escrow.fee_payer === 'receiver' ? escrow.receiver_id : escrow.sender_id}> will pay it.`;
  const agreed = escrow.fee_ok_sender && escrow.fee_ok_receiver
    ? 'Both of you confirmed.'
    : 'Both of you need to press **Confirm**. Press **Change** if this is wrong.';
  const extra = networkFeeLine(escrow);
  const body = feeCents(escrow) === 0n
    ? `${feeIntro(escrow)}\n\n${agreed}`
    : `${feeIntro(escrow)}\n\n${who}\n\n${agreed}`;
  return extra ? `${body}\n\n${extra}` : body;
}

function amountConfirmText(escrow) {
  const senderOk = Boolean(escrow.amount_ok_sender);
  const receiverOk = Boolean(escrow.amount_ok_receiver);
  let progress = 'Neither of you has confirmed yet.';
  if (senderOk && receiverOk) {
    progress = `<@${escrow.sender_id}> and <@${escrow.receiver_id}> have both confirmed.`;
  } else if (senderOk) {
    progress = `<@${escrow.sender_id}> confirmed. Waiting for <@${escrow.receiver_id}>.`;
  } else if (receiverOk) {
    progress = `<@${escrow.receiver_id}> confirmed. Waiting for <@${escrow.sender_id}>.`;
  }
  return `# ${usdText(escrow)}\n\n${progress}`;
}

function rateLine(escrow) {
  if (escrow.price_raw == null || !escrow.asset) return null;
  const asset = getAsset(escrow.asset);
  return `1 ${asset.symbol} = $${formatAmount(BigInt(escrow.price_raw), 8)}`;
}

function instruction(escrow) {
  const asset = escrow.asset ? getAsset(escrow.asset) : null;
  const label = asset ? asset.label : 'the selected coin';
  if (escrow.status === 'AWAITING_PARTNER') {
    return `<@${escrow.creator_id}> Paste their Discord user ID in this chat.\n\nTo copy it: turn on Developer Mode, right-click their name, then choose **Copy User ID**.`;
  }
  if (escrow.status === 'ROLE_SELECTION') {
    if (escrow.sender_id || escrow.receiver_id) {
      return `**Sender:** ${person(escrow.sender_id)}\n**Receiver:** ${person(escrow.receiver_id)}`;
    }
    return '**Sender** — you pay the bot now.\n**Receiver** — you get paid after the sender confirms they received the goods.';
  }
  if (escrow.status === 'ROLE_CONFIRMATION') {
    return [
      `**Sender:** ${person(escrow.sender_id)} (${escrow.role_ok_sender ? 'Confirmed' : 'Waiting'})`,
      `**Receiver:** ${person(escrow.receiver_id)} (${escrow.role_ok_receiver ? 'Confirmed' : 'Waiting'})`,
      '',
      escrow.role_ok_sender && escrow.role_ok_receiver
        ? 'Both of you confirmed these roles.'
        : 'Both of you need to press **Confirm**. Press **Change** if a role is wrong.',
    ].join('\n');
  }
  if (escrow.status === 'AWAITING_AMOUNT') return 'Enter the deal amount in USD.';
  if (escrow.status === 'AMOUNT_CONFIRMATION') return amountConfirmText(escrow);
  if (escrow.status === 'FEE_SELECTION') {
    const free = feeCents(escrow) === 0n;
    return `${feeIntro(escrow)}${free ? ' Press any button to continue.' : ''}\n\n**Fees**\n${FEE_TIERS_TEXT}`;
  }
  if (escrow.status === 'FEE_CONFIRMATION') return feeConfirmText(escrow);
  if (escrow.status === 'AWAITING_DEPOSIT') {
    return [
      `Send exactly **${amount(escrow.deposit_raw, escrow.asset)}** to the address below.`,
      BigInt(escrow.fee_raw || 0) === 0n
        ? 'There is no fee for this deal.'
        : `That includes the ${feeUsdText(escrow)} fee (${amount(escrow.fee_raw, escrow.asset)}, paid by the ${feeLabel(escrow.fee_payer)}).`,
      `Deal: ${dealAmount(escrow)}`,
      ...(rateLine(escrow) ? [`Rate: ${rateLine(escrow)}`] : []),
      `Coin: ${label}`,
      '',
      `**Wallet address:** \`${escrow.deposit_address}\``,
      '',
      `Send it in one transfer. It counts after ${asset.confirmations} confirmations.`,
    ].join('\n');
  }
  if (escrow.status === 'CONFIRMING_DEPOSIT') {
    return `Do not hand over the goods yet. Wait until this payment is confirmed.\n\nConfirmations: **${escrow.deposit_confirmations}/${asset.confirmations}**\n\nTransaction: \`${escrow.deposit_tx}\``;
  }
  if (escrow.status === 'FUNDED') {
    return '**The payment is confirmed.** The receiver can hand over the goods now.\n\nWhen the sender has received them, only the sender can press **Release**. Press **Cancel** if you both want to undo the deal.';
  }
  if (escrow.status === 'RELEASE_CONFIRMATION') return releaseWarning(escrow);
  if (escrow.status === 'AWAITING_PAYOUT_ADDRESS') {
    return `<@${escrow.receiver_id}> Paste your **${label}** address in this chat. Double-check the network before you send it.`;
  }
  if (escrow.status === 'AWAITING_REFUND_ADDRESS') {
    return `<@${escrow.sender_id}> Paste your **${label}** refund address in this chat. Double-check the network before you send it.`;
  }
  if (escrow.status === 'PAYOUT_CONFIRM' || escrow.status === 'REFUND_CONFIRM') {
    const who = escrow.status === 'REFUND_CONFIRM' ? 'sender' : 'receiver';
    return `Send **${amount(escrow.payout_raw, escrow.asset)}** to this ${who} address?\n\n\`${escrow.payout_address}\`\n\nConfirm only if this is the wallet that should receive the coins.`;
  }
  if (escrow.status === 'CANCEL_REQUEST') {
    return `<@${escrow.receiver_id}> The sender wants to cancel this deal. Confirm only if you agree.`;
  }
  if (escrow.status === 'BROADCASTING') return 'The coins are being sent. Do not press the buttons again.';
  if (escrow.status === 'SETTLEMENT_REVIEW') {
    return 'The send was interrupted, so nothing was marked complete. Press **Retry** when you want the bot to check the chain and try again. It only sends if the coins are still here.';
  }
  if (escrow.status === 'COMPLETED') return `The payout is complete.\n\nTransaction: \`${escrow.payout_tx}\``;
  if (escrow.status === 'REFUNDED') return `The deal was cancelled and the refund was sent.\n\nTransaction: \`${escrow.payout_tx}\``;
  if (escrow.status === 'CLOSED') return 'This ticket was closed before a payment address was created.';
  return 'Escrow update.';
}

function color(status) {
  if (status === 'COMPLETED' || status === 'FUNDED' || status === 'REFUNDED') return 0x2ea043;
  if (status === 'CLOSED' || status === 'SETTLEMENT_REVIEW') return 0xda3633;
  if (status === 'CONFIRMING_DEPOSIT' || status === 'BROADCASTING') return 0xd4a017;
  return 0x7c3aed;
}

function embed(escrow) {
  if (escrow.status === 'AWAITING_PARTNER') {
    return new EmbedBuilder()
      .setColor(0x2b6cff)
      .setTitle('Who are you dealing with?')
      .setDescription(instruction(escrow));
  }
  if (escrow.status === 'ROLE_SELECTION') {
    return new EmbedBuilder()
      .setColor(0x2b6cff)
      .setTitle('Choose your role')
      .setDescription(instruction(escrow));
  }
  if (escrow.status === 'ROLE_CONFIRMATION') {
    return new EmbedBuilder()
      .setColor(0x2b6cff)
      .setTitle('Confirm the roles')
      .setDescription(instruction(escrow));
  }
  if (escrow.status === 'AWAITING_AMOUNT') {
    return new EmbedBuilder()
      .setColor(0x2b6cff)
      .setTitle('Enter the deal amount in USD');
  }
  if (escrow.status === 'AMOUNT_CONFIRMATION') {
    return new EmbedBuilder()
      .setColor(0x2b6cff)
      .setTitle('Confirm the deal amount')
      .setDescription(amountConfirmText(escrow));
  }
  if (escrow.status === 'FEE_SELECTION') {
    return new EmbedBuilder()
      .setColor(0x2b6cff)
      .setTitle('Who pays the fee?')
      .setDescription(instruction(escrow));
  }
  if (escrow.status === 'FEE_CONFIRMATION') {
    return new EmbedBuilder()
      .setColor(0x2b6cff)
      .setTitle('Confirm the fee')
      .setDescription(feeConfirmText(escrow));
  }
  if (escrow.status === 'CONFIRMING_DEPOSIT') {
    return new EmbedBuilder()
      .setColor(0xd4a017)
      .setTitle('Transaction detected')
      .setDescription(instruction(escrow));
  }
  if (escrow.status === 'RELEASE_CONFIRMATION') {
    return new EmbedBuilder()
      .setColor(0xda3633)
      .setTitle('Before you release')
      .setDescription(instruction(escrow));
  }
  if (escrow.status === 'DEAL_CANCEL') {
    const other = escrow.settlement === escrow.sender_id ? escrow.receiver_id : escrow.sender_id;
    return new EmbedBuilder()
      .setColor(0xda3633)
      .setTitle('Cancel this deal?')
      .setDescription(`<@${other}>, confirm that you want to cancel.\n\nOnly do this if no crypto has been sent.`);
  }
  if (escrow.status === 'WRONG_AMOUNT') {
    return new EmbedBuilder()
      .setColor(0xda3633)
      .setTitle('Wrong amount received')
      .setDescription(`Received: ${amount(escrow.received_raw, escrow.asset)}\nExpected: ${amount(escrow.deposit_raw, escrow.asset)}\n\nDo you still want to continue with the amount that arrived?`);
  }
  if (escrow.status === 'WRONG_CONTINUE' || escrow.status === 'WRONG_CANCEL') {
    const verb = escrow.status === 'WRONG_CONTINUE' ? 'continue' : 'cancel';
    return new EmbedBuilder()
      .setColor(escrow.status === 'WRONG_CONTINUE' ? 0x7c3aed : 0xda3633)
      .setTitle(escrow.status === 'WRONG_CONTINUE' ? 'Continue this deal?' : 'Cancel this deal?')
      .setDescription(`<@${escrow.settlement}> chose to ${verb}. Do you want to ${verb} too?`);
  }
  if (escrow.status === 'AWAITING_REFUND_ADDRESS' || escrow.status === 'AWAITING_PAYOUT_ADDRESS') {
    const asset = getAsset(escrow.asset);
    const refund = escrow.status === 'AWAITING_REFUND_ADDRESS';
    const who = refund ? escrow.sender_id : escrow.receiver_id;
    return new EmbedBuilder()
      .setColor(0x2ea043)
      .setTitle(refund ? 'Refund address' : 'Payout address')
      .setDescription(`<@${who}> Paste your **${asset.label}** address in this chat. Double-check the network before you send it.`);
  }
  if (escrow.status === 'REFUND_CONFIRM' || escrow.status === 'PAYOUT_CONFIRM') {
    const refund = escrow.status === 'REFUND_CONFIRM';
    return new EmbedBuilder()
      .setColor(0x2ea043)
      .setTitle(refund ? 'Confirm the refund address' : 'Confirm the payout address')
      .setDescription(`Send **${amount(escrow.payout_raw, escrow.asset)}** to:\n\n\`${escrow.payout_address}\`\n\nConfirm only if this is the right wallet.`);
  }
  const asset = escrow.asset ? getAsset(escrow.asset) : null;
  const fields = [
    { name: 'Escrow ID', value: String(escrow.id), inline: true },
    { name: 'Sender', value: person(escrow.sender_id), inline: true },
    { name: 'Receiver', value: person(escrow.receiver_id), inline: true },
    { name: 'Coin', value: asset ? asset.label : 'Not selected', inline: true },
    { name: 'Amount', value: dealAmount(escrow), inline: true },
    { name: 'Fee', value: feeField(escrow), inline: true },
    { name: 'Status', value: STATUS[escrow.status] || escrow.status, inline: false },
  ];
  const rate = rateLine(escrow);
  if (rate) fields.push({ name: 'Rate', value: rate, inline: true });
  if (escrow.deposit_tx) fields.push({ name: 'Deposit transaction', value: `\`${escrow.deposit_tx}\``, inline: false });
  if (escrow.payout_tx) fields.push({ name: 'Payout transaction', value: `\`${escrow.payout_tx}\``, inline: false });
  return new EmbedBuilder()
    .setColor(color(escrow.status))
    .setTitle(ticketName(escrow.asset, escrow.id))
    .setDescription(instruction(escrow))
    .addFields(fields)
    .setTimestamp(escrow.updated_at ? Number(escrow.updated_at) : Date.now());
}

function components(escrow) {
  const id = escrow.id;
  if (escrow.status === 'AWAITING_PARTNER') return [];
  if (escrow.status === 'AWAITING_AMOUNT') {
    return [row(button(`e:${id}:amt`, 'Enter amount', ButtonStyle.Primary))];
  }
  if (escrow.status === 'ROLE_SELECTION') {
    return [
      row(
        button(`e:${id}:role:s`, 'Sender', ButtonStyle.Primary, Boolean(escrow.sender_id)),
        button(`e:${id}:role:r`, 'Receiver', ButtonStyle.Primary, Boolean(escrow.receiver_id))
      ),
    ];
  }
  if (escrow.status === 'ROLE_CONFIRMATION') {
    return [
      row(
        button(`e:${id}:roles:ok`, 'Confirm', ButtonStyle.Success),
        button(`e:${id}:roles:no`, 'Change', ButtonStyle.Secondary)
      ),
    ];
  }
  if (escrow.status === 'AMOUNT_CONFIRMATION') {
    return [
      row(
        button(`e:${id}:amt:ok`, 'Confirm', ButtonStyle.Success),
        button(`e:${id}:amt:no`, 'Change', ButtonStyle.Secondary)
      ),
    ];
  }
  if (escrow.status === 'FEE_SELECTION') {
    return [
      row(
        button(`e:${id}:fee:s`, 'Sender', ButtonStyle.Primary),
        button(`e:${id}:fee:r`, 'Receiver', ButtonStyle.Primary),
        button(`e:${id}:fee:split`, 'Split', ButtonStyle.Primary)
      ),
    ];
  }
  if (escrow.status === 'FEE_CONFIRMATION') {
    return [row(
      button(`e:${id}:fee:ok`, 'Confirm', ButtonStyle.Success),
      button(`e:${id}:fee:no`, 'Change', ButtonStyle.Secondary)
    )];
  }
  if (escrow.status === 'AWAITING_DEPOSIT') {
    return [row(button(`e:${id}:copy`, 'Copy Details', ButtonStyle.Secondary))];
  }
  if (escrow.status === 'WRONG_AMOUNT') {
    return [row(
      button(`e:${id}:wrong:go`, 'Continue', ButtonStyle.Success),
      button(`e:${id}:wrong:stop`, 'Cancel', ButtonStyle.Danger)
    )];
  }
  if (escrow.status === 'WRONG_CONTINUE' || escrow.status === 'WRONG_CANCEL') {
    return [row(
      button(`e:${id}:wrong:yes`, 'Confirm', ButtonStyle.Success),
      button(`e:${id}:wrong:back`, 'Cancel', ButtonStyle.Danger)
    )];
  }
  if (escrow.status === 'DEAL_CANCEL') {
    return [row(
      button(`e:${id}:deal:ok`, 'Confirm', ButtonStyle.Danger),
      button(`e:${id}:deal:back`, 'Return', ButtonStyle.Secondary)
    )];
  }
  if (escrow.status === 'FUNDED') {
    return [row(
      button(`e:${id}:go:release`, 'Release', ButtonStyle.Success),
      button(`e:${id}:go:cancel`, 'Cancel', ButtonStyle.Danger)
    )];
  }
  if (escrow.status === 'RELEASE_CONFIRMATION') {
    const locked = Date.now() < Number(escrow.unlocks_at || 0);
    return [row(
      button(`e:${id}:rel:ok`, 'Release', ButtonStyle.Success, locked),
      button(`e:${id}:rel:back`, 'Go back', ButtonStyle.Secondary, locked)
    )];
  }
  if (escrow.status === 'CANCEL_REQUEST') {
    return [row(
      button(`e:${id}:can:ok`, 'Confirm', ButtonStyle.Danger),
      button(`e:${id}:can:back`, 'Return', ButtonStyle.Secondary)
    )];
  }
  if (escrow.status === 'AWAITING_PAYOUT_ADDRESS' || escrow.status === 'AWAITING_REFUND_ADDRESS') return [];
  if (escrow.status === 'PAYOUT_CONFIRM' || escrow.status === 'REFUND_CONFIRM') {
    return [row(
      button(`e:${id}:addr:ok`, 'Confirm', ButtonStyle.Success),
      button(`e:${id}:addr:no`, 'Change', ButtonStyle.Secondary)
    )];
  }
  if (escrow.status === 'SETTLEMENT_REVIEW') {
    return [row(button(`e:${id}:retry`, 'Retry', ButtonStyle.Danger))];
  }
  if (escrow.status === 'COMPLETED' || escrow.status === 'REFUNDED') {
    return [row(button(`e:${id}:close`, 'Close', ButtonStyle.Secondary))];
  }
  return [];
}

const COINS = [
  ['BTC', 'Bitcoin'],
  ['ETH', 'Ethereum'],
  ['LTC', 'Litecoin'],
  ['SOL', 'Solana'],
];

const ROW_GAP = '\u2800'.repeat(22);

function coinRow(key, name) {
  return new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${COIN_EMOJI[key] || ''} **${name}**${ROW_GAP}`))
    .setButtonAccessory(
      new ButtonBuilder().setCustomId(`panel:${key}`).setLabel('Start').setStyle(ButtonStyle.Secondary)
    );
}

function panelContainer() {
  const container = new ContainerBuilder()
    .setAccentColor(0x7c3aed)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '### Crypto Auto MM\n**Coins**'
    ));
  for (const [key, name] of COINS) container.addSectionComponents(coinRow(key, name));
  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('**Stablecoins**'));
  const stables = [
    ['USDT-ERC20', 'Ethereum · USDT'],
    ['USDT-BEP20', 'BNB Chain · USDT'],
    ['USDT-SOL', 'Solana · USDT'],
    ['USDC-ERC20', 'Ethereum · USDC'],
    ['USDC-BEP20', 'BNB Chain · USDC'],
    ['USDC-SOL', 'Solana · USDC'],
  ];
  for (const [key, name] of stables) container.addSectionComponents(coinRow(key, name));
  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Fees**\n${FEE_TIERS_TEXT}`));
  return container;
}

function panelMessage(ephemeral = false) {
  return {
    components: [panelContainer()],
    flags: ephemeral ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral : MessageFlags.IsComponentsV2,
  };
}

function coinMenu(draftId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`draft:${draftId}:asset`)
      .setPlaceholder('Select the cryptocurrency')
      .addOptions(ASSET_LIST.map((asset) => ({ label: asset.label, value: asset.key })))
  );
}

async function stage(escrow) {
  const payload = { embeds: [embed(escrow)], components: components(escrow) };
  let ping = null;
  if (escrow.status === 'ROLE_SELECTION') ping = `<@${escrow.creator_id}> <@${escrow.partner_id}> Choose your roles.`;
  if (escrow.status === 'ROLE_CONFIRMATION') ping = `<@${escrow.sender_id}> <@${escrow.receiver_id}> Confirm your roles.`;
  if (escrow.status === 'AWAITING_AMOUNT') ping = `<@${escrow.sender_id}>`;
  if (escrow.status === 'AMOUNT_CONFIRMATION') ping = `<@${escrow.sender_id}> <@${escrow.receiver_id}>`;
  if (escrow.status === 'FEE_SELECTION' || escrow.status === 'FEE_CONFIRMATION') {
    ping = `<@${escrow.sender_id}> <@${escrow.receiver_id}>`;
  }
  if (escrow.status === 'AWAITING_DEPOSIT') ping = `<@${escrow.sender_id}> <@${escrow.receiver_id}>`;
  if (escrow.status === 'CONFIRMING_DEPOSIT') ping = `<@${escrow.sender_id}> <@${escrow.receiver_id}>`;
  if (escrow.status === 'DEAL_CANCEL') {
    const other = escrow.settlement === escrow.sender_id ? escrow.receiver_id : escrow.sender_id;
    ping = `<@${other}>`;
  }
  if (escrow.status === 'WRONG_CONTINUE' || escrow.status === 'WRONG_CANCEL') {
    const other = escrow.settlement === escrow.sender_id ? escrow.receiver_id : escrow.sender_id;
    ping = `<@${other}>`;
  }
  if (escrow.status === 'AWAITING_PAYOUT_ADDRESS') ping = `<@${escrow.receiver_id}> Send your payout address.`;
  if (escrow.status === 'AWAITING_REFUND_ADDRESS') ping = `<@${escrow.sender_id}> Send your refund address.`;
  if (escrow.status === 'CANCEL_REQUEST') ping = `<@${escrow.receiver_id}> The sender wants to cancel.`;
  if (escrow.status === 'FUNDED') ping = `<@${escrow.sender_id}> <@${escrow.receiver_id}> The payment is confirmed.`;
  if (escrow.status === 'COMPLETED') ping = `<@${escrow.receiver_id}> The payout is complete.`;
  if (escrow.status === 'REFUNDED') ping = `<@${escrow.sender_id}> The refund is complete.`;
  if (escrow.status === 'AWAITING_DEPOSIT' && escrow.deposit_address) {
    payload.embeds = paymentEmbeds(escrow);
    const png = await QRCode.toBuffer(escrow.deposit_address, { width: 320, margin: 1 });
    payload.files = [new AttachmentBuilder(png, { name: `escrow-${escrow.id}.png` })];
  }
  return { payload, ping };
}

function idleCancelMessage(escrow) {
  return {
    content: `<@${escrow.sender_id}> <@${escrow.receiver_id}>\nNo payment has shown up for 20 minutes. Do you want to cancel this deal?`,
    components: [row(
      button(`e:${escrow.id}:deal:rescan`, 'Rescan', ButtonStyle.Primary),
      button(`e:${escrow.id}:deal:cancel`, 'Cancel', ButtonStyle.Danger)
    )],
  };
}

function welcomeMessage(escrow) {
  const asset = getAsset(escrow.asset);
  const emoji = COIN_EMOJI[escrow.asset] || '';
  const coin = COIN_NAME[escrow.asset] || asset.label;
  const shown = `${emoji} ${coin}`.trim();
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x7c3aed)
        .setTitle('Auto MM')
        .setDescription([
          `<@${escrow.creator_id}> This ticket is where the deal happens. Auto MM holds the coins until the sender releases them.`,
          '',
          '**Auto MM will not DM you.** Keep every message about this deal in this ticket. A private message about it is a scam.',
          '',
          `**Coin:** ${shown}`,
        ].join('\n')),
    ],
    components: [row(button(`e:${escrow.id}:close`, 'Close ticket', ButtonStyle.Danger))],
  };
}

function formatUsdCommas(cents) {
  const negative = cents < 0n;
  const value = negative ? -cents : cents;
  const whole = (value / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (value % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}$${whole}.${fraction}`;
}

function leaderboardMessage(entries) {
  const embed = new EmbedBuilder().setColor(0x7c3aed).setTitle('Leaderboard');
  if (!entries.length) {
    embed.setDescription('No completed deals yet.');
    return { embeds: [embed] };
  }
  const medals = ['🥇', '🥈', '🥉'];
  const lines = entries.map((entry, index) => {
    const person = `<@${entry.id}>`;
    const money = formatUsdCommas(entry.cents);
    const deals = `${entry.completed} completed`;
    if (index < 3) return `${medals[index]} ${person}\n${money} · ${deals}`;
    return `**${index + 1}.** ${person} — ${money} · ${deals}`;
  });
  const top = lines.slice(0, 3).join('\n\n');
  const rest = lines.slice(3).join('\n');
  embed.setDescription(rest ? `${top}\n\n${rest}` : top);
  return { embeds: [embed] };
}

function ranksMessage(ranks) {
  const lines = ranks.map((rank) => {
    if (rank.cents == null) return `<@&${rank.roleId}> — any finished deal`;
    const whole = (rank.cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `<@&${rank.roleId}> — $${whole}+`;
  });
  return {
    embeds: [new EmbedBuilder().setColor(0x7c3aed).setTitle('Ranks').setDescription(lines.join('\n'))],
  };
}

function statsMessage(userId, avatarUrl, stats, roleName, next, color) {
  const who = roleName ? `<@${userId}> - ${roleName}` : `<@${userId}>`;
  const lines = [`## ${who}`];
  if (stats.rank) {
    let rank = `Global rank #${stats.rank}`;
    if (next) rank += ` | ${formatUsdCommas(next.left)} left until <@&${next.roleId}>`;
    lines.push(rank, '');
  } else lines.push('');
  lines.push(
    '### Deal Stats',
    `• **Completed:** ${stats.completed}`,
    `• **Total Dealt:** ${formatUsdCommas(stats.cents)}`,
    `• **Biggest Deal:** ${formatUsdCommas(stats.biggest || 0n)}`
  );
  const embed = new EmbedBuilder()
    .setColor(color ?? 0x99aab5)
    .setDescription(lines.join('\n'));
  if (avatarUrl) embed.setThumbnail(avatarUrl);
  return { embeds: [embed] };
}

function messageFrom(view, extra) {
  const content = [extra, view.ping].filter(Boolean).join('\n');
  return content ? { ...view.payload, content } : view.payload;
}

const DEAL_TITLE = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  LTC: 'Litecoin',
  SOL: 'Solana',
  'USDT-ERC20': 'USDT [ERC-20]',
  'USDC-ERC20': 'USDC [ERC-20]',
  'USDT-BEP20': 'USDT [BEP-20]',
  'USDC-BEP20': 'USDC [BEP-20]',
  'USDT-SOL': 'USDT [SPL]',
  'USDC-SOL': 'USDC [SPL]',
};

const DEAL_COLOR = {
  BTC: 0xf8931a,
  ETH: 0x627eeb,
  LTC: 0x3c5a9b,
  SOL: 0x7b63e8,
  'USDT-ERC20': 0x4faf95,
  'USDT-BEP20': 0x4faf95,
  'USDT-SOL': 0x4faf95,
  'USDC-ERC20': 0x2875ca,
  'USDC-BEP20': 0x2875ca,
  'USDC-SOL': 0x2875ca,
};

function emojiImage(assetKey) {
  const id = (COIN_EMOJI[assetKey] || '').match(/(\d+)>$/);
  return id ? `https://cdn.discordapp.com/emojis/${id[1]}.png?size=128` : null;
}

function payoutUsdCents(escrow) {
  if (escrow.payout_raw != null && escrow.price_raw != null && escrow.asset) {
    const asset = getAsset(escrow.asset);
    const scale = 10n ** BigInt(asset.decimals);
    return (BigInt(escrow.payout_raw) * BigInt(escrow.price_raw)) / (scale * 1000000n);
  }
  if (escrow.usd_raw == null) return null;
  return BigInt(escrow.usd_raw);
}

function explorerFor(assetKey, txid) {
  const asset = getAsset(assetKey);
  if (asset.family === 'sol') return { name: 'Solscan', url: `https://solscan.io/tx/${txid}` };
  if (asset.chain === 'bsc') return { name: 'BscScan', url: `https://bscscan.com/tx/${txid}` };
  if (asset.family === 'evm') return { name: 'Etherscan', url: `https://etherscan.io/tx/${txid}` };
  if (asset.family === 'btc') return { name: 'Mempool', url: `https://mempool.space/tx/${txid}` };
  return { name: 'Litecoin Space', url: `https://litecoinspace.org/tx/${txid}` };
}

function shortTx(txid) {
  const text = String(txid || '');
  if (text.length <= 16) return text;
  return `${text.slice(0, 6)}...${text.slice(-8)}`;
}

function dealCompleteMessage(escrow) {
  const asset = getAsset(escrow.asset);
  const title = DEAL_TITLE[escrow.asset] || asset.label;
  const crypto = formatAmount(BigInt(escrow.payout_raw), asset.decimals);
  const cents = payoutUsdCents(escrow);
  const shown = cents == null
    ? `\`${crypto}\` ${asset.symbol}`
    : `\`${crypto}\` ${asset.symbol} (${formatUsdFixed(cents)} USD)`;
  const link = explorerFor(escrow.asset, escrow.payout_tx);
  const embed = new EmbedBuilder()
    .setColor(DEAL_COLOR[escrow.asset] || 0x3ddc6e)
    .setTitle(`${title} Deal Complete`)
    .addFields(
      { name: 'Amount', value: shown },
      { name: 'Sender', value: '`Anonymous`', inline: true },
      { name: 'Receiver', value: '`Anonymous`', inline: true },
      { name: 'Transaction', value: `${shortTx(escrow.payout_tx)} ([View Transaction](${link.url}))` }
    );
  const image = emojiImage(escrow.asset);
  if (image) embed.setThumbnail(image);
  return {
    embeds: [embed],
    components: [row(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(`View on ${link.name}`).setURL(link.url))],
  };
}

module.exports = { coinMenu, stage, embed, panelMessage, messageFrom, idleCancelMessage, welcomeMessage, dealCompleteMessage, statsMessage, leaderboardMessage, ranksMessage };
