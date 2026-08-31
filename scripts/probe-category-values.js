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
  for (const path of ['/values/eggs', '/petwear/Cupcake_Sprinkle_Wings', '/values/petwear']) {
    const html = await fetch(`https://amvgg.com${path}`);
    console.log('\n===', path, '===');
    const keys = [...html.matchAll(/"([a-zA-Z]+Value)":"([0-9.]+)"/g)].slice(0, 8);
    console.log(keys.map((m) => `${m[1]}=${m[2]}`));
    const sample = html.match(/regularValue[^}]{0,400}/);
    console.log(sample && sample[0]);
  }
}

main().catch(console.error);
