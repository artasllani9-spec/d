const https = require('https');
const fs = require('fs');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

async function main() {
  const js = await fetch('https://amvgg.com/_next/static/chunks/app/values/pets/page-4121cf981235d276.js');
  const m = js.match(/134:e=>\{"use strict";e\.exports=JSON\.parse\('(.+?)'\)/);
  if (!m) throw new Error('coef not found');
  const json = m[1].replace(/\\'/g, "'");
  const coef = JSON.parse(json);
  fs.writeFileSync('scripts/amvgg-category-coefficients.json', JSON.stringify(coef, null, 2));
  console.log('categories', Object.keys(coef).length);

  const html = await fetch('https://amvgg.com/values/pets');
  const petRe = /\{\\"name\\":\\"([^\\]+)\\",\\"regularValue\\":\\"([^\\]+)\\"[^}]*?\\"category\\":(\d+)/g;
  let match;
  let count = 0;
  while ((match = petRe.exec(html))) {
    count++;
    if (match[1] === 'Frost Dragon') {
      console.log('Frost Dragon category', match[3], 'regular', match[2]);
    }
  }
  console.log('pets parsed', count);

  // extract one full frost dragon object
  const frostIdx = html.indexOf('\\"name\\":\\"Frost Dragon\\"');
  console.log(html.slice(frostIdx, frostIdx + 600).replace(/\\"/g, '"'));
}

main().catch(console.error);
