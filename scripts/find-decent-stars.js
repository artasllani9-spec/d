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

function getField(block, key) {
  const m = block.match(new RegExp(`\\\\"${key}\\\\":\\\\"([^\\\\"]*)\\\\"`));
  return m ? m[1] : null;
}

function starsInCard(html, slug) {
  const needle = `data-pet-name="${slug}"`;
  let idx = 0;
  let best = 0;
  while ((idx = html.indexOf(needle, idx)) >= 0) {
    const chunk = html.slice(idx, idx + 3500);
    const match = chunk.match(/text-yellow-400">([^<]*)</);
    const stars = match ? [...match[1]].filter((c) => c === '★').length : 0;
    if (stars > best) best = stars;
    idx += needle.length;
  }
  return best;
}

async function main() {
  const html = await fetch('https://amvgg.com/values/pets');
  const parts = html.split('\\"name\\":\\"');
  for (let i = 1; i < parts.length; i++) {
    const nameEnd = parts[i].indexOf('\\"');
    const name = parts[i].slice(0, nameEnd);
    const block = parts[i].slice(0, 1500);
    if (getField(block, 'regularDemand') === 'Decent') {
      console.log(name, starsInCard(html, name.replace(/\s/g, '-')));
      break;
    }
  }
}

main().catch(console.error);
