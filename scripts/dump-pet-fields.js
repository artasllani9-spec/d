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

async function dump(slug) {
  const html = await fetch(`https://amvgg.com/pet/${slug}`);
  const vals = {};
  const re = /([a-zA-Z]+Value)\\":\\"([^\\"]+)/g;
  let m;
  while ((m = re.exec(html))) vals[m[1]] = m[2];
  const demand = {};
  const dRe = /([a-zA-Z]+Demand)\\":\\"([0-9]+)/g;
  while ((m = dRe.exec(html))) demand[m[1]] = m[2];
  console.log('\n===', slug, '===');
  console.log('values:', vals);
  console.log('demand:', demand);
}

async function main() {
  for (const slug of ['Frost_Dragon', 'Dog', 'Bat_Dragon']) {
    await dump(slug);
  }
}

main().catch(console.error);
