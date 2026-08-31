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

async function main() {
  const html = await fetch('https://amvgg.com/pet/Frost_Dragon');
  const scripts = [...new Set([...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]))];
  const terms = ['flyRide', 'flyMultiplier', 'rideMultiplier', 'regularValue', 'isFly', 'isRide', 'FLY_MULT', '0.75', '0.8', '0.85', '0.9', '1.15', '1.2', '1.25', '1.3'];
  for (const src of scripts) {
    const js = await fetch('https://amvgg.com' + src);
    const hits = terms.filter((t) => js.includes(t));
    if (hits.length) console.log(src, hits.join(', '));
  }
}

main().catch(console.error);
