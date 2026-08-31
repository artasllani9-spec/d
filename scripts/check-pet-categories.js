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

function getField(block, key, type = 'string') {
  if (type === 'number') {
    const m = block.match(new RegExp(`\\\\"${key}\\\\":(\\d+)`));
    return m ? Number(m[1]) : null;
  }
  const m = block.match(new RegExp(`\\\\"${key}\\\\":\\\\"([^\\\\"]*)\\\\"`));
  return m ? m[1] : null;
}

async function main() {
  const html = await fetch('https://amvgg.com/values/pets');
  for (const name of ['Dog', 'Frost Dragon', 'Bat Dragon']) {
    const parts = html.split('\\"name\\":\\"');
    for (let i = 1; i < parts.length; i++) {
      if (!parts[i].startsWith(name + '\\"')) continue;
      const block = parts[i].slice(0, 2000);
      console.log(name, 'category', getField(block, 'category', 'number'));
      break;
    }
  }
}

main().catch(console.error);
