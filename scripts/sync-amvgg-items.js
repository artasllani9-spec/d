/**
 * Sync missing AMVGG value-list items into public/pets-data.js
 * and reorder each category to match AMVGG.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'public', 'pets-data.js');
const CACHE_DIR = path.join(process.env.TEMP || '/tmp', 'amvgg-sync');

const CATEGORIES = [
  { slug: 'pets', constName: 'PETS_ORDER' },
  { slug: 'petwear', constName: 'PET_WEAR_ORDER' },
  { slug: 'strollers', constName: 'STROLLERS_ORDER' },
  { slug: 'food', constName: 'FOOD_ORDER' },
  { slug: 'vehicles', constName: 'VEHICLES_ORDER' },
  { slug: 'toys', constName: 'TOYS_ORDER' },
  { slug: 'gifts', constName: 'GIFTS_ORDER' },
  { slug: 'stickers', constName: 'STICKERS_ORDER' },
  { slug: 'houses', constName: 'HOUSES_ORDER' },
];

const SKIP_NAMES = new Set([
  'Baseless',
  'Frost',
  'Ride Pot',
  'Adopt Me Values',
]);

function decodeEntities(text) {
  return String(text)
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function extractNames(html) {
  const names = [];
  const seen = new Set();

  const titleRe = /title="([^"]+)"\s*>[\s\S]*?<\/h2>/gi;
  let match;
  while ((match = titleRe.exec(html))) {
    const name = decodeEntities(match[1]);
    if (!name || SKIP_NAMES.has(name) || seen.has(name)) continue;
    if (/^View .+ details$/i.test(name)) continue;
    seen.add(name);
    names.push(name);
  }

  if (names.length < 10) {
    const altRe = /<img[^>]+alt="([^"]+)"[^>]*>/gi;
    while ((match = altRe.exec(html))) {
      const name = decodeEntities(match[1]);
      if (!name || SKIP_NAMES.has(name) || seen.has(name)) continue;
      if (name.length < 2 || name.length > 80) continue;
      seen.add(name);
      names.push(name);
    }
  }

  return names;
}

const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function fetchHtml(slug) {
  const cachePath = path.join(CACHE_DIR, `${slug}.html`);
  if (fs.existsSync(cachePath)) {
    const age = Date.now() - fs.statSync(cachePath).mtimeMs;
    if (age < CACHE_MAX_AGE_MS && fs.statSync(cachePath).size > 1000) {
      return Promise.resolve(fs.readFileSync(cachePath, 'utf8'));
    }
  }
  return new Promise((resolve, reject) => {
    https.get(`https://amvgg.com/values/${slug}`, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf8');
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(cachePath, html);
        resolve(html);
      });
    }).on('error', reject);
  });
}

function parseOrderArray(source, constName) {
  const re = new RegExp(`const ${constName} = \\[([\\s\\S]*?)\\];`);
  const match = source.match(re);
  if (!match) throw new Error(`Could not find ${constName}`);
  const body = match[1];
  const items = [];
  const itemRe = /'((?:\\'|[^'])*)'|"((?:\\"|[^"])*)"/g;
  let m;
  while ((m = itemRe.exec(body))) {
    const raw = m[1] != null ? m[1] : m[2];
    items.push(raw.replace(/\\'/g, "'").replace(/\\"/g, '"'));
  }
  return { items, fullMatch: match[0], start: match.index, end: match.index + match[0].length };
}

function quoteName(name) {
  if (name.includes("'") && !name.includes('"')) return `"${name}"`;
  return `'${name.replace(/'/g, "\\'")}'`;
}

function formatOrderArray(constName, items) {
  const lines = items.map((name) => `  ${quoteName(name)},`);
  return `const ${constName} = [\n${lines.join('\n')}\n];`;
}

function normalizeKey(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`´]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/** Map known AMVGG names -> our existing names when they differ slightly. */
const ALIASES = new Map(
  Object.entries({
    'Halloween Black Axe Guitar Accessory': 'Halloween Black Axe Guitar',
    'Candy Cane (Pet Wear)': 'Candy Cane',
    'Tio De Nadal': 'Tio De Nadal',
  }).map(([from, to]) => [normalizeKey(from), to]),
);

function resolveExisting(amvName, ourByNorm) {
  const aliased = ALIASES.get(normalizeKey(amvName));
  if (aliased && ourByNorm.has(normalizeKey(aliased))) {
    return ourByNorm.get(normalizeKey(aliased));
  }
  return ourByNorm.get(normalizeKey(amvName)) || null;
}

async function main() {
  let source = fs.readFileSync(DATA_PATH, 'utf8');
  const report = [];

  for (const cat of CATEGORIES) {
    const html = await fetchHtml(cat.slug);
    const amvNames = extractNames(html);
    if (amvNames.length < 5) {
      throw new Error(`${cat.slug}: only extracted ${amvNames.length} names`);
    }

    const parsed = parseOrderArray(source, cat.constName);
    const ourItems = parsed.items;
    const ourByNorm = new Map();
    for (const name of ourItems) {
      ourByNorm.set(normalizeKey(name), name);
    }

    const usedOurs = new Set();
    const nextOrder = [];
    const added = [];

    for (const amvName of amvNames) {
      const existing = resolveExisting(amvName, ourByNorm);
      if (existing) {
        if (!usedOurs.has(existing)) {
          nextOrder.push(existing);
          usedOurs.add(existing);
        }
      } else {
        nextOrder.push(amvName);
        added.push(amvName);
      }
    }

    // Keep our exclusives at the end, preserving relative order.
    const extras = ourItems.filter((name) => !usedOurs.has(name));
    nextOrder.push(...extras);

    const replacement = formatOrderArray(cat.constName, nextOrder);
    source = source.slice(0, parsed.start) + replacement + source.slice(parsed.end);

    report.push({
      category: cat.slug,
      amvCount: amvNames.length,
      ourBefore: ourItems.length,
      ourAfter: nextOrder.length,
      addedCount: added.length,
      extrasKept: extras.length,
      added,
      extras,
    });

    // Eggs in pets should be in PETS_NO_POTIONS
    if (cat.slug === 'pets' && added.length) {
      const noPotionsMatch = source.match(/const PETS_NO_POTIONS = new Set\(\[([\s\S]*?)\]\);/);
      if (noPotionsMatch) {
        const existingNoPotions = new Set();
        const itemRe = /'((?:\\'|[^'])*)'|"((?:\\"|[^"])*)"/g;
        let m;
        while ((m = itemRe.exec(noPotionsMatch[1]))) {
          existingNoPotions.add((m[1] != null ? m[1] : m[2]).replace(/\\'/g, "'"));
        }
        const eggsToAdd = added.filter((n) => /\begg\b/i.test(n) && !existingNoPotions.has(n));
        if (eggsToAdd.length) {
          const insertAt = noPotionsMatch.index + noPotionsMatch[0].lastIndexOf(']');
          const lines = eggsToAdd.map((n) => `\n  ${quoteName(n)},`).join('');
          source = source.slice(0, insertAt) + lines + source.slice(insertAt);
          report[report.length - 1].eggsNoPotions = eggsToAdd;
        }
      }
    }
  }

  fs.writeFileSync(DATA_PATH, source);
  console.log(JSON.stringify(report, null, 2));
  const totalAdded = report.reduce((sum, r) => sum + r.addedCount, 0);
  console.log(`\nTotal added: ${totalAdded}`);

  const allAdded = report.flatMap((r) => r.added);
  if (allAdded.length) {
    const { spawnSync } = require('child_process');
    const result = spawnSync(process.execPath, [
      path.join(__dirname, 'fetch-amvgg-images.js'),
      ...allAdded,
    ], { stdio: 'inherit' });
    if (result.status !== 0) {
      process.exit(result.status || 1);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
