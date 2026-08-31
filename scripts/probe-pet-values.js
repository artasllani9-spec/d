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
  for (const slug of ['Frost_Dragon', 'Bat_Dragon', 'Shadow_Dragon']) {
    const html = await fetch(`https://amvgg.com/pet/${slug}`);
    const vals = {};
    const re = /([a-zA-Z]+Value)\\":\\"([0-9.]+)/g;
    let m;
    while ((m = re.exec(html))) vals[m[1]] = m[2];
    console.log(slug, vals);
  }
}

main().catch(console.error);
