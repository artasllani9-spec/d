const { Client, Events, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const config = require('./config');
const db = require('./db');
const { ASSET_LIST } = require('./assets');
const { readTokenDecimals } = require('./chain');
const wallet = require('./wallet');
const bot = require('./bot');
const watcher = require('./watcher');
const { resumeBroadcasts } = require('./settle');
const ranks = require('./ranks');

wallet.load();
db.open(config.dbPath);
db.run('DELETE FROM escrows WHERE channel_id IS NULL');

const commands = [
  new SlashCommandBuilder().setName('escrow').setDescription('Open a private escrow ticket'),
  new SlashCommandBuilder()
    .setName('escrow-panel')
    .setDescription('Post the escrow panel in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show completed deal stats')
    .addUserOption((option) => option.setName('user').setDescription('The person to look up')),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Show the top 10 clients'),
  new SlashCommandBuilder().setName('ranks').setDescription('Show the client ranks'),
  new SlashCommandBuilder()
    .setName('addstats')
    .setDescription('Add deal volume for a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) => option.setName('user').setDescription('The person to credit').setRequired(true))
    .addStringOption((option) => option.setName('amount').setDescription('USD amount to add, such as 1000 or 250.50').setRequired(true)),
  new SlashCommandBuilder()
    .setName('removestats')
    .setDescription('Remove deal volume from a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) => option.setName('user').setDescription('The person to update').setRequired(true))
    .addStringOption((option) => option.setName('amount').setDescription('USD amount to remove, such as 1000 or 250.50').setRequired(true)),
].map((command) => command.toJSON());

function bind(client) {
  bot.start(client);
  client.once(Events.ClientReady, async (ready) => {
    console.log(`Logged in as ${ready.user.tag}`);
    const permissions = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ManageRoles,
    ].reduce((sum, bit) => sum | bit, 0n);
    console.log(`Invite: https://discord.com/oauth2/authorize?client_id=${config.clientId}&permissions=${permissions}&scope=bot%20applications.commands`);
    for (const guild of ready.guilds.cache.values()) {
      await guild.commands.set(commands).catch((error) => {
        console.error(`Could not register commands in ${guild.name}: ${error.message}`);
      });
    }
    await bot.renameTickets(ready);
    bot.resumeUnlocks(ready);
    resumeBroadcasts(ready);
    watcher.start(ready);
    ranks.sync(ready).catch((error) => console.error('[ranks]', error.message));
    verifyDecimals().catch((error) => console.error('[decimals]', error.message));
  });
  client.on(Events.GuildCreate, (guild) => {
    guild.commands.set(commands).catch((error) => {
      console.error(`Could not register commands in ${guild.name}: ${error.message}`);
    });
  });
  return client;
}

function login(withMessageContent) {
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
  if (withMessageContent) intents.push(GatewayIntentBits.MessageContent);
  const client = bind(new Client({ intents }));
  return client.login(config.token).catch((error) => {
    client.destroy();
    const denied = String(error.message).toLowerCase().includes('disallowed intent');
    if (withMessageContent && denied) {
      console.log('Message Content Intent is off, so addresses are entered with the button. You can enable that intent later if you also want people to paste addresses in chat.');
      return login(false);
    }
    console.error(error.message);
    process.exit(1);
  });
}

login(true);

async function verifyDecimals() {
  for (const asset of ASSET_LIST) {
    if (asset.kind !== 'evm-token' && asset.kind !== 'spl') continue;
    try {
      const decimals = await readTokenDecimals(asset);
      if (decimals !== asset.decimals) {
        console.error(`${asset.label} uses ${decimals} decimals on-chain, but the bot expects ${asset.decimals}.`);
      }
    } catch (error) {
      console.error(`Could not verify ${asset.label}: ${error.message}`);
    }
  }
}
