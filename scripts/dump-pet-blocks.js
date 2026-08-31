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
  for (const name of ['Dog', 'Frost Dragon']) {
    const parts = html.split('\\"name\\":\\"');
    for (let i = 1; i < parts.length; i++) {
      if (!parts[i].startsWith(name + '\\"')) continue;
      const block = parts[i].slice(0, 2500).replace(/\\"/g, '"');
      console.log('\n', name, block.slice(0, 1200));
      break;
    }
  }
}

main().catch(console.error);
