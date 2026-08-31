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
    if (js.includes('MNP') && js.includes('NNP')) {
      const i = js.indexOf('MNP');
      console.log('===', src, '===');
      // find object with numeric keys
      const m = js.match(/\{[0-9]+:\{NP:[^}]+\}/);
      console.log('match1', m && m[0].slice(0, 200));
      const idx = js.indexOf('"1":');
      if (idx >= 0) console.log(js.slice(idx, idx + 400));
      const idx2 = js.indexOf('1:{NP:');
      if (idx2 >= 0) console.log('idx2', js.slice(idx2, idx2 + 400));
    }
  }
}

main().catch(console.error);
