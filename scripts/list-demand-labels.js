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
  const demands = new Set();
  const re = /\\"([a-zA-Z]+Demand)\\":\\"([^\\"]+)\\"/g;
  let m;
  while ((m = re.exec(html))) demands.add(m[2]);
  console.log([...demands].sort());
}

main().catch(console.error);
