const https = require('https');
const fs = require('fs');

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
  const js = await fetch('https://amvgg.com/_next/static/chunks/app/values/pets/page-4121cf981235d276.js');
  const coefStart = js.indexOf('"1":{');
  const coefEnd = js.indexOf('},"13":', coefStart);
  const coefText = js.slice(coefStart, coefEnd + 1);
  console.log('coefficients length', coefText.length);

  const fnStart = js.indexOf('((e,t,a,r,s)=>{if(!s[e])');
  console.log('\ncompute fn:\n', js.slice(fnStart, fnStart + 800));

  const switchStart = js.indexOf('switch(n){case"fr"');
  console.log('\nswitch:\n', js.slice(switchStart, switchStart + 600));

  fs.writeFileSync('scripts/amvgg-coef-snippet.txt', coefText + '\n\n' + js.slice(fnStart, fnStart + 800));
}

main().catch(console.error);
