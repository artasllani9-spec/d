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
  const idx = html.indexOf('data-pet-name="Bat-Dragon"');
  const chunk = html.slice(idx, idx + 3500);
  const demandIdx = chunk.indexOf('Demand');
  console.log(chunk.slice(demandIdx, demandIdx + 400));
  console.log('\nstar chars:', [...chunk].filter((c) => c === '★' || c === 'â').length);
  console.log('\nyellow-400 count in chunk', (chunk.match(/text-yellow-400/g) || []).length);
}

main().catch(console.error);
