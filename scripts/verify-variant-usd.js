const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync('public/amvgg-usd-values.js', 'utf8');
const sandbox = {};
vm.runInNewContext(code, sandbox);

const potions = [
  { label: 'FR', potions: { fly: true, ride: true, neon: false, mega: false } },
  { label: 'R only', potions: { fly: false, ride: true, neon: false, mega: false } },
  { label: 'F only', potions: { fly: true, ride: false, neon: false, mega: false } },
  { label: 'NP', potions: { fly: false, ride: false, neon: false, mega: false } },
  { label: 'NFR', potions: { fly: true, ride: true, neon: true, mega: false } },
  { label: 'MFR', potions: { fly: true, ride: true, neon: false, mega: true } },
];

for (const name of ['Frost Dragon', 'Bat Dragon', 'Dog']) {
  console.log('\n' + name);
  for (const { label, potions: p } of potions) {
    const usd = sandbox.getAmvggUsdValue(name, p);
    console.log(`  ${label}: ${sandbox.formatUsdValue(usd)}`);
  }
}
