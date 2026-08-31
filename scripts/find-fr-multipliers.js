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
  const petMatch = html.match(/\\"pet\\":\{[^}]+\}/);
  console.log(petMatch && petMatch[0].replace(/\\"/g, '"'));
  const scripts = [...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
  console.log('scripts:', scripts.length);
  for (const src of scripts.slice(0, 5)) {
    const js = await fetch('https://amvgg.com' + src);
    if (/fly|ride|regularValue|potion/i.test(js)) {
      console.log('\n===', src, '===');
      const snippets = [...js.matchAll(/.{0,60}(fly|ride|regularValue|FLY|RIDE|potion).{0,120}/gi)].slice(0, 15);
      snippets.forEach((s) => console.log(s[0]));
    }
  }
}

main().catch(console.error);
