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
    if (/Very High|Decent|Low/.test(js) && /★/.test(js)) {
      const idx = js.indexOf('Very High');
      console.log('===', src, '===');
      console.log(js.slice(Math.max(0, idx - 100), idx + 400));
    }
  }
}

main().catch(console.error);
