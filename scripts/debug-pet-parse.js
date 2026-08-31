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
  const re = /\{\\"name\\":\\"([^\\]+)\\"[\s\S]*?\\"category\\":(\d+)\}/g;
  let count = 0;
  let m;
  while ((m = re.exec(html))) count++;
  console.log('regex count', count);

  // simpler: split by name field
  const parts = html.split('\\"name\\":\\"');
  console.log('split parts', parts.length);
  const pets = [];
  for (let i = 1; i < parts.length && pets.length < 3; i++) {
    const nameEnd = parts[i].indexOf('\\"');
    const name = parts[i].slice(0, nameEnd);
    if (!name || name.length > 80) continue;
    const block = parts[i].slice(0, 1200);
    if (!block.includes('regularValue')) continue;
    pets.push(name);
  }
  console.log('sample pets', pets.slice(0, 5));
}

main().catch(console.error);
