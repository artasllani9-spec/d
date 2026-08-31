const https = require('https');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

async function findInScripts(pageUrl, terms) {
  const html = await fetch(pageUrl);
  const scripts = [...new Set([...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]))];
  for (const src of scripts) {
    const js = await fetch('https://amvgg.com' + src);
    for (const term of terms) {
      if (js.includes(term)) {
        const idx = js.indexOf(term);
        console.log('\n===', src, 'term:', term, '===');
        console.log(js.slice(Math.max(0, idx - 200), idx + 600));
      }
    }
  }
}

async function main() {
  await findInScripts('https://amvgg.com/values/pets', [
    'ridePotion',
    'flyPotion',
    'regularValue',
    'M$',
    'Ru(',
    'frostDragon',
    '0.875',
    '0.85',
    '1.15',
  ]);
}

main().catch(console.error);
