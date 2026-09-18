require('dotenv').config();
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
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
  Partials,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  ChannelType,
  ApplicationIntegrationType,
  InteractionContextType,
} = require('discord.js');

const execFileAsync = promisify(execFile);
const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID; // optional: faster guild-only command updates
const editorRoleId = process.env.DISCORD_EDITOR_ROLE_ID || '1547733340633702481';

if (!token || token === 'your_bot_token_here') {
  console.error(
    'Missing DISCORD_BOT_TOKEN. Set it in Railway Variables (or discord-bot/.env for local).'
  );
  process.exit(1);
}

if (!clientId) {
  console.error(
    'Missing DISCORD_CLIENT_ID. Set it in Railway Variables (or discord-bot/.env for local).'
  );
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
const WELCOME_CONFIG_PATH = path.join(__dirname, 'welcome-config.json');
const REPO_ROOT = path.join(__dirname, '..');
const VALUE_UPDATE_CHANNEL_ID = String(
  process.env.DISCORD_VALUE_UPDATE_CHANNEL_ID || '1548371067679023178'
).trim();
/** guildId -> welcome embed config */
let welcomeByGuild = {};

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
    globalThis: null,
  };
  context.globalThis = context;
  vm.createContext(context);
  // const/let are not visible on the vm context object — export them explicitly
  vm.runInContext(
    `${code}\n;globalThis.__AMVGG = { AMVGG_PET_PRICING, AMVGG_USD_VALUES, getAmvggUsdValue, formatUsdValue };`,
    context
  );
  return { api: context.__AMVGG, context };
}

let amvggRuntime = loadAmvggValues();
let values = amvggRuntime.api;

function syncAmvggOverrides() {
  if (!amvggRuntime || !amvggRuntime.context) return;
  amvggRuntime.context.__VALUE_OVERRIDES = {
    pets: (typeof overrides !== 'undefined' && overrides && overrides.pets) || {},
    items: (typeof overrides !== 'undefined' && overrides && overrides.items) || {},
    customPets: (typeof overrides !== 'undefined' && overrides && overrides.customPets) || {},
    customItems: (typeof overrides !== 'undefined' && overrides && overrides.customItems) || {},
  };
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
    customPets: raw && raw.customPets && typeof raw.customPets === 'object' ? raw.customPets : {},
    customItems: raw && raw.customItems && typeof raw.customItems === 'object' ? raw.customItems : {},
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
  if (!valid.length) {
    return {
      pets: {},
      items: {},
      acronyms: {},
      customPets: {},
      customItems: {},
      updatedAt: null,
    };
  }
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
    customPets: remote.customPets || {},
    customItems: remote.customItems || {},
    updatedAt: remote.updatedAt || null,
  };
  // Keep pricing maps in sync with custom catalog entries
  for (const [name, entry] of Object.entries(overrides.customPets || {})) {
    const { image: _image, ...values } = entry || {};
    overrides.pets[name] = { ...values };
  }
  for (const [name, entry] of Object.entries(overrides.customItems || {})) {
    overrides.items[name] = entry.value;
  }
  console.log(
    `Loaded overrides: ${Object.keys(overrides.pets).length} pets, ${Object.keys(overrides.items).length} items, ${Object.keys(overrides.acronyms).length} acronyms, ${Object.keys(overrides.customPets).length} custom pets, ${Object.keys(overrides.customItems).length} custom items`
  );
  syncAmvggOverrides();
}

function saveOverridesLocal() {
  const payload = {
    pets: overrides.pets,
    items: overrides.items,
    acronyms: overrides.acronyms,
    customPets: overrides.customPets,
    customItems: overrides.customItems,
    updatedAt: Date.now(),
  };
  syncAmvggOverrides();
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
      customPets: overrides.customPets,
      customItems: overrides.customItems,
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
  // Railway images usually aren't a writable git checkout — use the API there.
  const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_ID);
  if (onRailway) {
    await pushOverridesViaGitHubApi(fileText);
    return true;
  }

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
  let fileText;
  try {
    fileText = saveOverridesLocal();
  } catch (err) {
    console.error('Failed to write local overrides:', err.message || err);
    fileText = JSON.stringify(
      {
        pets: overrides.pets,
        items: overrides.items,
        acronyms: overrides.acronyms,
        customPets: overrides.customPets,
        customItems: overrides.customItems,
        updatedAt: Date.now(),
      },
      null,
      2
    ) + '\n';
  }

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

const ITEM_IMAGES = loadItemImages();
let overrides = loadOverrides();
if (!overrides.acronyms || typeof overrides.acronyms !== 'object') overrides.acronyms = {};
if (!overrides.customPets || typeof overrides.customPets !== 'object') overrides.customPets = {};
if (!overrides.customItems || typeof overrides.customItems !== 'object') overrides.customItems = {};
for (const [name, entry] of Object.entries(overrides.customPets)) {
  const { image: _image, ...values } = entry || {};
  overrides.pets[name] = { ...values };
}
for (const [name, entry] of Object.entries(overrides.customItems)) {
  overrides.items[name] = entry.value;
}
syncAmvggOverrides();

const BUILTIN_PET_NAMES = Object.keys(values.AMVGG_PET_PRICING || {});
const BUILTIN_ITEM_NAMES = Object.keys(values.AMVGG_USD_VALUES || {}).filter(
  (name) => !Object.prototype.hasOwnProperty.call(values.AMVGG_PET_PRICING, name)
);

function getPetNames() {
  return [
    ...new Set([
      ...BUILTIN_PET_NAMES,
      ...Object.keys(overrides.customPets || {}),
      ...Object.keys(overrides.pets || {}),
    ]),
  ];
}

function getOtherItemNames() {
  const petSet = new Set(getPetNames());
  return [
    ...new Set([
      ...BUILTIN_ITEM_NAMES,
      ...Object.keys(overrides.customItems || {}),
      ...Object.keys(overrides.items || {}),
    ]),
  ].filter((name) => !petSet.has(name));
}

function getAllItemNames() {
  return [...new Set([...getPetNames(), ...getOtherItemNames()])];
}

function filterNamesForAutocomplete(query, limit = 25) {
  const names = getAllItemNames();
  const q = normalizeItemKey(query);
  if (!q) {
    return names.slice(0, limit).map((name) => ({ name, value: name }));
  }

  const scored = [];
  for (const name of names) {
    const key = normalizeItemKey(name);
    if (key === q) scored.push({ name, score: 0 });
    else if (key.startsWith(q)) scored.push({ name, score: 1 });
    else if (key.includes(q)) scored.push({ name, score: 2 });
    else if (getNameAcronym(name) === q) scored.push({ name, score: 3 });
  }

  scored.sort((a, b) => a.score - b.score || a.name.length - b.name.length || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map(({ name }) => ({ name, value: name }));
}

function filterCustomNamesForAutocomplete(query, names, limit = 25) {
  const list = [...new Set(names || [])].sort((a, b) => a.localeCompare(b));
  const q = normalizeItemKey(query);
  const filtered = q
    ? list.filter((name) => {
        const key = normalizeItemKey(name);
        return key.includes(q) || getNameAcronym(name) === q;
      })
    : list;
  return filtered.slice(0, limit).map((name) => ({ name, value: name }));
}

function removeAcronymsForItem(itemName) {
  if (!overrides.acronyms || typeof overrides.acronyms !== 'object') return;
  for (const [acro, mapped] of Object.entries(overrides.acronyms)) {
    if (mapped === itemName) delete overrides.acronyms[acro];
  }
}

function deleteCustomPet(name) {
  const entry = overrides.customPets && overrides.customPets[name];
  if (!entry) return false;
  delete overrides.customPets[name];
  if (overrides.pets) delete overrides.pets[name];
  removeAcronymsForItem(name);
  return true;
}

function deleteCustomItem(name, category) {
  const entry = overrides.customItems && overrides.customItems[name];
  if (!entry) return { ok: false, reason: 'missing' };
  if (entry.category !== category) {
    return { ok: false, reason: 'category', actual: entry.category };
  }
  delete overrides.customItems[name];
  if (overrides.items) delete overrides.items[name];
  removeAcronymsForItem(name);
  return { ok: true };
}


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
function getUniqueNameAcronyms() {
  return buildUniqueAcronymMap(getAllItemNames());
}

function getItemImage(name) {
  if (overrides.customPets && overrides.customPets[name]?.image) {
    return overrides.customPets[name].image;
  }
  if (overrides.customItems && overrides.customItems[name]?.image) {
    return overrides.customItems[name].image;
  }
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
  if (isPet(mapped) || getOtherItemNames().includes(mapped)) return mapped;
  return (
    matchNameInList(normalizeItemKey(mapped), getPetNames()) ||
    matchNameInList(normalizeItemKey(mapped), getOtherItemNames())
  );
}

function resolveByUniqueNameAcronym(query) {
  const q = normalizeItemKey(query);
  if (!q) return null;
  return getUniqueNameAcronyms().get(q) || null;
}

function resolveItemName(query) {
  // 1) Custom /acronymadd mappings always win
  const fromCustom = resolveFromAcronym(query);
  if (fromCustom) return fromCustom;

  const q = normalizeItemKey(query);
  if (!q) return null;

  // 2) Normal name match (ignores spaces, ".", "-", etc.)
  const fromName =
    matchNameInList(q, getPetNames()) || matchNameInList(q, getOtherItemNames());
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
  return matchNameInList(q, getPetNames());
}

function resolveNonPetItem(query) {
  const fromAcronym = resolveFromAcronym(query);
  if (fromAcronym && !isPet(fromAcronym)) return fromAcronym;
  const q = normalizeItemKey(query);
  if (!q) return null;
  return matchNameInList(q, getOtherItemNames());
}

function isPet(name) {
  if (!name) return false;
  if (Object.prototype.hasOwnProperty.call(values.AMVGG_PET_PRICING || {}, name)) return true;
  if (Object.prototype.hasOwnProperty.call(overrides.customPets || {}, name)) return true;
  const petOverride = overrides.pets && overrides.pets[name];
  return Boolean(
    petOverride &&
      typeof petOverride === 'object' &&
      Number.isFinite(Number(petOverride.fr)) &&
      Number.isFinite(Number(petOverride.nfr)) &&
      Number.isFinite(Number(petOverride.mfr))
  );
}

function isValidImageUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const ITEM_CATEGORY_CHOICES = [
  { name: 'Pet wear', value: 'pet-wear' },
  { name: 'Strollers', value: 'strollers' },
  { name: 'Food', value: 'food' },
  { name: 'Vehicles', value: 'vehicles' },
  { name: 'Toys', value: 'toys' },
  { name: 'Gifts', value: 'gifts' },
  { name: 'Stickers', value: 'stickers' },
  { name: 'Houses', value: 'houses' },
];

function petUsd(name, potions) {
  syncAmvggOverrides();
  return values.getAmvggUsdValue(
    name,
    potions || { fly: true, ride: true, neon: false, mega: false }
  );
}

function itemUsd(name) {
  syncAmvggOverrides();
  return values.getAmvggUsdValue(name);
}

/** Safe math calculator — digits, . + - * / ( ) and spaces only. No eval(). */
function evaluateMathExpression(rawInput) {
  const original = String(rawInput || '').trim();
  if (!original) {
    return { ok: false, error: 'Enter a math expression (example: `60+50+40/2`).' };
  }
  if (original.length > 200) {
    return { ok: false, error: 'Expression is too long (max 200 characters).' };
  }
  if (!/^[0-9+\-*/().\s]+$/.test(original)) {
    return {
      ok: false,
      error: 'Only numbers and `+ - * / ( )` are allowed (example: `60+50+40/2`).',
    };
  }

  const expr = original.replace(/\s+/g, '');
  if (!expr) {
    return { ok: false, error: 'Enter a math expression (example: `60+50+40/2`).' };
  }
  if (!/^[0-9+\-*/().]+$/.test(expr)) {
    return { ok: false, error: 'Invalid characters in expression.' };
  }

  let i = 0;

  function peek() {
    return expr[i] || '';
  }

  function consume() {
    const ch = expr[i];
    i += 1;
    return ch;
  }

  function parseNumber() {
    let start = i;
    while (/\d/.test(peek())) consume();
    if (peek() === '.') {
      consume();
      if (!/\d/.test(peek()) && i === start + 1) {
        throw new Error('Invalid number.');
      }
      while (/\d/.test(peek())) consume();
    }
    if (i === start) throw new Error('Expected a number.');
    const value = Number(expr.slice(start, i));
    if (!Number.isFinite(value)) throw new Error('Invalid number.');
    return value;
  }

  function parseFactor() {
    if (peek() === '-') {
      consume();
      return -parseFactor();
    }
    if (peek() === '(') {
      consume();
      const value = parseExpression();
      if (peek() !== ')') throw new Error('Missing closing parenthesis `)`.');
      consume();
      return value;
    }
    return parseNumber();
  }

  function parseTerm() {
    let value = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const op = consume();
      const right = parseFactor();
      if (op === '*') value *= right;
      else {
        if (right === 0) throw new Error('Division by zero.');
        value /= right;
      }
    }
    return value;
  }

  function parseExpression() {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseTerm();
      if (op === '+') value += right;
      else value -= right;
    }
    return value;
  }

  try {
    const result = parseExpression();
    if (i !== expr.length) {
      return { ok: false, error: `Unexpected character near \`${expr.slice(i)}\`.` };
    }
    if (!Number.isFinite(result)) {
      return { ok: false, error: 'Result is not a finite number.' };
    }
    return { ok: true, expression: original, result };
  } catch (err) {
    return { ok: false, error: err.message || 'Could not calculate that expression.' };
  }
}

function formatMathResult(value) {
  if (Number.isInteger(value)) return String(value);
  const rounded = Math.round(value * 1e10) / 1e10;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

function buildMathCalculateEmbed(expression, result) {
  return new EmbedBuilder()
    .setColor(0x1e64c8)
    .setTitle('Calculator')
    .setDescription(`\`${expression}\`\n= **${formatMathResult(result)}**`)
    .setFooter({ text: 'ValueDex' });
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

/** channelId -> { content, messageId, generation } */
const stickyByChannel = new Map();
/** channelId -> in-flight refresh Promise */
const stickyRefreshLocks = new Map();
/** channelId -> debounce timer */
const stickyRefreshTimers = new Map();
/** Known sticky message IDs so we never autoreact / re-trigger on them */
const stickyMessageIds = new Set();
/** channelId -> emoji identifier(s) for message.react() */
const autoReactByChannel = new Map();

function normalizeReactionEmoji(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return null;

  const customMention = trimmed.match(/^<a?:([a-zA-Z0-9_]+):(\d+)>$/);
  if (customMention) return customMention[2];

  const nameId = trimmed.match(/^([a-zA-Z0-9_]+):(\d+)$/);
  if (nameId) return nameId[2];

  if (/^\d{17,20}$/.test(trimmed)) return trimmed;

  return trimmed;
}

function canAutoReactInChannel(channel) {
  if (!channel?.id) return false;
  if (typeof channel.isTextBased === 'function') {
    try {
      return Boolean(channel.isTextBased());
    } catch {
      // fall through to type check
    }
  }
  return [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
    ChannelType.GuildForum,
  ].includes(channel.type);
}

function collectAutoreactEmojis(interaction) {
  const inputs = [
    interaction.options.getString('emoji', true),
    interaction.options.getString('emoji_2'),
    interaction.options.getString('emoji_3'),
  ].filter((value) => value != null && String(value).trim());

  const emojis = [];
  const labels = [];
  for (const input of inputs) {
    const normalized = normalizeReactionEmoji(input);
    if (!normalized) continue;
    if (emojis.includes(normalized)) continue;
    emojis.push(normalized);
    labels.push(String(input).trim());
  }
  return { emojis, labels };
}

async function deleteStickyMessage(channel, messageId) {
  if (!messageId) return;
  stickyMessageIds.delete(String(messageId));
  try {
    const existing = await channel.messages.fetch(messageId);
    await existing.delete();
  } catch {
    // Already gone or missing permissions — ignore.
  }
}

async function runStickyRefresh(channel) {
  const channelId = String(channel.id);
  if (!channel?.isTextBased?.()) return;

  const run = async () => {
    const state = stickyByChannel.get(channelId);
    if (!state?.content) return;

    const generation = (state.generation || 0) + 1;
    const oldMessageId = state.messageId || null;
    state.generation = generation;
    state.messageId = null;
    stickyByChannel.set(channelId, state);

    if (oldMessageId) {
      await deleteStickyMessage(channel, oldMessageId);
    }

    const still = stickyByChannel.get(channelId);
    if (!still?.content || still.generation !== generation) return;

    const sent = await channel.send({
      content: still.content,
      allowedMentions: { parse: [] },
    });

    const afterSend = stickyByChannel.get(channelId);
    if (!afterSend?.content || afterSend.generation !== generation) {
      stickyMessageIds.delete(String(sent.id));
      await sent.delete().catch(() => {});
      return;
    }

    afterSend.messageId = sent.id;
    stickyByChannel.set(channelId, afterSend);
    stickyMessageIds.add(String(sent.id));
  };

  const previous = stickyRefreshLocks.get(channelId) || Promise.resolve();
  const next = previous.catch(() => {}).then(run);
  stickyRefreshLocks.set(channelId, next);

  try {
    await next;
  } catch (err) {
    console.error('Sticky refresh failed:', err.message || err);
  } finally {
    if (stickyRefreshLocks.get(channelId) === next) {
      stickyRefreshLocks.delete(channelId);
    }
  }
}

/** Collapse rapid chat into one sticky remount so it doesn't flicker/spam. */
function scheduleStickyRefresh(channel) {
  const channelId = String(channel.id);
  if (!stickyByChannel.has(channelId)) return;

  const existing = stickyRefreshTimers.get(channelId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    stickyRefreshTimers.delete(channelId);
    runStickyRefresh(channel).catch((err) => {
      console.error('Sticky refresh failed:', err.message || err);
    });
  }, 450);

  stickyRefreshTimers.set(channelId, timer);
}

async function setStickyForChannel(channel, content) {
  const channelId = String(channel.id);
  const previous = stickyByChannel.get(channelId);
  if (previous?.messageId) {
    await deleteStickyMessage(channel, previous.messageId);
  }

  stickyByChannel.set(channelId, {
    content,
    messageId: null,
    generation: (previous?.generation || 0) + 1,
  });

  await runStickyRefresh(channel);
}

async function clearStickyForChannel(channel) {
  const channelId = String(channel.id);
  const timer = stickyRefreshTimers.get(channelId);
  if (timer) {
    clearTimeout(timer);
    stickyRefreshTimers.delete(channelId);
  }

  const previous = stickyByChannel.get(channelId);
  stickyByChannel.delete(channelId);
  if (previous?.messageId) {
    await deleteStickyMessage(channel, previous.messageId);
  }
  return Boolean(previous);
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

function loadWelcomeConfig() {
  try {
    if (!fs.existsSync(WELCOME_CONFIG_PATH)) return {};
    const raw = JSON.parse(fs.readFileSync(WELCOME_CONFIG_PATH, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw;
  } catch (err) {
    console.warn('Could not load welcome-config.json:', err.message);
    return {};
  }
}

function saveWelcomeConfig() {
  fs.writeFileSync(WELCOME_CONFIG_PATH, JSON.stringify(welcomeByGuild, null, 2) + '\n', 'utf8');
}

function applyWelcomePlaceholders(text, member) {
  if (text == null || text === '') return text;
  const user = member.user;
  const guild = member.guild;
  const mention = `<@${member.id}>`;
  const username = user?.username || 'member';
  const displayName = member.displayName || user?.globalName || username;
  const serverName = guild?.name || 'the server';
  const memberCount = guild?.memberCount != null ? String(guild.memberCount) : '';
  return String(text)
    .replaceAll('{user}', mention)
    .replaceAll('{userMention}', mention)
    .replaceAll('{username}', username)
    .replaceAll('{displayname}', displayName)
    .replaceAll('{server}', serverName)
    .replaceAll('{membercount}', memberCount);
}

function buildWelcomeEmbed(config, member) {
  return buildCustomEmbed({
    title: applyWelcomePlaceholders(config.title, member) || null,
    description: applyWelcomePlaceholders(config.description, member),
    color: Number.isFinite(Number(config.color)) ? Number(config.color) : 0x1e64c8,
    image: config.image || null,
    thumbnail: config.thumbnail || null,
    footer: applyWelcomePlaceholders(config.footer, member) || null,
  });
}

async function sendWelcomeMessage(member) {
  if (!member?.guild?.id || member.user?.bot) return;
  const config = welcomeByGuild[String(member.guild.id)];
  if (!config?.channelId || !config?.description) return;

  let channel = member.guild.channels.cache.get(config.channelId);
  if (!channel) {
    try {
      channel = await member.guild.channels.fetch(config.channelId);
    } catch {
      console.warn(`Welcome channel ${config.channelId} not found for guild ${member.guild.id}`);
      return;
    }
  }
  if (!channel?.isTextBased?.()) return;

  const embed = buildWelcomeEmbed(config, member);
  await channel.send({
    content: `<@${member.id}>`,
    embeds: [embed],
    allowedMentions: { users: [member.id] },
  });
}

welcomeByGuild = loadWelcomeConfig();

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

async function getValueUpdateChannel() {
  const channelId = VALUE_UPDATE_CHANNEL_ID;
  if (!channelId) {
    throw new Error('DISCORD_VALUE_UPDATE_CHANNEL_ID is empty');
  }

  let channel = client.channels.cache.get(channelId) || null;
  if (!channel) {
    channel = await client.channels.fetch(channelId);
  }
  if (!channel || !channel.isTextBased()) {
    throw new Error(`Channel ${channelId} not found or not text-based`);
  }
  if (typeof channel.send !== 'function') {
    throw new Error(`Channel ${channelId} cannot receive messages`);
  }
  return channel;
}

async function postPetValueUpdate(petName, oldValues, newValues) {
  try {
    const channel = await getValueUpdateChannel();
    await channel.send({ embeds: [buildPetValueChangeEmbed(petName, oldValues, newValues)] });
    console.log(`Posted pet value update for ${petName} to #${VALUE_UPDATE_CHANNEL_ID}`);
  } catch (err) {
    console.error('Failed to post pet value update:', err.message || err);
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
    const channel = await getValueUpdateChannel();
    await channel.send({ embeds: [buildItemValueChangeEmbed(itemName, oldValue, newValue)] });
    console.log(`Posted item value update for ${itemName} to #${VALUE_UPDATE_CHANNEL_ID}`);
  } catch (err) {
    console.error('Failed to post item value update:', err.message || err);
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
      .setAutocomplete(true)
  )
  .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
  .setContexts(
    InteractionContextType.Guild,
    InteractionContextType.BotDM,
    InteractionContextType.PrivateChannel
  )
  .toJSON();

const calculateCommand = new SlashCommandBuilder()
  .setName('calculate')
  .setDescription('Evaluate a math expression (example: 60+50+40/2)')
  .addStringOption((option) =>
    option
      .setName('expression')
      .setDescription('Math formula using + - * / and parentheses')
      .setRequired(true)
      .setMaxLength(200)
  )
  .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
  .setContexts(
    InteractionContextType.Guild,
    InteractionContextType.BotDM,
    InteractionContextType.PrivateChannel
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

const acronymRemoveCommand = new SlashCommandBuilder()
  .setName('acronymremove')
  .setDescription('Remove a search acronym')
  .addStringOption((option) =>
    option.setName('acronym').setDescription('Acronym to remove (example: FD)').setRequired(true)
  )
  .toJSON();

const sayCommand = new SlashCommandBuilder()
  .setName('say')
  .setDescription('Make the bot send a message')
  .addStringOption((option) =>
    option.setName('message').setDescription('What the bot should say').setRequired(true)
  )
  .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
  .setContexts(
    InteractionContextType.Guild,
    InteractionContextType.BotDM,
    InteractionContextType.PrivateChannel
  )
  .toJSON();

const stickCommand = new SlashCommandBuilder()
  .setName('stick')
  .setDescription('Keep a message stuck as the newest in this channel')
  .addStringOption((option) =>
    option.setName('message').setDescription('Message to keep at the bottom').setRequired(true)
  )
  .toJSON();

const unstickCommand = new SlashCommandBuilder()
  .setName('unstick')
  .setDescription('Remove the sticky message from this channel')
  .toJSON();

const autoreactCommand = new SlashCommandBuilder()
  .setName('autoreact')
  .setDescription('Auto-react to every message in a channel with an emoji')
  .addStringOption((option) =>
    option
      .setName('emoji')
      .setDescription('Primary emoji to react with')
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName('emoji_2')
      .setDescription('Optional second emoji')
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName('emoji_3')
      .setDescription('Optional third emoji')
      .setRequired(false)
  )
  .addChannelOption((option) =>
    option
      .setName('channel')
      .setDescription('Channel to auto-react in (defaults to this channel)')
      .addChannelTypes(
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.GuildForum,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
        ChannelType.AnnouncementThread
      )
      .setRequired(false)
  )
  .toJSON();

const autoreactOffCommand = new SlashCommandBuilder()
  .setName('autoreactoff')
  .setDescription('Stop auto-reacting in a channel')
  .addChannelOption((option) =>
    option
      .setName('channel')
      .setDescription('Channel to stop auto-reacting in (defaults to this channel)')
      .addChannelTypes(
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.GuildForum,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
        ChannelType.AnnouncementThread
      )
      .setRequired(false)
  )
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

const welcomeSetupCommand = new SlashCommandBuilder()
  .setName('welcomesetup')
  .setDescription('Set the welcome embed that pings new members')
  .addChannelOption((option) =>
    option
      .setName('channel')
      .setDescription('Channel where welcome messages are sent')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(true)
  )
  .addStringOption((option) =>
    option.setName('description').setDescription('Embed description / body').setRequired(true)
  )
  .addStringOption((option) =>
    option.setName('title').setDescription('Embed title').setRequired(false)
  )
  .addStringOption((option) =>
    option.setName('color').setDescription('Hex color (example: #1e64c8)').setRequired(false)
  )
  .addStringOption((option) =>
    option.setName('image').setDescription('Large image URL').setRequired(false)
  )
  .addStringOption((option) =>
    option.setName('thumbnail').setDescription('Thumbnail URL').setRequired(false)
  )
  .addStringOption((option) =>
    option.setName('footer').setDescription('Footer text').setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .toJSON();

const addPetCommand = new SlashCommandBuilder()
  .setName('addpet')
  .setDescription('Add a custom pet with FR / NFR / MFR values')
  .addStringOption((option) =>
    option.setName('name').setDescription('Pet name').setRequired(true)
  )
  .addStringOption((option) =>
    option.setName('image').setDescription('Image URL').setRequired(true)
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
  .toJSON();

const addItemCommand = new SlashCommandBuilder()
  .setName('additem')
  .setDescription('Add a custom non-pet item')
  .addStringOption((option) =>
    option.setName('name').setDescription('Item name').setRequired(true)
  )
  .addStringOption((option) =>
    option.setName('image').setDescription('Image URL').setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName('category')
      .setDescription('Item category')
      .setRequired(true)
      .addChoices(...ITEM_CATEGORY_CHOICES)
  )
  .addNumberOption((option) =>
    option.setName('value').setDescription('USD Value').setRequired(true).setMinValue(0)
  )
  .toJSON();

const deletePetCommand = new SlashCommandBuilder()
  .setName('deletepet')
  .setDescription('Delete a custom pet added with /addpet')
  .addStringOption((option) =>
    option
      .setName('name')
      .setDescription('Custom pet name')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .toJSON();

const deleteItemCommand = new SlashCommandBuilder()
  .setName('deleteitem')
  .setDescription('Delete a custom item added with /additem')
  .addStringOption((option) =>
    option
      .setName('name')
      .setDescription('Custom item name')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((option) =>
    option
      .setName('category')
      .setDescription('Item category')
      .setRequired(true)
      .addChoices(...ITEM_CATEGORY_CHOICES)
  )
  .toJSON();

const helpCommand = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show all ValueDex bot commands and what they do')
  .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
  .setContexts(
    InteractionContextType.Guild,
    InteractionContextType.BotDM,
    InteractionContextType.PrivateChannel
  )
  .toJSON();

const serverInfoCommand = new SlashCommandBuilder()
  .setName('serverinfo')
  .setDescription('Show general information about this server')
  .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
  .setContexts(InteractionContextType.Guild)
  .toJSON();

const HELP_SECTIONS = [
  {
    name: 'Anywhere (servers + DMs)',
    lines: [
      'Prefix: start with `-` (shortcuts: `-v` value, `-c` calculate)',
      '`/value` or `-value` / `-v` — Show USD value for a pet or item',
      '`/calculate` or `-calculate` / `-c` — Math (example: `-c 68*7`)',
      '`/say` or `-say` — Make the bot send a message *(admin in servers)*',
      '`/help` or `-help` — Show this command list',
    ],
  },
  {
    name: 'Values (server)',
    lines: [
      '`-editpetvalue <pet> <fr> [nfr] [mfr]` *(editor)*',
      '`-edititemvalue <item> <usd>` *(editor)*',
      '`-acronymadd <acronym> <item>` *(editor)*',
      '`-acronymremove <acronym>` *(editor)*',
      '`-addpet name | image | fr | nfr | mfr` *(editor)*',
      '`-additem name | image | category | value` *(editor)*',
      '`-deletepet <name>` / `-deleteitem <name> <category>` *(editor)*',
    ],
  },
  {
    name: 'Chat tools (server)',
    lines: [
      '`-embed title | description | #color` *(admin)* — extra fields optional',
      '`-stick` / `-unstick` *(admin)*',
      '`-autoreact <emoji> [emoji2] [emoji3]` / `-autoreactoff` *(admin)*',
      '`-welcomesetup #channel description...` *(admin)*',
      '`-serverinfo`',
    ],
  },
  {
    name: 'Server',
    lines: ['`/serverinfo` or `-serverinfo` — Show general info about this server'],
  },
];

/** Global + user-installable (DMs / group DMs / servers). */
const userInstallCommands = [helpCommand, valueCommand, calculateCommand, sayCommand];

/** Guild-only tools (admin / editor / server helpers). */
const guildOnlyCommands = [
  serverInfoCommand,
  editPetValueCommand,
  editItemValueCommand,
  acronymAddCommand,
  acronymRemoveCommand,
  stickCommand,
  unstickCommand,
  autoreactCommand,
  autoreactOffCommand,
  embedCommand,
  welcomeSetupCommand,
  addPetCommand,
  addItemCommand,
  deletePetCommand,
  deleteItemCommand,
];

const allCommands = [...userInstallCommands, ...guildOnlyCommands];

async function registerCommands(readyClient) {
  const rest = new REST({ version: '10' }).setToken(token);
  const userNames = userInstallCommands.map((cmd) => `/${cmd.name}`).join(', ');
  const guildNames = guildOnlyCommands.map((cmd) => `/${cmd.name}`).join(', ');

  const guildIds = new Set(
    readyClient.guilds.cache.map((guild) => guild.id).filter(Boolean)
  );
  if (guildId) guildIds.add(String(guildId));

  // Global commands power User Install + DMs. Do not clear these on every boot.
  try {
    await rest.put(Routes.applicationCommands(clientId), { body: userInstallCommands });
    console.log(
      `Registered global (user-install) commands: ${userNames} (can take up to ~1 hour the first time)`
    );
    const listedGlobal = await rest.get(Routes.applicationCommands(clientId));
    const listedGlobalNames = (Array.isArray(listedGlobal) ? listedGlobal : [])
      .map((cmd) => `/${cmd.name}`)
      .join(', ');
    console.log(`Verified global commands on Discord: ${listedGlobalNames}`);
  } catch (err) {
    console.error('Failed to register global slash commands:', err.message || err);
  }

  if (guildIds.size === 0) {
    console.warn('No guilds available — guild-only commands were not registered.');
    return;
  }

  for (const targetGuildId of guildIds) {
    try {
      await rest.put(Routes.applicationGuildCommands(clientId, targetGuildId), {
        body: guildOnlyCommands,
      });
      const guildName = readyClient.guilds.cache.get(targetGuildId)?.name || targetGuildId;
      console.log(
        `Registered guild-only commands for ${guildName} (${targetGuildId}): ${guildNames}`
      );

      const listed = await rest.get(Routes.applicationGuildCommands(clientId, targetGuildId));
      const listedNames = (Array.isArray(listed) ? listed : []).map((cmd) => `/${cmd.name}`).join(', ');
      console.log(`Verified guild commands now on Discord: ${listedNames}`);
    } catch (err) {
      console.error(
        `Failed to register slash commands for guild ${targetGuildId}:`,
        err.message || err
      );
    }
  }
}

async function buildServerInfoEmbed(guild) {
  let ownerLabel = guild.ownerId ? `<@${guild.ownerId}>` : 'Unknown';
  try {
    const owner = await guild.fetchOwner();
    if (owner?.user) {
      ownerLabel = `${owner.user.tag} (<@${owner.id}>)`;
    }
  } catch {
    // Keep ID mention fallback if owner fetch fails.
  }

  const textChannels = guild.channels.cache.filter(
    (channel) =>
      channel.type === ChannelType.GuildText ||
      channel.type === ChannelType.GuildAnnouncement ||
      channel.type === ChannelType.GuildForum
  ).size;
  const voiceChannels = guild.channels.cache.filter(
    (channel) =>
      channel.type === ChannelType.GuildVoice ||
      channel.type === ChannelType.GuildStageVoice
  ).size;
  const categories = guild.channels.cache.filter(
    (channel) => channel.type === ChannelType.GuildCategory
  ).size;
  const boosts = guild.premiumSubscriptionCount || 0;
  const boostTier = ['None', 'Tier 1', 'Tier 2', 'Tier 3'];
  const boostTierLabel = boostTier[guild.premiumTier] || `Tier ${guild.premiumTier}`;

  const embed = new EmbedBuilder()
    .setColor(0x1e64c8)
    .setTitle(guild.name)
    .setDescription(
      [
        `**Owner:** ${ownerLabel}`,
        `**Members:** ${guild.memberCount.toLocaleString()}`,
        `**Created:** <t:${Math.floor(guild.createdTimestamp / 1000)}:D> (<t:${Math.floor(guild.createdTimestamp / 1000)}:R>)`,
        `**Channels:** ${guild.channels.cache.size} (${textChannels} text · ${voiceChannels} voice · ${categories} categories)`,
        `**Roles:** ${Math.max(0, guild.roles.cache.size - 1)}`,
        `**Boosts:** ${boosts} (${boostTierLabel})`,
        `**Server ID:** ${guild.id}`,
      ].join('\n')
    )
    .setFooter({ text: 'ValueDex' })
    .setTimestamp();

  const iconUrl = guild.iconURL({ size: 256 });
  if (iconUrl) embed.setThumbnail(iconUrl);

  return embed;
}

function buildHelpEmbed() {
  const embed = new EmbedBuilder()
    .setColor(0x1e64c8)
    .setTitle('ValueDex Commands')
    .setDescription('Slash commands for values, chat tools, and server helpers.')
    .setFooter({ text: 'ValueDex' });

  for (const section of HELP_SECTIONS) {
    embed.addFields({
      name: section.name,
      value: section.lines.join('\n'),
    });
  }

  return embed;
}

const BOT_BUILD = 'prefix-all-commands-20260918';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`valuedex bot online as ${readyClient.user.tag}`);
  console.log(`Bot build: ${BOT_BUILD}`);
  console.log(`Value update channel ID: ${VALUE_UPDATE_CHANNEL_ID}`);
  console.log(`Welcome setups loaded: ${Object.keys(welcomeByGuild).length}`);

  // Register commands first so slash commands recover even if sync is slow.
  try {
    await registerCommands(readyClient);
  } catch (err) {
    console.error('Failed to register slash commands:', err.message);
  }

  if (process.env.DISCORD_REGISTER_ONLY === '1') {
    console.log('DISCORD_REGISTER_ONLY=1 — exiting after command registration.');
    readyClient.destroy();
    process.exit(0);
    return;
  }

  try {
    await refreshOverridesFromRemote();
    await syncOverridesToSite().catch((err) => console.warn(err.message));
  } catch (err) {
    console.error('Failed to refresh overrides on startup:', err.message);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    try {
      if (interaction.commandName === 'value') {
        const focused = interaction.options.getFocused(true);
        const choices = filterNamesForAutocomplete(focused.value || '');
        await interaction.respond(choices);
      } else if (interaction.commandName === 'deletepet') {
        const focused = interaction.options.getFocused(true);
        const choices = filterCustomNamesForAutocomplete(
          focused.value || '',
          Object.keys(overrides.customPets || {})
        );
        await interaction.respond(choices);
      } else if (interaction.commandName === 'deleteitem') {
        const focused = interaction.options.getFocused(true);
        const category = interaction.options.getString('category');
        const names = Object.entries(overrides.customItems || {})
          .filter(([, entry]) => !category || entry.category === category)
          .map(([name]) => name);
        const choices = filterCustomNamesForAutocomplete(focused.value || '', names);
        await interaction.respond(choices);
      }
    } catch (err) {
      console.error('Autocomplete failed:', err.message || err);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  console.log(`Slash command received: /${interaction.commandName} [${BOT_BUILD}]`);

  try {
    if (interaction.commandName === 'help') {
      await interaction.reply({ embeds: [buildHelpEmbed()], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'serverinfo') {
      if (!interaction.guild) {
        await interaction.reply({
          content: 'This command can only be used in a server.',
          ephemeral: true,
        });
        return;
      }

      const embed = await buildServerInfoEmbed(interaction.guild);
      await interaction.reply({ embeds: [embed] });
      return;
    }

    // Handle autoreact first so Discord always gets a fast ACK.
    if (interaction.commandName === 'autoreact') {
      await interaction.deferReply({ ephemeral: true });

      if (!canAdminister(interaction)) {
        await interaction.editReply({
          content: 'You need Administrator permission to use this command.',
        });
        return;
      }

      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const { emojis, labels } = collectAutoreactEmojis(interaction);

      if (!canAutoReactInChannel(channel)) {
        await interaction.editReply({
          content: 'Pick a text channel for auto-react, or run this in a text channel.',
        });
        return;
      }

      if (!emojis.length) {
        await interaction.editReply({
          content: 'Provide at least one valid emoji (example: ✅ or a custom emoji).',
        });
        return;
      }

      autoReactByChannel.set(String(channel.id), emojis);
      await interaction.editReply({
        content: `Auto-react enabled in <#${channel.id}>. Every new message will get: ${labels.join(' ')}`,
      });
      return;
    }

    if (interaction.commandName === 'autoreactoff') {
      await interaction.deferReply({ ephemeral: true });

      if (!canAdminister(interaction)) {
        await interaction.editReply({
          content: 'You need Administrator permission to use this command.',
        });
        return;
      }

      const channel = interaction.options.getChannel('channel') || interaction.channel;
      if (!channel?.id) {
        await interaction.editReply({
          content: 'Pick a channel, or run this in a text channel.',
        });
        return;
      }

      const existed = autoReactByChannel.delete(String(channel.id));
      await interaction.editReply({
        content: existed
          ? `Auto-react disabled in <#${channel.id}>.`
          : `Auto-react was not enabled in <#${channel.id}>.`,
      });
      return;
    }

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

    if (interaction.commandName === 'calculate') {
      const expression = interaction.options.getString('expression', true);
      const evaluated = evaluateMathExpression(expression);
      if (!evaluated.ok) {
        await interaction.reply({
          content: evaluated.error,
          ephemeral: true,
        });
        return;
      }
      await interaction.reply({
        embeds: [buildMathCalculateEmbed(evaluated.expression, evaluated.result)],
      });
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
        ...(overrides.pets[petName] || {}),
        fr: frInput == null ? oldValues.fr : frInput,
        nfr: nfrInput == null ? oldValues.nfr : nfrInput,
        mfr: mfrInput == null ? oldValues.mfr : mfrInput,
      };

      overrides.pets[petName] = newValues;

      await interaction.reply({
        content: `Value of **${petName}** has been changed.`,
        embeds: [buildValueEmbed(petName)],
      });

      // Announce first — don't wait on GitHub/site sync (can hang on Railway).
      await postPetValueUpdate(petName, oldValues, newValues);
      try {
        await saveOverrides();
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

      await postItemValueUpdate(itemName, oldValue, amount);
      try {
        await saveOverrides();
      } catch (err) {
        console.error('Failed after item value reply:', err.message || err);
      }
      return;
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
      return;
    }

    if (interaction.commandName === 'acronymremove') {
      if (!canEditValues(interaction)) {
        await interaction.reply({
          content: 'You need the editor role to use this command.',
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

      if (!overrides.acronyms || typeof overrides.acronyms !== 'object') {
        overrides.acronyms = {};
      }

      const mapped = overrides.acronyms[acronym];
      if (!mapped) {
        await interaction.reply({
          content: `No acronym **${acronym}** is saved.`,
          ephemeral: true,
        });
        return;
      }

      delete overrides.acronyms[acronym];

      await interaction.reply({
        content: `Acronym **${acronym}** removed (was mapped to **${mapped}**).`,
      });

      try {
        await saveOverrides();
      } catch (err) {
        console.error('Failed after acronym remove reply:', err.message || err);
      }
      return;
    }

    if (interaction.commandName === 'say') {
      const inGuild = Boolean(interaction.guild);
      if (inGuild && !canAdminister(interaction)) {
        await interaction.reply({
          content: 'You need Administrator permission to use this command in a server.',
          ephemeral: true,
        });
        return;
      }

      const message = interaction.options.getString('message', true);

      // In servers where the bot can post, send as a normal message.
      if (inGuild && interaction.channel?.isTextBased?.()) {
        try {
          await interaction.channel.send({ content: message });
          await interaction.reply({ content: 'Sent.', ephemeral: true });
          return;
        } catch (err) {
          console.warn('channel.send failed for /say, falling back to reply:', err.message || err);
        }
      }

      // DMs / user-install / fallback: reply with the message itself.
      await interaction.reply({ content: message });
      return;
    }

    if (interaction.commandName === 'stick') {
      await interaction.deferReply({ ephemeral: true });

      if (!canAdminister(interaction)) {
        await interaction.editReply({
          content: 'You need Administrator permission to use this command.',
        });
        return;
      }

      if (!interaction.channel || !interaction.channel.isTextBased()) {
        await interaction.editReply({
          content: 'This command can only be used in a text channel.',
        });
        return;
      }

      const message = interaction.options.getString('message', true);
      await setStickyForChannel(interaction.channel, message);
      await interaction.editReply({
        content: 'Sticky set. It will stay as the newest message in this channel.',
      });
      return;
    }

    if (interaction.commandName === 'unstick') {
      await interaction.deferReply({ ephemeral: true });

      if (!canAdminister(interaction)) {
        await interaction.editReply({
          content: 'You need Administrator permission to use this command.',
        });
        return;
      }

      if (!interaction.channel || !interaction.channel.isTextBased()) {
        await interaction.editReply({
          content: 'This command can only be used in a text channel.',
        });
        return;
      }

      const existed = await clearStickyForChannel(interaction.channel);
      await interaction.editReply({
        content: existed ? 'Sticky removed.' : 'No sticky message in this channel.',
      });
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
      return;
    }

    if (interaction.commandName === 'welcomesetup') {
      if (!canAdminister(interaction)) {
        await interaction.reply({
          content: 'You need Administrator permission to use this command.',
          ephemeral: true,
        });
        return;
      }

      if (!interaction.guild) {
        await interaction.reply({
          content: 'This command can only be used in a server.',
          ephemeral: true,
        });
        return;
      }

      const channel = interaction.options.getChannel('channel', true);
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

      if (image && !isValidImageUrl(image)) {
        await interaction.reply({
          content: 'Image must be a valid http(s) URL.',
          ephemeral: true,
        });
        return;
      }

      if (thumbnail && !isValidImageUrl(thumbnail)) {
        await interaction.reply({
          content: 'Thumbnail must be a valid http(s) URL.',
          ephemeral: true,
        });
        return;
      }

      if (!channel || (typeof channel.isTextBased === 'function' && !channel.isTextBased())) {
        await interaction.reply({
          content: 'Please choose a text channel for welcome messages.',
          ephemeral: true,
        });
        return;
      }

      const config = {
        channelId: channel.id,
        title: title || null,
        description,
        color,
        image: image || null,
        thumbnail: thumbnail || null,
        footer: footer || null,
        updatedAt: Date.now(),
        updatedBy: interaction.user.id,
      };

      welcomeByGuild[String(interaction.guild.id)] = config;
      try {
        saveWelcomeConfig();
      } catch (err) {
        console.error('Failed to save welcome config:', err.message || err);
        await interaction.reply({
          content: 'Could not save welcome setup to disk. Try again.',
          ephemeral: true,
        });
        return;
      }

      const previewMember = interaction.member || {
        id: interaction.user.id,
        user: interaction.user,
        guild: interaction.guild,
        displayName: interaction.member?.displayName || interaction.user.username,
      };
      const previewEmbed = buildWelcomeEmbed(config, previewMember);

      await interaction.reply({
        content: [
          `Welcome messages will be sent in <#${channel.id}> and ping new members.`,
          'Placeholders: `{user}` `{username}` `{displayname}` `{server}` `{membercount}`',
          'Preview:',
        ].join('\n'),
        embeds: [previewEmbed],
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === 'addpet') {
      if (!canEditValues(interaction)) {
        await interaction.reply({
          content: 'You need the editor role to use this command.',
          ephemeral: true,
        });
        return;
      }

      const name = interaction.options.getString('name', true).trim();
      const image = interaction.options.getString('image', true).trim();
      const fr = interaction.options.getNumber('fr_value', true);
      const nfr = interaction.options.getNumber('nfr_value', true);
      const mfr = interaction.options.getNumber('mfr_value', true);

      if (!name) {
        await interaction.reply({ content: 'Pet name cannot be empty.', ephemeral: true });
        return;
      }
      if (!isValidImageUrl(image)) {
        await interaction.reply({
          content: 'Image must be a valid http(s) URL.',
          ephemeral: true,
        });
        return;
      }
      if (getOtherItemNames().includes(name) || overrides.customItems[name]) {
        await interaction.reply({
          content: `**${name}** already exists as a non-pet item.`,
          ephemeral: true,
        });
        return;
      }

      overrides.customPets[name] = { image, fr, nfr, mfr };
      overrides.pets[name] = { fr, nfr, mfr };

      await interaction.reply({
        content: `Added pet **${name}**.`,
        embeds: [buildValueEmbed(name)],
      });

      try {
        await saveOverrides();
      } catch (err) {
        console.error('Failed after addpet reply:', err.message || err);
      }
      return;
    }

    if (interaction.commandName === 'additem') {
      if (!canEditValues(interaction)) {
        await interaction.reply({
          content: 'You need the editor role to use this command.',
          ephemeral: true,
        });
        return;
      }

      const name = interaction.options.getString('name', true).trim();
      const image = interaction.options.getString('image', true).trim();
      const category = interaction.options.getString('category', true);
      const value = interaction.options.getNumber('value', true);

      if (!name) {
        await interaction.reply({ content: 'Item name cannot be empty.', ephemeral: true });
        return;
      }
      if (!isValidImageUrl(image)) {
        await interaction.reply({
          content: 'Image must be a valid http(s) URL.',
          ephemeral: true,
        });
        return;
      }
      if (isPet(name) || overrides.customPets[name]) {
        await interaction.reply({
          content: `**${name}** already exists as a pet. Use \`/addpet\` / value edits for pets.`,
          ephemeral: true,
        });
        return;
      }

      overrides.customItems[name] = { image, category, value };
      overrides.items[name] = value;

      await interaction.reply({
        content: `Added item **${name}** (${category}).`,
        embeds: [buildValueEmbed(name)],
      });

      try {
        await saveOverrides();
      } catch (err) {
        console.error('Failed after additem reply:', err.message || err);
      }
      return;
    }

    if (interaction.commandName === 'deletepet') {
      if (!canEditValues(interaction)) {
        await interaction.reply({
          content: 'You need the editor role to use this command.',
          ephemeral: true,
        });
        return;
      }

      const query = interaction.options.getString('name', true).trim();
      const exact =
        (overrides.customPets && overrides.customPets[query] && query) ||
        Object.keys(overrides.customPets || {}).find(
          (name) => normalizeItemKey(name) === normalizeItemKey(query)
        ) ||
        null;

      if (!exact) {
        await interaction.reply({
          content:
            `Could not find a custom pet named **${query}**. Only pets added with \`/addpet\` can be deleted.`,
          ephemeral: true,
        });
        return;
      }

      deleteCustomPet(exact);

      await interaction.reply({
        content: `Deleted custom pet **${exact}**. It is removed from the site and \`/value\`.`,
      });

      try {
        await saveOverrides();
      } catch (err) {
        console.error('Failed after deletepet reply:', err.message || err);
      }
      return;
    }

    if (interaction.commandName === 'deleteitem') {
      if (!canEditValues(interaction)) {
        await interaction.reply({
          content: 'You need the editor role to use this command.',
          ephemeral: true,
        });
        return;
      }

      const query = interaction.options.getString('name', true).trim();
      const category = interaction.options.getString('category', true);
      const exact =
        (overrides.customItems && overrides.customItems[query] && query) ||
        Object.keys(overrides.customItems || {}).find(
          (name) => normalizeItemKey(name) === normalizeItemKey(query)
        ) ||
        null;

      if (!exact) {
        await interaction.reply({
          content:
            `Could not find a custom item named **${query}**. Only items added with \`/additem\` can be deleted.`,
          ephemeral: true,
        });
        return;
      }

      const result = deleteCustomItem(exact, category);
      if (!result.ok) {
        if (result.reason === 'category') {
          await interaction.reply({
            content: `**${exact}** is in **${result.actual}**, not **${category}**.`,
            ephemeral: true,
          });
          return;
        }
        await interaction.reply({
          content: `Could not delete **${exact}**.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content: `Deleted custom item **${exact}** (${category}). It is removed from the site and \`/value\`.`,
      });

      try {
        await saveOverrides();
      } catch (err) {
        console.error('Failed after deleteitem reply:', err.message || err);
      }
      return;
    }

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: `No handler for \`/${interaction.commandName}\` on bot build \`${BOT_BUILD}\`. Redeploy the Railway bot service.`,
        ephemeral: true,
      });
    }
  } catch (err) {
    console.error('Command failed:', err);
    const message = `Something went wrong while running that command. (\`${BOT_BUILD}\`)`;
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

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    await sendWelcomeMessage(member);
  } catch (err) {
    console.error('GuildMemberAdd welcome failed:', err.message || err);
  }
});

function messageCanAdminister(message) {
  if (!message.guild) return false;
  const perms = message.member?.permissions;
  return Boolean(perms?.has?.(PermissionFlagsBits.Administrator));
}

function messageCanEditValues(message) {
  return memberHasRole(
    { guild: message.guild, member: message.member },
    editorRoleId
  );
}

async function prefixReply(message, payload) {
  return message.reply({
    allowedMentions: { repliedUser: false, parse: [] },
    ...payload,
  });
}

function splitPipeArgs(args, expectedMin) {
  const parts = String(args || '')
    .split('|')
    .map((part) => part.trim());
  if (expectedMin != null && parts.length < expectedMin) return null;
  return parts;
}

function peelTrailingNumbers(args, maxCount) {
  const parts = String(args || '').trim().split(/\s+/).filter(Boolean);
  const numbers = [];
  while (
    parts.length &&
    numbers.length < maxCount &&
    /^-?\d+(\.\d+)?$/.test(parts[parts.length - 1])
  ) {
    numbers.unshift(Number(parts.pop()));
  }
  return { nameQuery: parts.join(' ').trim(), numbers };
}

const PREFIX_COMMAND_NAMES = [
  'welcomesetup',
  'autoreactoff',
  'editpetvalue',
  'edititemvalue',
  'acronymremove',
  'acronymadd',
  'serverinfo',
  'calculate',
  'deleteitem',
  'deletepet',
  'autoreact',
  'additem',
  'addpet',
  'unstick',
  'value',
  'help',
  'say',
  'stick',
  'embed',
].sort((a, b) => b.length - a.length);

function parsePrefixInvocation(content) {
  const text = String(content || '').trim();
  if (!text.startsWith('-')) return null;
  const body = text.slice(1);

  for (const name of PREFIX_COMMAND_NAMES) {
    if (body.length < name.length) continue;
    if (body.slice(0, name.length).toLowerCase() !== name) continue;
    const after = body.slice(name.length);
    if (after !== '' && !/^\s/.test(after)) continue;
    return { name, args: after.trim() };
  }

  // Shortcuts: only value + calculate
  if (/^v(?:\s|$)/i.test(body)) {
    return { name: 'value', args: body.slice(1).trim() };
  }
  if (/^c(?:\s|$)/i.test(body)) {
    return { name: 'calculate', args: body.slice(1).trim() };
  }

  return null;
}

function normalizeReactionEmojiList(rawArgs) {
  const inputs = String(rawArgs || '')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 3);
  const emojis = [];
  const labels = [];
  for (const input of inputs) {
    const normalized = normalizeReactionEmoji(input);
    if (!normalized || emojis.includes(normalized)) continue;
    emojis.push(normalized);
    labels.push(input);
  }
  return { emojis, labels };
}

async function handlePrefixCommand(message) {
  const parsed = parsePrefixInvocation(message.content);
  if (!parsed) return false;

  const { name, args } = parsed;

  if (name === 'help') {
    await prefixReply(message, { embeds: [buildHelpEmbed()] });
    return true;
  }

  if (name === 'value') {
    if (!args) {
      await prefixReply(message, { content: 'Usage: `-value bat dragon` or `-v bat dragon`' });
      return true;
    }
    const itemName = resolveItemName(args);
    if (!itemName) {
      await prefixReply(message, {
        content: `Could not find an item named **${args}**. Try the full name (example: Rainbow Rattle).`,
      });
      return true;
    }
    await prefixReply(message, { embeds: [buildValueEmbed(itemName)] });
    return true;
  }

  if (name === 'calculate') {
    if (!args) {
      await prefixReply(message, { content: 'Usage: `-calculate 68*7` or `-c 60+50+40/2`' });
      return true;
    }
    const evaluated = evaluateMathExpression(args);
    if (!evaluated.ok) {
      await prefixReply(message, { content: evaluated.error });
      return true;
    }
    await prefixReply(message, {
      embeds: [buildMathCalculateEmbed(evaluated.expression, evaluated.result)],
    });
    return true;
  }

  if (name === 'say') {
    const inGuild = Boolean(message.guild);
    if (inGuild && !messageCanAdminister(message)) {
      await prefixReply(message, {
        content: 'You need Administrator permission to use this command in a server.',
      });
      return true;
    }
    if (!args) {
      await prefixReply(message, { content: 'Usage: `-say hello world`' });
      return true;
    }
    if (inGuild && message.channel?.isTextBased?.()) {
      try {
        await message.channel.send({ content: args });
        await prefixReply(message, { content: 'Sent.' });
        return true;
      } catch (err) {
        console.warn('prefix -say channel.send failed:', err.message || err);
      }
    }
    await prefixReply(message, { content: args });
    return true;
  }

  if (name === 'serverinfo') {
    if (!message.guild) {
      await prefixReply(message, { content: 'This command can only be used in a server.' });
      return true;
    }
    const embed = await buildServerInfoEmbed(message.guild);
    await prefixReply(message, { embeds: [embed] });
    return true;
  }

  if (name === 'stick') {
    if (!messageCanAdminister(message)) {
      await prefixReply(message, { content: 'You need Administrator permission to use this command.' });
      return true;
    }
    if (!message.guild || !message.channel?.isTextBased?.()) {
      await prefixReply(message, { content: 'This command can only be used in a server text channel.' });
      return true;
    }
    if (!args) {
      await prefixReply(message, { content: 'Usage: `-stick message to keep at the bottom`' });
      return true;
    }
    await setStickyForChannel(message.channel, args);
    await prefixReply(message, {
      content: 'Sticky set. It will stay as the newest message in this channel.',
    });
    return true;
  }

  if (name === 'unstick') {
    if (!messageCanAdminister(message)) {
      await prefixReply(message, { content: 'You need Administrator permission to use this command.' });
      return true;
    }
    if (!message.guild || !message.channel?.isTextBased?.()) {
      await prefixReply(message, { content: 'This command can only be used in a server text channel.' });
      return true;
    }
    const existed = await clearStickyForChannel(message.channel);
    await prefixReply(message, {
      content: existed ? 'Sticky removed.' : 'No sticky message in this channel.',
    });
    return true;
  }

  if (name === 'autoreact') {
    if (!messageCanAdminister(message)) {
      await prefixReply(message, { content: 'You need Administrator permission to use this command.' });
      return true;
    }
    if (!canAutoReactInChannel(message.channel)) {
      await prefixReply(message, { content: 'Use this in a text channel.' });
      return true;
    }
    const { emojis, labels } = normalizeReactionEmojiList(args);
    if (!emojis.length) {
      await prefixReply(message, {
        content: 'Usage: `-autoreact ✅` (optional 2nd/3rd emoji)',
      });
      return true;
    }
    autoReactByChannel.set(String(message.channel.id), emojis);
    await prefixReply(message, {
      content: `Auto-react enabled in <#${message.channel.id}>. Every new message will get: ${labels.join(' ')}`,
    });
    return true;
  }

  if (name === 'autoreactoff') {
    if (!messageCanAdminister(message)) {
      await prefixReply(message, { content: 'You need Administrator permission to use this command.' });
      return true;
    }
    if (!message.channel?.id) {
      await prefixReply(message, { content: 'Use this in a text channel.' });
      return true;
    }
    const existed = autoReactByChannel.delete(String(message.channel.id));
    await prefixReply(message, {
      content: existed
        ? `Auto-react disabled in <#${message.channel.id}>.`
        : `Auto-react was not enabled in <#${message.channel.id}>.`,
    });
    return true;
  }

  if (name === 'embed') {
    if (!messageCanAdminister(message)) {
      await prefixReply(message, { content: 'You need Administrator permission to use this command.' });
      return true;
    }
    if (!message.channel?.isTextBased?.()) {
      await prefixReply(message, { content: 'This command can only be used in a text channel.' });
      return true;
    }
    if (!args) {
      await prefixReply(message, {
        content: 'Usage: `-embed description` or `-embed title | description | #1e64c8 | image | thumb | footer`',
      });
      return true;
    }
    const parts = splitPipeArgs(args) || [args];
    let title = null;
    let description = args;
    let colorInput = null;
    let image = null;
    let thumbnail = null;
    let footer = null;
    if (parts.length === 1) {
      description = parts[0];
    } else {
      title = parts[0] || null;
      description = parts[1] || '';
      colorInput = parts[2] || null;
      image = parts[3] || null;
      thumbnail = parts[4] || null;
      footer = parts[5] || null;
    }
    if (!description) {
      await prefixReply(message, { content: 'Embed description is required.' });
      return true;
    }
    const color = parseEmbedColor(colorInput);
    if (color == null) {
      await prefixReply(message, { content: 'Color must be a hex code like `#1e64c8`.' });
      return true;
    }
    if (image && !isValidImageUrl(image)) {
      await prefixReply(message, { content: 'Image must be a valid http(s) URL.' });
      return true;
    }
    if (thumbnail && !isValidImageUrl(thumbnail)) {
      await prefixReply(message, { content: 'Thumbnail must be a valid http(s) URL.' });
      return true;
    }
    const embed = buildCustomEmbed({
      title,
      description,
      color,
      image,
      thumbnail,
      footer,
    });
    await message.channel.send({ embeds: [embed] });
    await prefixReply(message, { content: 'Embed sent.' });
    return true;
  }

  if (name === 'welcomesetup') {
    if (!messageCanAdminister(message)) {
      await prefixReply(message, { content: 'You need Administrator permission to use this command.' });
      return true;
    }
    if (!message.guild) {
      await prefixReply(message, { content: 'This command can only be used in a server.' });
      return true;
    }
    const match = String(args || '').match(/^(?:<#(\d+)>|(\d+))\s+([\s\S]+)$/);
    if (!match) {
      await prefixReply(message, {
        content:
          'Usage: `-welcomesetup #channel Welcome {user} to {server}!` (optional: use `/welcomesetup` for title/color/image)',
      });
      return true;
    }
    const channelId = match[1] || match[2];
    const description = match[3].trim();
    let channel = message.guild.channels.cache.get(channelId);
    if (!channel) {
      try {
        channel = await message.guild.channels.fetch(channelId);
      } catch {
        channel = null;
      }
    }
    if (!channel?.isTextBased?.()) {
      await prefixReply(message, { content: 'Please mention a valid text channel.' });
      return true;
    }
    const config = {
      channelId: channel.id,
      title: null,
      description,
      color: 0x1e64c8,
      image: null,
      thumbnail: null,
      footer: null,
      updatedAt: Date.now(),
      updatedBy: message.author.id,
    };
    welcomeByGuild[String(message.guild.id)] = config;
    try {
      saveWelcomeConfig();
    } catch (err) {
      console.error('Failed to save welcome config:', err.message || err);
      await prefixReply(message, { content: 'Could not save welcome setup to disk. Try again.' });
      return true;
    }
    const previewEmbed = buildWelcomeEmbed(config, message.member || {
      id: message.author.id,
      user: message.author,
      guild: message.guild,
      displayName: message.member?.displayName || message.author.username,
    });
    await prefixReply(message, {
      content: [
        `Welcome messages will be sent in <#${channel.id}> and ping new members.`,
        'Placeholders: `{user}` `{username}` `{displayname}` `{server}` `{membercount}`',
        'Preview:',
      ].join('\n'),
      embeds: [previewEmbed],
    });
    return true;
  }

  if (name === 'editpetvalue') {
    if (!messageCanEditValues(message)) {
      await prefixReply(message, { content: 'You need the editor role to use this command.' });
      return true;
    }
    const { nameQuery, numbers } = peelTrailingNumbers(args, 3);
    if (!nameQuery || !numbers.length) {
      await prefixReply(message, {
        content: 'Usage: `-editpetvalue Frost Dragon 67` or `-editpetvalue Frost Dragon 67 114 285`',
      });
      return true;
    }
    const petName = resolvePetOnly(nameQuery);
    if (!petName) {
      await prefixReply(message, { content: `Could not find a pet named **${nameQuery}**.` });
      return true;
    }
    const oldValues = getPetFrNfrMfr(petName);
    const newValues = {
      ...(overrides.pets[petName] || {}),
      fr: numbers[0] != null ? numbers[0] : oldValues.fr,
      nfr: numbers[1] != null ? numbers[1] : oldValues.nfr,
      mfr: numbers[2] != null ? numbers[2] : oldValues.mfr,
    };
    overrides.pets[petName] = newValues;
    await prefixReply(message, {
      content: `Value of **${petName}** has been changed.`,
      embeds: [buildValueEmbed(petName)],
    });
    await postPetValueUpdate(petName, oldValues, newValues);
    try {
      await saveOverrides();
    } catch (err) {
      console.error('Failed after prefix editpetvalue:', err.message || err);
    }
    return true;
  }

  if (name === 'edititemvalue') {
    if (!messageCanEditValues(message)) {
      await prefixReply(message, { content: 'You need the editor role to use this command.' });
      return true;
    }
    const { nameQuery, numbers } = peelTrailingNumbers(args, 1);
    if (!nameQuery || numbers.length !== 1) {
      await prefixReply(message, { content: 'Usage: `-edititemvalue Rainbow Rattle 356`' });
      return true;
    }
    const itemName = resolveNonPetItem(nameQuery);
    if (!itemName) {
      await prefixReply(message, {
        content: `Could not find a non-pet item named **${nameQuery}**. Use \`-editpetvalue\` for pets.`,
      });
      return true;
    }
    const amount = numbers[0];
    const oldValue = itemUsd(itemName);
    overrides.items[itemName] = amount;
    await prefixReply(message, {
      content: `Value of **${itemName}** has been changed.`,
      embeds: [buildValueEmbed(itemName)],
    });
    await postItemValueUpdate(itemName, oldValue, amount);
    try {
      await saveOverrides();
    } catch (err) {
      console.error('Failed after prefix edititemvalue:', err.message || err);
    }
    return true;
  }

  if (name === 'acronymadd') {
    if (!messageCanEditValues(message)) {
      await prefixReply(message, { content: 'You need the editor role to use this command.' });
      return true;
    }
    const parts = String(args || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      await prefixReply(message, { content: 'Usage: `-acronymadd FD Frost Dragon`' });
      return true;
    }
    const acronymRaw = parts[0];
    const itemQuery = parts.slice(1).join(' ');
    const itemName = resolveItemName(itemQuery);
    if (!itemName) {
      await prefixReply(message, { content: `Could not find an item named **${itemQuery}**.` });
      return true;
    }
    const acronym = normalizeItemKey(acronymRaw);
    if (!acronym) {
      await prefixReply(message, { content: 'Acronym must include at least one letter or number.' });
      return true;
    }
    const existing = overrides.acronyms[acronym];
    overrides.acronyms[acronym] = itemName;
    await prefixReply(message, {
      content:
        existing && existing !== itemName
          ? `Acronym **${acronym}** remapped from **${existing}** to **${itemName}**.`
          : `Acronym **${acronym}** added for **${itemName}**.`,
    });
    try {
      await saveOverrides();
    } catch (err) {
      console.error('Failed after prefix acronymadd:', err.message || err);
    }
    return true;
  }

  if (name === 'acronymremove') {
    if (!messageCanEditValues(message)) {
      await prefixReply(message, { content: 'You need the editor role to use this command.' });
      return true;
    }
    const acronym = normalizeItemKey(args);
    if (!acronym) {
      await prefixReply(message, { content: 'Usage: `-acronymremove FD`' });
      return true;
    }
    if (!overrides.acronyms || typeof overrides.acronyms !== 'object') overrides.acronyms = {};
    const mapped = overrides.acronyms[acronym];
    if (!mapped) {
      await prefixReply(message, { content: `No acronym **${acronym}** is saved.` });
      return true;
    }
    delete overrides.acronyms[acronym];
    await prefixReply(message, {
      content: `Acronym **${acronym}** removed (was mapped to **${mapped}**).`,
    });
    try {
      await saveOverrides();
    } catch (err) {
      console.error('Failed after prefix acronymremove:', err.message || err);
    }
    return true;
  }

  if (name === 'addpet') {
    if (!messageCanEditValues(message)) {
      await prefixReply(message, { content: 'You need the editor role to use this command.' });
      return true;
    }
    const parts = splitPipeArgs(args, 5);
    if (!parts || parts.length < 5) {
      await prefixReply(message, {
        content: 'Usage: `-addpet Pet Name | https://image.png | fr | nfr | mfr`',
      });
      return true;
    }
    const petName = parts[0].trim();
    const image = parts[1].trim();
    const fr = Number(parts[2]);
    const nfr = Number(parts[3]);
    const mfr = Number(parts[4]);
    if (!petName) {
      await prefixReply(message, { content: 'Pet name cannot be empty.' });
      return true;
    }
    if (!isValidImageUrl(image)) {
      await prefixReply(message, { content: 'Image must be a valid http(s) URL.' });
      return true;
    }
    if (![fr, nfr, mfr].every((n) => Number.isFinite(n) && n >= 0)) {
      await prefixReply(message, { content: 'FR / NFR / MFR must be valid numbers ≥ 0.' });
      return true;
    }
    if (getOtherItemNames().includes(petName) || overrides.customItems[petName]) {
      await prefixReply(message, {
        content: `**${petName}** already exists as a non-pet item.`,
      });
      return true;
    }
    overrides.customPets[petName] = { image, fr, nfr, mfr };
    overrides.pets[petName] = { fr, nfr, mfr };
    syncAmvggOverrides();
    await prefixReply(message, {
      content: `Added custom pet **${petName}**.`,
      embeds: [buildValueEmbed(petName)],
    });
    try {
      await saveOverrides();
    } catch (err) {
      console.error('Failed after prefix addpet:', err.message || err);
    }
    return true;
  }

  if (name === 'additem') {
    if (!messageCanEditValues(message)) {
      await prefixReply(message, { content: 'You need the editor role to use this command.' });
      return true;
    }
    const parts = splitPipeArgs(args, 4);
    if (!parts || parts.length < 4) {
      await prefixReply(message, {
        content:
          'Usage: `-additem Item Name | https://image.png | toys | 12` (categories: pet-wear, strollers, food, vehicles, toys, gifts, stickers, houses)',
      });
      return true;
    }
    const itemName = parts[0].trim();
    const image = parts[1].trim();
    const category = parts[2].trim().toLowerCase();
    const value = Number(parts[3]);
    const validCategories = new Set(ITEM_CATEGORY_CHOICES.map((c) => c.value));
    if (!itemName) {
      await prefixReply(message, { content: 'Item name cannot be empty.' });
      return true;
    }
    if (!isValidImageUrl(image)) {
      await prefixReply(message, { content: 'Image must be a valid http(s) URL.' });
      return true;
    }
    if (!validCategories.has(category)) {
      await prefixReply(message, {
        content: `Invalid category **${category}**. Use one of: ${[...validCategories].join(', ')}`,
      });
      return true;
    }
    if (!Number.isFinite(value) || value < 0) {
      await prefixReply(message, { content: 'Value must be a number ≥ 0.' });
      return true;
    }
    if (isPet(itemName) || overrides.customPets[itemName]) {
      await prefixReply(message, {
        content: `**${itemName}** already exists as a pet. Use \`-addpet\` / value edits for pets.`,
      });
      return true;
    }
    overrides.customItems[itemName] = { image, category, value };
    overrides.items[itemName] = value;
    syncAmvggOverrides();
    await prefixReply(message, {
      content: `Added custom item **${itemName}**.`,
      embeds: [buildValueEmbed(itemName)],
    });
    try {
      await saveOverrides();
    } catch (err) {
      console.error('Failed after prefix additem:', err.message || err);
    }
    return true;
  }

  if (name === 'deletepet') {
    if (!messageCanEditValues(message)) {
      await prefixReply(message, { content: 'You need the editor role to use this command.' });
      return true;
    }
    if (!args) {
      await prefixReply(message, { content: 'Usage: `-deletepet Custom Pet Name`' });
      return true;
    }
    const exact =
      (overrides.customPets && overrides.customPets[args] && args) ||
      Object.keys(overrides.customPets || {}).find(
        (petName) => petName.toLowerCase() === args.toLowerCase()
      );
    if (!exact) {
      await prefixReply(message, {
        content: `No custom pet named **${args}**. Only pets added with \`-addpet\` / \`/addpet\` can be deleted.`,
      });
      return true;
    }
    const result = deleteCustomPet(exact);
    if (!result.ok) {
      await prefixReply(message, { content: `Could not delete **${exact}**.` });
      return true;
    }
    await prefixReply(message, {
      content: `Deleted custom pet **${exact}**. It is removed from the site and \`/value\`.`,
    });
    try {
      await saveOverrides();
    } catch (err) {
      console.error('Failed after prefix deletepet:', err.message || err);
    }
    return true;
  }

  if (name === 'deleteitem') {
    if (!messageCanEditValues(message)) {
      await prefixReply(message, { content: 'You need the editor role to use this command.' });
      return true;
    }
    const parts = String(args || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      await prefixReply(message, {
        content: 'Usage: `-deleteitem Item Name toys` (category last)',
      });
      return true;
    }
    const category = parts[parts.length - 1].toLowerCase();
    const itemQuery = parts.slice(0, -1).join(' ');
    const validCategories = new Set(ITEM_CATEGORY_CHOICES.map((c) => c.value));
    if (!validCategories.has(category)) {
      await prefixReply(message, {
        content: `Invalid category **${category}**. Use one of: ${[...validCategories].join(', ')}`,
      });
      return true;
    }
    const exact =
      (overrides.customItems && overrides.customItems[itemQuery] && itemQuery) ||
      Object.keys(overrides.customItems || {}).find(
        (itemName) => itemName.toLowerCase() === itemQuery.toLowerCase()
      );
    if (!exact) {
      await prefixReply(message, {
        content: `No custom item named **${itemQuery}**.`,
      });
      return true;
    }
    const result = deleteCustomItem(exact, category);
    if (!result.ok) {
      if (result.reason === 'category') {
        await prefixReply(message, {
          content: `**${exact}** is in **${result.actual}**, not **${category}**.`,
        });
        return true;
      }
      await prefixReply(message, { content: `Could not delete **${exact}**.` });
      return true;
    }
    await prefixReply(message, {
      content: `Deleted custom item **${exact}** (${category}). It is removed from the site and \`/value\`.`,
    });
    try {
      await saveOverrides();
    } catch (err) {
      console.error('Failed after prefix deleteitem:', err.message || err);
    }
    return true;
  }

  return false;
}

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.system) return;
    if (client.user && message.author.id === client.user.id) return;
    if (message.author.bot) return;

    // Ignore sticky remounts completely (no react, no re-stick loop).
    if (stickyMessageIds.has(String(message.id))) return;

    if (await handlePrefixCommand(message)) return;

    // Sticky + autoreact are server-channel features only.
    if (!message.guild) return;

    const channelId = String(message.channel.id);

    const autoEmojis = autoReactByChannel.get(channelId);
    if (Array.isArray(autoEmojis) && autoEmojis.length) {
      // Fire reactions without blocking sticky scheduling.
      void (async () => {
        for (const emoji of autoEmojis) {
          try {
            await message.react(emoji);
          } catch (err) {
            console.error('Autoreact failed:', err.message || err);
          }
        }
      })();
    }

    if (stickyByChannel.has(channelId)) {
      scheduleStickyRefresh(message.channel);
    }
  } catch (err) {
    console.error('MessageCreate handler failed:', err.message || err);
  }
});

if (
  require.main === module &&
  (process.env.PORT || process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_ID)
) {
  const http = require('http');
  const port = Number(process.env.PORT) || 8080;
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          service: 'ValueDex Discord bot',
          build: BOT_BUILD,
          loggedIn: Boolean(client.user),
          user: client.user ? client.user.tag : null,
          commands: allCommands.map((cmd) => cmd.name),
          autoreactChannels: autoReactByChannel.size,
        })
      );
    })
    .listen(port, () => {
      console.log(`Bot health check listening on :${port} (${BOT_BUILD})`);
    });
}

// Always log in unless an explicit register-only script opts out.
// (Must work when required from local-server.js on Railway too.)
if (process.env.DISCORD_SKIP_LOGIN !== '1') {
  client.login(token).catch((err) => {
    console.error('Failed to log in. Check your bot token.', err.message);
    process.exit(1);
  });
}

module.exports = {
  allCommands,
  userInstallCommands,
  guildOnlyCommands,
  registerCommands,
  BOT_BUILD,
  client,
};
