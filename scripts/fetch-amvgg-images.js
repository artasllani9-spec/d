/**
 * Download item images from AMVGG HTML cache and register in pets-data.js maps.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'public', 'pets-data.js');
const PETS_DIR = path.join(ROOT, 'public', 'pets');
const CACHE_DIR = path.join(process.env.TEMP || '/tmp', 'amvgg-sync');

const CATEGORY_MAPS = {
  pets: 'PET_IMAGES',
  petwear: 'PET_WEAR_IMAGES',
};

function decodeEntities(text) {
  return String(text)
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .trim();
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[''`´]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractImageMap(html) {
  const map = new Map();
  const re = /<img[^>]+alt="([^"]+)"[^>]+src="(\/items\/[^"]+)"/gi;
  let match;
  while ((match = re.exec(html))) {
    const name = decodeEntities(match[1]);
    if (!name || name === 'Fly' || name === 'Ride') continue;
    map.set(name, match[2]);
  }
  return map;
}

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        download(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function parseObjectMap(source, constName) {
  const re = new RegExp(`const ${constName} = \\{([\\s\\S]*?)\\n\\};`);
  const match = source.match(re);
  if (!match) return null;
  const entries = new Map();
  const lineRe = /^\s*(['"])((?:\\.|(?!\1).)*)\1:\s*(['"])(.*?)\3,?\s*$/gm;
  let m;
  while ((m = lineRe.exec(match[1]))) {
    const key = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"');
    entries.set(key, m[4]);
  }
  return { entries, fullMatch: match[0], start: match.index, end: match.index + match[0].length };
}

function formatObjectMap(constName, entries) {
  const lines = Array.from(entries.entries()).map(([key, value]) => {
    const q = key.includes("'") && !key.includes('"') ? '"' : "'";
    const escapedKey = key.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), `\\${q}`);
    return `  ${q}${escapedKey}${q}: '${value.replace(/'/g, "\\'")}',`;
  });
  return `const ${constName} = {\n${lines.join('\n')}\n};`;
}

function insertEntries(source, constName, newEntries) {
  const parsed = parseObjectMap(source, constName);
  if (!parsed) throw new Error(`Missing ${constName}`);
  for (const [key, value] of newEntries) {
    if (!parsed.entries.has(key)) parsed.entries.set(key, value);
  }
  const replacement = formatObjectMap(constName, parsed.entries);
  return source.slice(0, parsed.start) + replacement + source.slice(parsed.end);
}

async function main() {
  const namesArg = process.argv.slice(2);
  let source = fs.readFileSync(DATA_PATH, 'utf8');
  const added = [];

  for (const [slug, mapName] of Object.entries(CATEGORY_MAPS)) {
    const cachePath = path.join(CACHE_DIR, `${slug}.html`);
    if (!fs.existsSync(cachePath)) continue;
    const html = fs.readFileSync(cachePath, 'utf8');
    const images = extractImageMap(html);
    const targets = namesArg.length
      ? namesArg
      : Array.from(images.keys());

    for (const name of targets) {
      const srcPath = images.get(name);
      if (!srcPath) continue;
      const fileName = `${slugify(name)}.webp`;
      const localRel = `pets/${fileName}`;
      const localAbs = path.join(PETS_DIR, fileName);
      if (fs.existsSync(localAbs)) continue;

      const url = `https://amvgg.com${srcPath}`;
      try {
        const data = await download(url);
        fs.writeFileSync(localAbs, data);
        added.push({ name, mapName, localRel });
        console.log(`saved ${name} -> ${localRel}`);
      } catch (err) {
        console.warn(`skip ${name}: ${err.message}`);
      }
    }
  }

  if (!added.length) {
    console.log('No new images downloaded.');
    return;
  }

  const byMap = new Map();
  for (const item of added) {
    if (!byMap.has(item.mapName)) byMap.set(item.mapName, []);
    byMap.get(item.mapName).push([item.name, item.localRel]);
  }

  for (const [mapName, entries] of byMap) {
    source = insertEntries(source, mapName, entries);
  }

  fs.writeFileSync(DATA_PATH, source);
  console.log(`Updated ${added.length} image map entries.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
