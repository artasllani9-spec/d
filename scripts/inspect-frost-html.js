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
  for (const needle of ['1.71', 'fly', 'ride', 'regular', 'Demand', 'multiplier', 'Frost']) {
    const idx = html.indexOf(needle);
    console.log('\n---', needle, 'at', idx, '---');
    if (idx >= 0) console.log(html.slice(Math.max(0, idx - 80), idx + 200));
  }
  const jsonChunks = [...html.matchAll(/self\.__next_f\.push\(\[1,"([^"]{0,500})/g)].slice(0, 3);
  console.log('\nnext chunks sample:', jsonChunks.length);
}

main().catch(console.error);
