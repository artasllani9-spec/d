/**
 * Scrape AMVGG values + demand, compute USD prices, write public/amvgg-usd-values.js
 * Pets store per-version frost/demand data; other categories use flat USD.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'public', 'amvgg-usd-values.js');
const COEF_PATH = path.join(__dirname, 'amvgg-category-coefficients.json');

const NON_PET_CATEGORIES = [
  'eggs',
  'petwear',
  'strollers',
  'food',
  'vehicles',
  'toys',
  'gifts',
  'stickers',
  'houses',
];

const DEMAND_MULTIPLIER = {
  3: 60,
  2: 57,
  1: 54,
};

const DEMAND_STARS = {
  High: 3,
  Medium: 2,
  Low: 1,
  Decent: 1,
};

const USD_SCALE = 1.7;

const PET_NUMERIC_FIELDS = [
  'regularValue',
  'neonValue',
  'megaValue',
  'npRegularValue',
  'npNeonValue',
  'npMegaValue',
  'rValue',
  'fValue',
  'nrValue',
  'nfValue',
  'mrValue',
  'mfValue',
];

const PET_DEMAND_FIELDS = [
  'regularDemand',
  'neonDemand',
  'megaDemand',
  'npRegularDemand',
  'npNeonDemand',
  'npMegaDemand',
  'rDemand',
  'fDemand',
  'nrDemand',
  'nfDemand',
  'mrDemand',
  'mfDemand',
];

const RUNTIME_HELPERS = String.raw`
const AMVGG_DEMAND_STARS = ${JSON.stringify(DEMAND_STARS, null, 2)};
const AMVGG_DEMAND_MULTIPLIER = ${JSON.stringify(DEMAND_MULTIPLIER, null, 2)};
const AMVGG_USD_SCALE = ${USD_SCALE};

function roundUsd(raw) {
  if (!Number.isFinite(raw)) return null;
  if (raw >= 50) return Math.round(raw);
  if (raw >= 10) return Math.ceil(raw * 2) / 2;
  return Math.ceil(raw * 10) / 10;
}

function computeUsdFromFrost(frostValue, demandStars) {
  const multiplier = AMVGG_DEMAND_MULTIPLIER[demandStars];
  if (!multiplier || !Number.isFinite(frostValue)) return null;
  return roundUsd((frostValue * multiplier) / AMVGG_USD_SCALE);
}

function buildPotionKey(potions) {
  const fly = potions && potions.fly;
  const ride = potions && potions.ride;
  const neon = potions && potions.neon;
  const mega = potions && potions.mega;
  return (mega ? 'm' : '') + (neon ? 'n' : '') + (fly ? 'f' : '') + (ride ? 'r' : '');
}

function computeCategoryValues(category, regular, neon, mega, coefficients) {
  const coef = coefficients[String(category)];
  if (!coef) return null;

  const precision = [4, 4];
  if (regular >= 0.0175) precision[0] = 3;
  if (category === 11 && regular > 0.08) {
    return {
      NP: Number((0.95 * regular).toFixed(precision[0])),
      R: Number((0.975 * regular).toFixed(precision[0])),
      F: Number((0.975 * regular).toFixed(precision[0])),
      NNP: Number((neon * coef.NNP).toFixed(precision[1])),
      NR: neon > 0.2 ? neon : Number((neon * coef.NR).toFixed(precision[1])),
      NF: neon > 0.2 ? neon : Number((neon * coef.NF).toFixed(precision[1])),
      MNP: Number((mega * coef.MNP).toFixed(precision[1])),
      MR: mega > 0.9 ? mega : Number((mega * coef.MR).toFixed(precision[1])),
      MF: mega > 0.9 ? mega : Number((mega * coef.MF).toFixed(precision[1])),
    };
  }

  return {
    NP: Number((regular * coef.NP).toFixed(precision[0])),
    R: Number((regular * coef.R).toFixed(precision[0])),
    F: Number((regular * coef.F).toFixed(precision[0])),
    NNP: Number((neon * coef.NNP).toFixed(precision[1])),
    NR: Number((neon * coef.NR).toFixed(precision[1])),
    NF: Number((neon * coef.NF).toFixed(precision[1])),
    MNP: Number((mega * coef.MNP).toFixed(precision[1])),
    MR: Number((mega * coef.MR).toFixed(precision[1])),
    MF: Number((mega * coef.MF).toFixed(precision[1])),
  };
}

function getPetFrostValue(pet, potions) {
  const key = buildPotionKey(potions);
  if (pet.category === 13) {
    switch (key) {
      case 'fr':
      default:
        return pet.regularValue;
      case 'r':
        return pet.rValue;
      case 'f':
        return pet.fValue;
      case '':
        return pet.npRegularValue;
      case 'nfr':
        return pet.neonValue;
      case 'nr':
        return pet.nrValue;
      case 'nf':
        return pet.nfValue;
      case 'n':
        return pet.npNeonValue;
      case 'mfr':
        return pet.megaValue;
      case 'mr':
        return pet.mrValue;
      case 'mf':
        return pet.mfValue;
      case 'm':
        return pet.npMegaValue;
    }
  }

  const computed = computeCategoryValues(
    pet.category,
    pet.regularValue,
    pet.neonValue,
    pet.megaValue,
    AMVGG_CATEGORY_COEFFICIENTS
  );
  if (!computed) return pet.regularValue;

  switch (key) {
    case 'fr':
    default:
      return pet.regularValue;
    case 'r':
      return computed.R;
    case 'f':
      return computed.F;
    case '':
      return computed.NP;
    case 'nfr':
      return pet.neonValue;
    case 'nr':
      return computed.NR;
    case 'nf':
      return computed.NF;
    case 'n':
      return computed.NNP;
    case 'mfr':
      return pet.megaValue;
    case 'mr':
      return computed.MR;
    case 'mf':
      return computed.MF;
    case 'm':
      return computed.MNP;
  }
}

function getPetDemandLabel(pet, potions) {
  const key = buildPotionKey(potions);
  if (pet.category === 13) {
    switch (key) {
      case 'fr':
      default:
        return pet.regularDemand;
      case 'r':
        return pet.rDemand;
      case 'f':
        return pet.fDemand;
      case '':
        return pet.npRegularDemand;
      case 'nfr':
        return pet.neonDemand;
      case 'nr':
        return pet.nrDemand;
      case 'nf':
        return pet.nfDemand;
      case 'n':
        return pet.npNeonDemand;
      case 'mfr':
        return pet.megaDemand;
      case 'mr':
        return pet.mrDemand;
      case 'mf':
        return pet.mfDemand;
      case 'm':
        return pet.npMegaDemand;
    }
  }

  if (potions && potions.neon) return pet.neonDemand;
  if (potions && potions.mega) return pet.megaDemand;
  return pet.regularDemand;
}

function getPetUsdValue(pet, potions) {
  const frost = getPetFrostValue(pet, potions);
  const demandLabel = getPetDemandLabel(pet, potions);
  const demandStars = AMVGG_DEMAND_STARS[demandLabel] || 0;
  return computeUsdFromFrost(frost, demandStars);
}
`;

function decodeEntities(text) {
  return String(text)
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .trim();
}

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

function parseDemandStars(demandHtml) {
  const match = demandHtml.match(/text-yellow-400">([^<]*)</);
  if (!match) return 0;
  return [...match[1]].filter((ch) => ch === '★').length;
}

function getEscapedField(block, key, type = 'string') {
  if (type === 'number') {
    const m = block.match(new RegExp(`\\\\"${key}\\\\":(\\d+)`));
    return m ? Number(m[1]) : null;
  }
  const m = block.match(new RegExp(`\\\\"${key}\\\\":\\\\"([^\\\\"]*)\\\\"`));
  return m ? m[1] : null;
}

function getEscapedNumberField(block, key) {
  const quoted = getEscapedField(block, key, 'string');
  if (quoted == null || quoted === 'null') return null;
  const num = Number(quoted);
  return Number.isFinite(num) ? num : null;
}

function extractPetsFromHtml(html) {
  const pets = [];
  const seen = new Set();
  const parts = html.split('\\"name\\":\\"');

  for (let i = 1; i < parts.length; i++) {
    const nameEnd = parts[i].indexOf('\\"');
    const name = parts[i].slice(0, nameEnd);
    if (!name || name.length > 80 || seen.has(name)) continue;

    const block = parts[i].slice(0, 2500);
    if (!block.includes('regularValue')) continue;

    seen.add(name);
    const pet = { name, category: getEscapedField(block, 'category', 'number') };

    for (const field of PET_NUMERIC_FIELDS) {
      const value = getEscapedNumberField(block, field);
      if (value != null) pet[field] = value;
    }
    for (const field of PET_DEMAND_FIELDS) {
      const value = getEscapedField(block, field, 'string');
      if (value) pet[field] = value;
    }

    pets.push(pet);
  }

  return pets;
}

function extractItems(html) {
  const items = [];
  const seen = new Set();
  const cardRe = /title="([^"]+)"[^>]*>[\s\S]*?Value<\/span><span[^>]*class="[^"]*tabular-nums[^"]*"[^>]*>([0-9.]+)<\/span>[\s\S]*?Demand<\/span><span[^>]*>([\s\S]*?)<\/span>\s*<\/div>/gi;
  let match;
  while ((match = cardRe.exec(html))) {
    const name = decodeEntities(match[1]);
    if (!name || seen.has(name)) continue;
    if (/^View .+ details$/i.test(name)) continue;
    seen.add(name);
    items.push({
      name,
      frostValue: parseFloat(match[2]),
      demand: parseDemandStars(match[3]),
    });
  }
  return items;
}

function roundUsd(raw) {
  if (!Number.isFinite(raw)) return null;
  if (raw >= 50) return Math.round(raw);
  if (raw >= 10) return Math.ceil(raw * 2) / 2;
  return Math.ceil(raw * 10) / 10;
}

function computeUsd(frostValue, demand) {
  const multiplier = DEMAND_MULTIPLIER[demand];
  if (!multiplier || !Number.isFinite(frostValue)) return null;
  return roundUsd((frostValue * multiplier) / USD_SCALE);
}

function quoteName(name) {
  if (name.includes("'") && !name.includes('"')) return `"${name}"`;
  return `'${name.replace(/'/g, "\\'")}'`;
}

function serializePetPricing(pet) {
  const keys = ['category', ...PET_NUMERIC_FIELDS, ...PET_DEMAND_FIELDS];
  const parts = [];
  for (const key of keys) {
    if (pet[key] == null) continue;
    if (typeof pet[key] === 'number') parts.push(`${key}: ${pet[key]}`);
    else parts.push(`${key}: ${quoteName(pet[key])}`);
  }
  return `  ${quoteName(pet.name)}: { ${parts.join(', ')} }`;
}

async function fetchCategoryCoefficients() {
  const js = await fetchHtml('https://amvgg.com/_next/static/chunks/app/values/pets/page-4121cf981235d276.js');
  const match = js.match(/134:e=>\{"use strict";e\.exports=JSON\.parse\('(.+?)'\)/);
  if (!match) throw new Error('Could not extract AMVGG category coefficients');
  return JSON.parse(match[1].replace(/\\'/g, "'"));
}

async function main() {
  let coefficients;
  try {
    coefficients = await fetchCategoryCoefficients();
    fs.writeFileSync(COEF_PATH, JSON.stringify(coefficients, null, 2));
  } catch (err) {
    console.warn('Using cached coefficients:', err.message);
    coefficients = JSON.parse(fs.readFileSync(COEF_PATH, 'utf8'));
  }

  const usdByName = {};
  const report = [];

  const petsHtml = await fetchHtml('https://amvgg.com/values/pets');
  const pets = extractPetsFromHtml(petsHtml);
  if (pets.length < 100) {
    throw new Error(`pets: only parsed ${pets.length} entries`);
  }
  report.push({ slug: 'pets', total: pets.length, withUsd: pets.length });
  console.log(`pets: ${pets.length} variant-aware entries`);

  for (const slug of NON_PET_CATEGORIES) {
    const html = await fetchHtml(`https://amvgg.com/values/${slug}`);
    const items = extractItems(html);
    if (items.length < 3) {
      throw new Error(`${slug}: only parsed ${items.length} items`);
    }

    let withUsd = 0;
    for (const item of items) {
      const usd = computeUsd(item.frostValue, item.demand);
      if (usd == null) continue;
      usdByName[item.name] = usd;
      withUsd += 1;
    }

    report.push({ slug, total: items.length, withUsd });
    console.log(`${slug}: ${withUsd}/${items.length} priced`);
  }

  const petLines = pets
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(serializePetPricing);

  const usdLines = Object.entries(usdByName)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, usd]) => `  ${quoteName(name)}: ${usd},`);

  const file = `// Auto-generated by scripts/sync-amvgg-usd-values.js — do not edit by hand
// Pets: AMVGG frost values per F/R/N/M version × demand multiplier (3★=60, 2★=57, 1★=54), then ÷ 1.7
// Other categories: flat USD from list page (F+R default)
const AMVGG_CATEGORY_COEFFICIENTS = ${JSON.stringify(coefficients, null, 2)};

const AMVGG_PET_PRICING = {
${petLines.join(',\n')}
};

const AMVGG_USD_VALUES = {
${usdLines.join('\n')}
};

${RUNTIME_HELPERS}

function formatUsdValue(amount) {
  if (amount == null || !Number.isFinite(amount)) return '—';
  if (Number.isInteger(amount)) return '$' + amount.toLocaleString('en-US');
  return '$' + amount.toFixed(1);
}

function getAmvggUsdValue(itemName, potions) {
  if (Object.prototype.hasOwnProperty.call(AMVGG_PET_PRICING, itemName)) {
    return getPetUsdValue(AMVGG_PET_PRICING[itemName], potions || { fly: true, ride: true, neon: false, mega: false });
  }
  return Object.prototype.hasOwnProperty.call(AMVGG_USD_VALUES, itemName)
    ? AMVGG_USD_VALUES[itemName]
    : null;
}

function getTradeItemUsdValue(item) {
  if (!item || item.isSign) return 0;
  const name = item.name;
  if (!name) return 0;
  if (Object.prototype.hasOwnProperty.call(AMVGG_PET_PRICING, name)) {
    const potions = item.potions || { fly: false, ride: false, neon: false, mega: false };
    return getPetUsdValue(AMVGG_PET_PRICING[name], potions) || 0;
  }
  return getAmvggUsdValue(name) || 0;
}

function sumTradeSideUsd(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((total, item) => total + getTradeItemUsdValue(item), 0);
}

function formatTradeSideLabel(label, total) {
  return label + ': ' + formatUsdValue(total);
}

function getItemListSortUsd(name) {
  if (Object.prototype.hasOwnProperty.call(AMVGG_PET_PRICING, name)) {
    const usd = getPetUsdValue(AMVGG_PET_PRICING[name], { fly: true, ride: true, neon: false, mega: false });
    return usd == null ? -1 : usd;
  }
  if (Object.prototype.hasOwnProperty.call(AMVGG_USD_VALUES, name)) {
    return AMVGG_USD_VALUES[name];
  }
  return -1;
}

function sortItemsByUsdDesc(items) {
  return [...items].sort((a, b) => {
    const diff = getItemListSortUsd(b.name) - getItemListSortUsd(a.name);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });
}

var petsByUsd = typeof pets !== 'undefined' ? sortItemsByUsdDesc(pets) : [];
`;

  fs.writeFileSync(OUT_PATH, file);
  console.log(`\nWrote ${pets.length} pet pricing entries + ${Object.keys(usdByName).length} flat USD entries`);
  console.log(JSON.stringify(report, null, 2));

  // Spot checks using same runtime logic (eval minimal helpers)
  const frost = pets.find((p) => p.name === 'Frost Dragon');
  const dog = pets.find((p) => p.name === 'Dog');
  if (frost) {
    const frUsd = computeUsd(frost.regularValue, DEMAND_STARS[frost.regularDemand]);
    const nfrUsd = computeUsd(frost.neonValue, DEMAND_STARS[frost.neonDemand]);
    const npUsd = computeUsd(frost.npRegularValue, DEMAND_STARS[frost.npRegularDemand]);
    console.log('Frost Dragon FR USD:', frUsd, 'NFR:', nfrUsd, 'NP:', npUsd);
  }
  if (dog) {
    const coef = coefficients[String(dog.category)];
    const np = Number((dog.regularValue * coef.NP).toFixed(4));
    console.log('Dog FR USD:', computeUsd(dog.regularValue, DEMAND_STARS[dog.regularDemand]), 'NP frost:', np);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
