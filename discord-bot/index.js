require('dotenv').config();

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  Client,
  Events,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
} = require('discord.js');

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID; // optional: faster guild-only command updates
const editorRoleId = process.env.DISCORD_EDITOR_ROLE_ID || null;

if (!token || token === 'your_bot_token_here') {
  console.error('Missing DISCORD_BOT_TOKEN in discord-bot/.env');
  process.exit(1);
}

if (!clientId) {
  console.error('Missing DISCORD_CLIENT_ID in discord-bot/.env (Application ID from Developer Portal)');
  process.exit(1);
}

const EMOJI = {
  fly: '<:flyable:1547717549909606461>',
  ride: '<:Rideable:1547717675483136061>',
  neon: '<:Neon:1547718124852482153>',
  mega: '<:mega:1547718023018848367>',
};

const siteUrl = (process.env.SITE_URL || 'https://d-seven-chi.vercel.app').replace(/\/$/, '');
const valuesEditToken = process.env.VALUES_EDIT_TOKEN || process.env.DISCORD_VALUES_TOKEN || '';
const OVERRIDES_PATH = path.join(__dirname, 'value-overrides.json');
const SITE_OVERRIDES_PATH = path.join(__dirname, '..', 'data', 'value-overrides.json');
const VALUE_UPDATE_CHANNEL_ID =
  process.env.DISCORD_VALUE_UPDATE_CHANNEL_ID || '1547718282428027011';

function loadAmvggValues() {
  const filePath = path.join(__dirname, '..', 'public', 'amvgg-usd-values.js');
  const code = fs.readFileSync(filePath, 'utf8');
  const context = {
    console,
    Math,
    Number,
    Object,
    Array,
    String,
    Boolean,
    JSON,
    parseInt,
    parseFloat,
    isNaN,
    Infinity,
    undefined,
  };
  vm.createContext(context);
  // const/let are not visible on the vm context object — export them explicitly
  vm.runInContext(
    `${code}\n;globalThis.__AMVGG = { AMVGG_PET_PRICING, AMVGG_USD_VALUES, getAmvggUsdValue, formatUsdValue };`,
    context
  );
  return context.__AMVGG;
}

function loadItemImages() {
  const filePath = path.join(__dirname, '..', 'public', 'pets-data.js');
  const code = fs.readFileSync(filePath, 'utf8');
  const context = {
    console,
    Math,
    Number,
    Object,
    Array,
    String,
    Boolean,
    JSON,
    parseInt,
    parseFloat,
    isNaN,
    Infinity,
    undefined,
    Set,
    Map,
  };
  vm.createContext(context);
  vm.runInContext(
    `${code}
;globalThis.__ITEM_LISTS = [
  ...(typeof pets !== 'undefined' ? pets : []),
  ...(typeof petWear !== 'undefined' ? petWear : []),
  ...(typeof strollers !== 'undefined' ? strollers : []),
  ...(typeof food !== 'undefined' ? food : []),
  ...(typeof vehicles !== 'undefined' ? vehicles : []),
  ...(typeof toys !== 'undefined' ? toys : []),
  ...(typeof gifts !== 'undefined' ? gifts : []),
  ...(typeof stickers !== 'undefined' ? stickers : []),
  ...(typeof houses !== 'undefined' ? houses : []),
  ...(typeof signs !== 'undefined' ? signs : []),
];`,
    context
  );

  const images = new Map();
  for (const item of context.__ITEM_LISTS || []) {
    if (!item || !item.name || !item.image) continue;
    images.set(item.name, item.image);
  }
  return images;
}

function toAbsoluteImageUrl(imagePath) {
  if (!imagePath) return null;
  if (/^https?:\/\//i.test(imagePath)) return imagePath;
  const cleaned = String(imagePath).replace(/^\.\//, '').replace(/^\//, '');
  return `${siteUrl}/${cleaned}`;
}

function loadOverrides() {
  try {
    if (!fs.existsSync(OVERRIDES_PATH)) {
      return { pets: {}, items: {} };
    }
    const raw = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'));
    return {
      pets: raw.pets && typeof raw.pets === 'object' ? raw.pets : {},
      items: raw.items && typeof raw.items === 'object' ? raw.items : {},
      updatedAt: raw.updatedAt != null ? raw.updatedAt : null,
    };
  } catch (err) {
    console.error('Failed to load value-overrides.json:', err.message);
    return { pets: {}, items: {} };
  }
}

function saveOverridesLocal() {
  const payload = {
    pets: overrides.pets,
    items: overrides.items,
    updatedAt: Date.now(),
  };
  const text = JSON.stringify(payload, null, 2) + '\n';
  fs.writeFileSync(OVERRIDES_PATH, text, 'utf8');
  try {
    fs.mkdirSync(path.dirname(SITE_OVERRIDES_PATH), { recursive: true });
    fs.writeFileSync(SITE_OVERRIDES_PATH, text, 'utf8');
  } catch (err) {
    console.warn('Could not write site data/value-overrides.json:', err.message);
  }
}

async function syncOverridesToSite() {
  if (!valuesEditToken) {
    console.warn(
      'VALUES_EDIT_TOKEN is not set — overrides saved locally only. Set it in discord-bot/.env and on Vercel to sync the live site.'
    );
    return false;
  }

  const response = await fetch(`${siteUrl}/api/values/overrides`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-values-token': valuesEditToken,
    },
    body: JSON.stringify({
      pets: overrides.pets,
      items: overrides.items,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Site sync failed (${response.status}): ${text || response.statusText}`);
  }
  return true;
}

async function saveOverrides() {
  saveOverridesLocal();
  try {
    await syncOverridesToSite();
  } catch (err) {
    console.error(err.message);
  }
}

const values = loadAmvggValues();
const ITEM_IMAGES = loadItemImages();
let overrides = loadOverrides();
const PET_NAMES = Object.keys(values.AMVGG_PET_PRICING || {});
const OTHER_ITEM_NAMES = Object.keys(values.AMVGG_USD_VALUES || {}).filter(
  (name) => !Object.prototype.hasOwnProperty.call(values.AMVGG_PET_PRICING, name)
);

function normalizeItemKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function getItemImage(name) {
  const mapped = ITEM_IMAGES.get(name);
  if (mapped) return toAbsoluteImageUrl(mapped);
  if (name === 'Tio De Nadal') {
    return 'https://fetch-images.b-cdn.net/images/pets/Ti%C3%B3%20De%20Nadal.png';
  }
  return `https://fetch-images.b-cdn.net/images/pets/${encodeURIComponent(name)}.png`;
}

function formatUsd(amount) {
  if (typeof values.formatUsdValue === 'function') {
    return values.formatUsdValue(amount);
  }
  if (amount == null || !Number.isFinite(amount)) return '—';
  if (Number.isInteger(amount)) return '$' + amount.toLocaleString('en-US');
  return '$' + amount.toFixed(1);
}

function matchNameInList(queryKey, names) {
  const exact = names.find((name) => normalizeItemKey(name) === queryKey);
  if (exact) return exact;

  const startsWith = names.filter((name) => normalizeItemKey(name).startsWith(queryKey));
  if (startsWith.length === 1) return startsWith[0];
  if (startsWith.length > 1) {
    return startsWith.sort((a, b) => a.length - b.length)[0];
  }

  const includes = names.filter((name) => normalizeItemKey(name).includes(queryKey));
  if (includes.length === 1) return includes[0];
  if (includes.length > 1) {
    return includes.sort((a, b) => a.length - b.length)[0];
  }

  return null;
}

function resolveItemName(query) {
  const q = normalizeItemKey(query);
  if (!q) return null;
  return matchNameInList(q, PET_NAMES) || matchNameInList(q, OTHER_ITEM_NAMES);
}

function resolvePetOnly(query) {
  const q = normalizeItemKey(query);
  if (!q) return null;
  return matchNameInList(q, PET_NAMES);
}

function resolveNonPetItem(query) {
  const q = normalizeItemKey(query);
  if (!q) return null;
  return matchNameInList(q, OTHER_ITEM_NAMES);
}

function isPet(name) {
  return Object.prototype.hasOwnProperty.call(values.AMVGG_PET_PRICING || {}, name);
}

function petUsd(name, potions) {
  const override = overrides.pets[name];
  if (override) {
    if (potions?.mega) return override.mfr;
    if (potions?.neon) return override.nfr;
    return override.fr;
  }
  return values.getAmvggUsdValue(name, potions);
}

function itemUsd(name) {
  if (Object.prototype.hasOwnProperty.call(overrides.items, name)) {
    return overrides.items[name];
  }
  return values.getAmvggUsdValue(name);
}

function canEditValues(interaction) {
  if (editorRoleId) {
    const roles = interaction.member?.roles;
    if (typeof roles?.cache?.has === 'function') {
      return roles.cache.has(editorRoleId);
    }
    if (Array.isArray(roles)) {
      return roles.includes(editorRoleId);
    }
    return false;
  }
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

function buildValueEmbed(itemName) {
  if (isPet(itemName)) {
    const fr = petUsd(itemName, { fly: true, ride: true, neon: false, mega: false });
    const nfr = petUsd(itemName, { fly: true, ride: true, neon: true, mega: false });
    const mfr = petUsd(itemName, { fly: true, ride: true, neon: false, mega: true });

    const description = [
      '**USD Value:**',
      `${EMOJI.fly}${EMOJI.ride} → **${formatUsd(fr)}**`,
      `${EMOJI.neon}${EMOJI.fly}${EMOJI.ride} → **${formatUsd(nfr)}**`,
      `${EMOJI.mega}${EMOJI.fly}${EMOJI.ride} → **${formatUsd(mfr)}**`,
    ].join('\n');

    return new EmbedBuilder()
      .setColor(0x1e64c8)
      .setTitle(itemName)
      .setDescription(description)
      .setThumbnail(getItemImage(itemName))
      .setFooter({ text: 'valuedex' });
  }

  const usd = itemUsd(itemName);
  return new EmbedBuilder()
    .setColor(0x1e64c8)
    .setTitle(itemName)
    .setDescription(`**USD Value:**\n${formatUsd(usd)}`)
    .setThumbnail(getItemImage(itemName))
    .setFooter({ text: 'valuedex' });
}

function getPetFrNfrMfr(petName) {
  return {
    fr: petUsd(petName, { fly: true, ride: true, neon: false, mega: false }),
    nfr: petUsd(petName, { fly: true, ride: true, neon: true, mega: false }),
    mfr: petUsd(petName, { fly: true, ride: true, neon: false, mega: true }),
  };
}

function buildPetValueChangeEmbed(petName, oldValues, newValues) {
  const description = [
    '**USD Value:**',
    `${EMOJI.fly}${EMOJI.ride} ${formatUsd(oldValues.fr)} → **${formatUsd(newValues.fr)}**`,
    `${EMOJI.neon}${EMOJI.fly}${EMOJI.ride} ${formatUsd(oldValues.nfr)} → **${formatUsd(newValues.nfr)}**`,
    `${EMOJI.mega}${EMOJI.fly}${EMOJI.ride} ${formatUsd(oldValues.mfr)} → **${formatUsd(newValues.mfr)}**`,
  ].join('\n');

  return new EmbedBuilder()
    .setColor(0x1e64c8)
    .setTitle(petName)
    .setDescription(description)
    .setThumbnail(getItemImage(petName))
    .setFooter({ text: 'valuedex' });
}

async function postPetValueUpdate(petName, oldValues, newValues) {
  try {
    const channel = await client.channels.fetch(VALUE_UPDATE_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) {
      console.error(`Value update channel ${VALUE_UPDATE_CHANNEL_ID} not found or not text-based`);
      return;
    }
    await channel.send({ embeds: [buildPetValueChangeEmbed(petName, oldValues, newValues)] });
  } catch (err) {
    console.error('Failed to post pet value update:', err.message);
  }
}

function buildItemValueChangeEmbed(itemName, oldValue, newValue) {
  const description = [
    '**USD Value:**',
    `${formatUsd(oldValue)} → **${formatUsd(newValue)}**`,
  ].join('\n');

  return new EmbedBuilder()
    .setColor(0x1e64c8)
    .setTitle(itemName)
    .setDescription(description)
    .setThumbnail(getItemImage(itemName))
    .setFooter({ text: 'valuedex' });
}

async function postItemValueUpdate(itemName, oldValue, newValue) {
  try {
    const channel = await client.channels.fetch(VALUE_UPDATE_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) {
      console.error(`Value update channel ${VALUE_UPDATE_CHANNEL_ID} not found or not text-based`);
      return;
    }
    await channel.send({ embeds: [buildItemValueChangeEmbed(itemName, oldValue, newValue)] });
  } catch (err) {
    console.error('Failed to post item value update:', err.message);
  }
}

const valueCommand = new SlashCommandBuilder()
  .setName('value')
  .setDescription('Show USD value for a pet or item')
  .addStringOption((option) =>
    option
      .setName('item')
      .setDescription('Pet or item name (example: Rainbow Rattle)')
      .setRequired(true)
  )
  .toJSON();

const editPetValueCommand = new SlashCommandBuilder()
  .setName('editpetvalue')
  .setDescription('Edit FR / NFR / MFR USD values for a pet')
  .addStringOption((option) =>
    option.setName('pet').setDescription('Pet name').setRequired(true)
  )
  .addNumberOption((option) =>
    option.setName('fr_value').setDescription('FR Value (USD)').setRequired(true).setMinValue(0)
  )
  .addNumberOption((option) =>
    option.setName('nfr_value').setDescription('NFR Value (USD)').setRequired(true).setMinValue(0)
  )
  .addNumberOption((option) =>
    option.setName('mfr_value').setDescription('MFR Value (USD)').setRequired(true).setMinValue(0)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .toJSON();

const editItemValueCommand = new SlashCommandBuilder()
  .setName('edititemvalue')
  .setDescription('Edit USD value for a non-pet item')
  .addStringOption((option) =>
    option.setName('item').setDescription('Item name').setRequired(true)
  )
  .addNumberOption((option) =>
    option.setName('value').setDescription('USD Value').setRequired(true).setMinValue(0)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .toJSON();

const allCommands = [valueCommand, editPetValueCommand, editItemValueCommand];

async function registerCommands(readyClient) {
  const rest = new REST({ version: '10' }).setToken(token);

  let targetGuildId = guildId || null;
  if (targetGuildId && !readyClient.guilds.cache.has(targetGuildId)) {
    console.warn(
      `DISCORD_GUILD_ID ${targetGuildId} is not a server this bot is in. Falling back to first joined server.`
    );
    targetGuildId = null;
  }
  if (!targetGuildId) {
    targetGuildId = readyClient.guilds.cache.first()?.id || null;
  }

  if (targetGuildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, targetGuildId), {
      body: allCommands,
    });
    const guildName = readyClient.guilds.cache.get(targetGuildId)?.name || targetGuildId;
    console.log(`Registered slash commands for guild ${guildName} (${targetGuildId})`);
    return;
  }

  await rest.put(Routes.applicationCommands(clientId), {
    body: allCommands,
  });
  console.log('Registered global slash commands (can take up to ~1 hour to appear)');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`valuedex bot online as ${readyClient.user.tag}`);
  try {
    await registerCommands(readyClient);
  } catch (err) {
    console.error('Failed to register slash commands:', err.message);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'value') {
    const query = interaction.options.getString('item', true);
    const itemName = resolveItemName(query);

    if (!itemName) {
      await interaction.reply({
        content: `Could not find an item named **${query}**. Try the full name (example: Rainbow Rattle).`,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({ embeds: [buildValueEmbed(itemName)] });
    return;
  }

  if (interaction.commandName === 'editpetvalue') {
    if (!canEditValues(interaction)) {
      await interaction.reply({
        content: 'You do not have permission to edit values.',
        ephemeral: true,
      });
      return;
    }

    const query = interaction.options.getString('pet', true);
    const petName = resolvePetOnly(query);
    if (!petName) {
      await interaction.reply({
        content: `Could not find a pet named **${query}**.`,
        ephemeral: true,
      });
      return;
    }

    const fr = interaction.options.getNumber('fr_value', true);
    const nfr = interaction.options.getNumber('nfr_value', true);
    const mfr = interaction.options.getNumber('mfr_value', true);
    const oldValues = getPetFrNfrMfr(petName);
    const newValues = { fr, nfr, mfr };

    overrides.pets[petName] = newValues;
    await saveOverrides();

    await postPetValueUpdate(petName, oldValues, newValues);

    await interaction.reply({
      content: `Updated **${petName}** values.`,
      embeds: [buildValueEmbed(petName)],
    });
    return;
  }

  if (interaction.commandName === 'edititemvalue') {
    if (!canEditValues(interaction)) {
      await interaction.reply({
        content: 'You do not have permission to edit values.',
        ephemeral: true,
      });
      return;
    }

    const query = interaction.options.getString('item', true);
    const itemName = resolveNonPetItem(query);
    if (!itemName) {
      await interaction.reply({
        content: `Could not find a non-pet item named **${query}**. Use \`/editpetvalue\` for pets.`,
        ephemeral: true,
      });
      return;
    }

    const amount = interaction.options.getNumber('value', true);
    const oldValue = itemUsd(itemName);

    overrides.items[itemName] = amount;
    await saveOverrides();

    await postItemValueUpdate(itemName, oldValue, amount);

    await interaction.reply({
      content: `Updated **${itemName}** value.`,
      embeds: [buildValueEmbed(itemName)],
    });
  }
});

client.login(token).catch((err) => {
  console.error('Failed to log in. Check your bot token.', err.message);
  process.exit(1);
});
