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
  const html = await fetch('https://amvgg.com/values/pets');
  const scripts = [...new Set([...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]))];
  for (const src of scripts) {
    const js = await fetch('https://amvgg.com' + src);
    if (js.includes('Medium') && js.includes('Low') && js.length < 50000) {
      console.log('===', src, 'len', js.length, '===');
      console.log(js.slice(0, 2000));
    }
  }
}

main().catch(console.error);
