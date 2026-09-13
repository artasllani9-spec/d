require('dotenv').config();
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFile } = require('child_process');
const { promisify } = require('util');
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

const execFileAsync = promisify(execFile);
const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID; // optional: faster guild-only command updates
const editorRoleId = process.env.DISCORD_EDITOR_ROLE_ID || '1547733340633702481';

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
const githubRepo = process.env.GITHUB_REPO || 'artasllani9-spec/d';
const githubBranch = process.env.GITHUB_BRANCH || 'main';
const githubOverridesPath = process.env.VALUES_GITHUB_PATH || 'data/value-overrides.json';
const OVERRIDES_PATH = path.join(__dirname, 'value-overrides.json');
const SITE_OVERRIDES_PATH = path.join(__dirname, '..', 'data', 'value-overrides.json');
const REPO_ROOT = path.join(__dirname, '..');
const VALUE_UPDATE_CHANNEL_ID =
  process.env.DISCORD_VALUE_UPDATE_CHANNEL_ID || '1548371067679023178';

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

function parseOverridesObject(raw) {
  return {
    pets: raw && raw.pets && typeof raw.pets === 'object' ? raw.pets : {},
    items: raw && raw.items && typeof raw.items === 'object' ? raw.items : {},
    acronyms: raw && raw.acronyms && typeof raw.acronyms === 'object' ? raw.acronyms : {},
    updatedAt: raw && raw.updatedAt != null ? Number(raw.updatedAt) || null : null,
  };
}

function readOverridesFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return parseOverridesObject(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (err) {
    console.warn(`Failed to read ${filePath}:`, err.message);
    return null;
  }
}

function pickNewestOverrides(...candidates) {
  const valid = candidates.filter(Boolean);
  if (!valid.length) return { pets: {}, items: {}, acronyms: {}, updatedAt: null };
  return valid.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))[0];
}

function loadOverrides() {
  return pickNewestOverrides(
    readOverridesFile(OVERRIDES_PATH),
    readOverridesFile(SITE_OVERRIDES_PATH)
  );
}

async function fetchOverridesFromSite() {
  try {
    const response = await fetch(`${siteUrl}/api/values/overrides`, { cache: 'no-store' });
    if (!response.ok) return null;
    return parseOverridesObject(await response.json());
  } catch (err) {
    console.warn('Could not fetch overrides from site API:', err.message);
    return null;
  }
}

async function fetchOverridesFromGitHub() {
  try {
    const url = `https://raw.githubusercontent.com/${githubRepo}/${githubBranch}/${githubOverridesPath}?t=${Date.now()}`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    return parseOverridesObject(await response.json());
  } catch (err) {
    console.warn('Could not fetch overrides from GitHub:', err.message);
    return null;
  }
}

async function refreshOverridesFromRemote() {
  const remote = pickNewestOverrides(
    await fetchOverridesFromSite(),
    await fetchOverridesFromGitHub(),
    overrides
  );
  overrides = {
    pets: remote.pets || {},
    items: remote.items || {},
    acronyms: remote.acronyms || {},
    updatedAt: remote.updatedAt || null,
  };
  console.log(
    `Loaded overrides: ${Object.keys(overrides.pets).length} pets, ${Object.keys(overrides.items).length} items, ${Object.keys(overrides.acronyms).length} acronyms`
  );
}

function saveOverridesLocal() {
  const payload = {
    pets: overrides.pets,
    items: overrides.items,
    acronyms: overrides.acronyms,
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
  return text;
}

async function syncOverridesToSite() {
  if (!valuesEditToken) {
    console.warn(
      'VALUES_EDIT_TOKEN is not set — live API sync skipped. Local + GitHub push can still work.'
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
      acronyms: overrides.acronyms,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Site sync failed (${response.status}): ${text || response.statusText}`);
  }
  console.log('Synced value overrides to site API');
  return true;
}

async function resolveGitHubToken() {
  const fromEnv = process.env.GITHUB_TOKEN || process.env.TRADES_GITHUB_TOKEN || '';
  if (fromEnv) return fromEnv;
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], { windowsHide: true });
    return String(stdout || '').trim();
  } catch {
    return '';
  }
}

async function pushOverridesViaGitHubApi(fileText) {
  const token = await resolveGitHubToken();
  if (!token) {
    throw new Error(
      'No GitHub token found. Set GITHUB_TOKEN in discord-bot/.env (repo Contents: Read & Write), or run gh auth login.'
    );
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'valuedex-discord-bot',
  };

  let sha = null;
  const getUrl = `https://api.github.com/repos/${githubRepo}/contents/${githubOverridesPath}?ref=${encodeURIComponent(githubBranch)}`;
  const getResponse = await fetch(getUrl, { headers });
  if (getResponse.ok) {
    const existing = await getResponse.json();
    sha = existing.sha || null;
  } else if (getResponse.status !== 404) {
    const details = await getResponse.text().catch(() => '');
    throw new Error(`GitHub read failed (${getResponse.status}): ${details || getResponse.statusText}`);
  }

  const putResponse = await fetch(
    `https://api.github.com/repos/${githubRepo}/contents/${githubOverridesPath}`,
    {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Update value overrides from Discord bot',
        content: Buffer.from(fileText, 'utf8').toString('base64'),
        branch: githubBranch,
        ...(sha ? { sha } : {}),
      }),
    }
  );

  if (!putResponse.ok) {
    const details = await putResponse.text().catch(() => '');
    throw new Error(`GitHub push failed (${putResponse.status}): ${details || putResponse.statusText}`);
  }

  console.log(`Pushed ${githubOverridesPath} to GitHub (${githubRepo}@${githubBranch})`);
  return true;
}

async function pushOverridesViaGitCli() {
  await execFileAsync('git', ['add', '--', githubOverridesPath], {
    cwd: REPO_ROOT,
    windowsHide: true,
  });

  const status = await execFileAsync(
    'git',
    ['status', '--porcelain', '--', githubOverridesPath],
    { cwd: REPO_ROOT, windowsHide: true }
  );
  if (!String(status.stdout || '').trim()) {
    console.log('GitHub: value overrides already committed');
    return true;
  }

  await execFileAsync(
    'git',
    ['commit', '-m', 'Update value overrides from Discord bot', '--', githubOverridesPath],
    { cwd: REPO_ROOT, windowsHide: true }
  );

  await execFileAsync('git', ['push', 'origin', 'HEAD'], {
    cwd: REPO_ROOT,
    windowsHide: true,
  });

  console.log(`Pushed ${githubOverridesPath} to GitHub via git`);
  return true;
}

async function pushOverridesToGitHub(fileText) {
  try {
    await pushOverridesViaGitCli();
    return true;
  } catch (gitErr) {
    console.warn('git push failed, trying GitHub API:', gitErr.stderr || gitErr.message);
    await pushOverridesViaGitHubApi(fileText);
    return true;
  }
}

async function saveOverrides() {
  const fileText = saveOverridesLocal();

  try {
    await syncOverridesToSite();
  } catch (err) {
    console.error(err.message);
  }

  try {
    await pushOverridesToGitHub(fileText);
  } catch (err) {
    console.error(err.message);
  }
}

const values = loadAmvggValues();
const ITEM_IMAGES = loadItemImages();
let overrides = loadOverrides();
if (!overrides.acronyms || typeof overrides.acronyms !== 'object') {
  overrides.acronyms = {};
}
const PET_NAMES = Object.keys(values.AMVGG_PET_PRICING || {});
const OTHER_ITEM_NAMES = Object.keys(values.AMVGG_USD_VALUES || {}).filter(
  (name) => !Object.prototype.hasOwnProperty.call(values.AMVGG_PET_PRICING, name)
);
const ALL_ITEM_NAMES = [...PET_NAMES, ...OTHER_ITEM_NAMES];

function normalizeItemKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function getNameAcronym(name) {
  return String(name || '')
    .split(/[\s.\-'_]+/)
    .filter(Boolean)
    .map((word) => {
      const cleaned = word.replace(/[^a-zA-Z0-9]/g, '');
      return cleaned[0] ? cleaned[0].toLowerCase() : '';
    })
    .join('');
}

function buildUniqueAcronymMap(names) {
  const groups = new Map();
  for (const name of names) {
    const acro = getNameAcronym(name);
    if (!acro) continue;
    if (!groups.has(acro)) groups.set(acro, []);
    groups.get(acro).push(name);
  }

  const unique = new Map();
  for (const [acro, list] of groups.entries()) {
    if (list.length === 1) unique.set(acro, list[0]);
  }
  return unique;
}

// First-letter shortcuts only when exactly one pet/item has that acronym.
const UNIQUE_NAME_ACRONYMS = buildUniqueAcronymMap(ALL_ITEM_NAMES);

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

function resolveFromAcronym(query) {
  const q = normalizeItemKey(query);
  if (!q) return null;
  const mapped = overrides.acronyms && overrides.acronyms[q];
  if (!mapped) return null;
  if (isPet(mapped) || OTHER_ITEM_NAMES.includes(mapped)) return mapped;
  return (
    matchNameInList(normalizeItemKey(mapped), PET_NAMES) ||
    matchNameInList(normalizeItemKey(mapped), OTHER_ITEM_NAMES)
  );
}

function resolveByUniqueNameAcronym(query) {
  const q = normalizeItemKey(query);
  if (!q) return null;
  return UNIQUE_NAME_ACRONYMS.get(q) || null;
}

function resolveItemName(query) {
  // 1) Custom /acronymadd mappings always win
  const fromCustom = resolveFromAcronym(query);
  if (fromCustom) return fromCustom;

  const q = normalizeItemKey(query);
  if (!q) return null;

  // 2) Normal name match (ignores spaces, ".", "-", etc.)
  const fromName = matchNameInList(q, PET_NAMES) || matchNameInList(q, OTHER_ITEM_NAMES);
  if (fromName) return fromName;

  // 3) First-letter shortcut (ccbd → Chocolate Chip Bat Dragon),
  //    but only when that acronym is unique across all pets/items.
  return resolveByUniqueNameAcronym(query);
}

function resolvePetOnly(query) {
  const fromAcronym = resolveFromAcronym(query);
  if (fromAcronym && isPet(fromAcronym)) return fromAcronym;
  const q = normalizeItemKey(query);
  if (!q) return null;
  return matchNameInList(q, PET_NAMES);
}

function resolveNonPetItem(query) {
  const fromAcronym = resolveFromAcronym(query);
  if (fromAcronym && !isPet(fromAcronym)) return fromAcronym;
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

function memberHasRole(interaction, roleId) {
  if (!roleId || !interaction.guild || !interaction.member) return false;
  const roles = interaction.member.roles;
  if (!roles) return false;
  if (typeof roles.cache?.has === 'function') return roles.cache.has(roleId);
  if (typeof roles.has === 'function') return roles.has(roleId);
  if (Array.isArray(roles)) return roles.includes(roleId);
  return false;
}

function canEditValues(interaction) {
  return memberHasRole(interaction, editorRoleId);
}

function canAdminister(interaction) {
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

function parseEmbedColor(input) {
  if (!input) return 0x1e64c8;
  const cleaned = String(input).trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
  return Number.parseInt(cleaned, 16);
}

function buildCustomEmbed({ title, description, color, image, thumbnail, footer }) {
  const embed = new EmbedBuilder().setColor(color).setDescription(description);
  if (title) embed.setTitle(title);
  if (image) embed.setImage(image);
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (footer) embed.setFooter({ text: footer });
  return embed;
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
      .setFooter({ text: 'ValueDex' });
  }

  const usd = itemUsd(itemName);
  return new EmbedBuilder()
    .setColor(0x1e64c8)
    .setTitle(itemName)
    .setDescription(`**USD Value:**\n${formatUsd(usd)}`)
    .setThumbnail(getItemImage(itemName))
    .setFooter({ text: 'ValueDex' });
}

function getPetFrNfrMfr(petName) {
  return {
    fr: petUsd(petName, { fly: true, ride: true, neon: false, mega: false }),
    nfr: petUsd(petName, { fly: true, ride: true, neon: true, mega: false }),
    mfr: petUsd(petName, { fly: true, ride: true, neon: false, mega: true }),
  };
}

function formatValueChange(oldValue, newValue) {
  if (oldValue === newValue) return `**${formatUsd(newValue)}**`;
  return `${formatUsd(oldValue)} → **${formatUsd(newValue)}**`;
}

function buildPetValueChangeEmbed(petName, oldValues, newValues) {
  const description = [
    '**USD Value:**',
    `${EMOJI.fly}${EMOJI.ride} ${formatValueChange(oldValues.fr, newValues.fr)}`,
    `${EMOJI.neon}${EMOJI.fly}${EMOJI.ride} ${formatValueChange(oldValues.nfr, newValues.nfr)}`,
    `${EMOJI.mega}${EMOJI.fly}${EMOJI.ride} ${formatValueChange(oldValues.mfr, newValues.mfr)}`,
  ].join('\n');

  return new EmbedBuilder()
    .setColor(0x1e64c8)
    .setTitle(petName)
    .setDescription(description)
    .setThumbnail(getItemImage(petName))
    .setFooter({ text: 'ValueDex' });
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
    .setFooter({ text: 'ValueDex' });
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
    option
      .setName('fr_value')
      .setDescription('FR Value (USD) — leave empty to keep current')
      .setRequired(false)
      .setMinValue(0)
  )
  .addNumberOption((option) =>
    option
      .setName('nfr_value')
      .setDescription('NFR Value (USD) — leave empty to keep current')
      .setRequired(false)
      .setMinValue(0)
  )
  .addNumberOption((option) =>
    option
      .setName('mfr_value')
      .setDescription('MFR Value (USD) — leave empty to keep current')
      .setRequired(false)
      .setMinValue(0)
  )
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
  .toJSON();

const acronymAddCommand = new SlashCommandBuilder()
  .setName('acronymadd')
  .setDescription('Add a search acronym for a pet or item')
  .addStringOption((option) =>
    option.setName('item').setDescription('Pet or item name').setRequired(true)
  )
  .addStringOption((option) =>
    option.setName('acronym').setDescription('Short acronym (example: FD)').setRequired(true)
  )
  .toJSON();

const sayCommand = new SlashCommandBuilder()
  .setName('say')
  .setDescription('Make the bot send a message')
  .addStringOption((option) =>
    option.setName('message').setDescription('What the bot should say').setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .toJSON();

const embedCommand = new SlashCommandBuilder()
  .setName('embed')
  .setDescription('Make the bot send an embed')
  .addStringOption((option) =>
    option.setName('description').setDescription('Embed body text').setRequired(true)
  )
  .addStringOption((option) =>
    option.setName('title').setDescription('Embed title').setRequired(false)
  )
  .addStringOption((option) =>
    option.setName('color').setDescription('Hex color (example: #1e64c8)').setRequired(false)
  )
  .addStringOption((option) =>
    option.setName('image').setDescription('Image URL').setRequired(false)
  )
  .addStringOption((option) =>
    option.setName('thumbnail').setDescription('Thumbnail URL').setRequired(false)
  )
  .addStringOption((option) =>
    option.setName('footer').setDescription('Footer text').setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .toJSON();

const allCommands = [
  valueCommand,
  editPetValueCommand,
  editItemValueCommand,
  acronymAddCommand,
  sayCommand,
  embedCommand,
];

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
    const names = allCommands.map((cmd) => `/${cmd.name}`).join(', ');
    console.log(`Registered slash commands for guild ${guildName} (${targetGuildId}): ${names}`);
    return;
  }

  await rest.put(Routes.applicationCommands(clientId), {
    body: allCommands,
  });
  const names = allCommands.map((cmd) => `/${cmd.name}`).join(', ');
  console.log(`Registered global slash commands: ${names} (can take up to ~1 hour to appear)`);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`valuedex bot online as ${readyClient.user.tag}`);

  // Register commands first so slash commands recover even if sync is slow.
  try {
    await registerCommands(readyClient);
  } catch (err) {
    console.error('Failed to register slash commands:', err.message);
  }

  try {
    await refreshOverridesFromRemote();
    await syncOverridesToSite().catch((err) => console.warn(err.message));
  } catch (err) {
    console.error('Failed to refresh overrides on startup:', err.message);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
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
          content: 'You need the editor role to use this command.',
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

      const oldValues = getPetFrNfrMfr(petName);
      const frInput = interaction.options.getNumber('fr_value');
      const nfrInput = interaction.options.getNumber('nfr_value');
      const mfrInput = interaction.options.getNumber('mfr_value');

      if (frInput == null && nfrInput == null && mfrInput == null) {
        await interaction.reply({
          content: 'Provide at least one of FR, NFR, or MFR to update.',
          ephemeral: true,
        });
        return;
      }

      const newValues = {
        fr: frInput == null ? oldValues.fr : frInput,
        nfr: nfrInput == null ? oldValues.nfr : nfrInput,
        mfr: mfrInput == null ? oldValues.mfr : mfrInput,
      };

      overrides.pets[petName] = newValues;

      await interaction.reply({
        content: `Value of **${petName}** has been changed.`,
        embeds: [buildValueEmbed(petName)],
      });

      try {
        await saveOverrides();
        await postPetValueUpdate(petName, oldValues, newValues);
      } catch (err) {
        console.error('Failed after pet value reply:', err.message || err);
      }
      return;
    }

    if (interaction.commandName === 'edititemvalue') {
      if (!canEditValues(interaction)) {
        await interaction.reply({
          content: 'You need the editor role to use this command.',
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

      await interaction.reply({
        content: `Value of **${itemName}** has been changed.`,
        embeds: [buildValueEmbed(itemName)],
      });

      try {
        await saveOverrides();
        await postItemValueUpdate(itemName, oldValue, amount);
      } catch (err) {
        console.error('Failed after item value reply:', err.message || err);
      }
    }

    if (interaction.commandName === 'acronymadd') {
      if (!canEditValues(interaction)) {
        await interaction.reply({
          content: 'You need the editor role to use this command.',
          ephemeral: true,
        });
        return;
      }

      const query = interaction.options.getString('item', true);
      const itemName = resolveItemName(query);
      if (!itemName) {
        await interaction.reply({
          content: `Could not find an item named **${query}**.`,
          ephemeral: true,
        });
        return;
      }

      const acronymRaw = interaction.options.getString('acronym', true);
      const acronym = normalizeItemKey(acronymRaw);
      if (!acronym) {
        await interaction.reply({
          content: 'Acronym must include at least one letter or number.',
          ephemeral: true,
        });
        return;
      }

      const existing = overrides.acronyms[acronym];
      overrides.acronyms[acronym] = itemName;

      await interaction.reply({
        content: existing && existing !== itemName
          ? `Acronym **${acronym}** remapped from **${existing}** to **${itemName}**.`
          : `Acronym **${acronym}** added for **${itemName}**.`,
      });

      try {
        await saveOverrides();
      } catch (err) {
        console.error('Failed after acronym reply:', err.message || err);
      }
    }

    if (interaction.commandName === 'say') {
      if (!canAdminister(interaction)) {
        await interaction.reply({
          content: 'You need Administrator permission to use this command.',
          ephemeral: true,
        });
        return;
      }

      const message = interaction.options.getString('message', true);
      if (!interaction.channel || !interaction.channel.isTextBased()) {
        await interaction.reply({
          content: 'This command can only be used in a text channel.',
          ephemeral: true,
        });
        return;
      }

      await interaction.channel.send({ content: message });
      await interaction.reply({ content: 'Sent.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'embed') {
      if (!canAdminister(interaction)) {
        await interaction.reply({
          content: 'You need Administrator permission to use this command.',
          ephemeral: true,
        });
        return;
      }

      if (!interaction.channel || !interaction.channel.isTextBased()) {
        await interaction.reply({
          content: 'This command can only be used in a text channel.',
          ephemeral: true,
        });
        return;
      }

      const description = interaction.options.getString('description', true);
      const title = interaction.options.getString('title');
      const colorInput = interaction.options.getString('color');
      const image = interaction.options.getString('image');
      const thumbnail = interaction.options.getString('thumbnail');
      const footer = interaction.options.getString('footer');
      const color = parseEmbedColor(colorInput);

      if (color == null) {
        await interaction.reply({
          content: 'Color must be a hex code like `#1e64c8`.',
          ephemeral: true,
        });
        return;
      }

      const embed = buildCustomEmbed({
        title,
        description,
        color,
        image,
        thumbnail,
        footer,
      });

      await interaction.channel.send({ embeds: [embed] });
      await interaction.reply({ content: 'Embed sent.', ephemeral: true });
    }
  } catch (err) {
    console.error('Command failed:', err);
    const message = 'Something went wrong while running that command.';
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: message });
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    } catch {
      // ignore follow-up failures
    }
  }
});

client.login(token).catch((err) => {
  console.error('Failed to log in. Check your bot token.', err.message);
  process.exit(1);
});
