/**
 * Quick check: Safari Egg should sit between Giant Panda and Blazing Lion by USD.
 */
const fs = require('fs');
const vm = require('vm');

const sandbox = { console };
vm.runInNewContext(fs.readFileSync('public/pets-data.js', 'utf8'), sandbox);
vm.runInNewContext(fs.readFileSync('public/amvgg-usd-values.js', 'utf8'), sandbox);

if (!Array.isArray(sandbox.petsByUsd) || !sandbox.petsByUsd.length) {
  console.error('petsByUsd not built — got', sandbox.petsByUsd);
  process.exit(1);
}

const names = sandbox.petsByUsd.map((item) => item.name);
const idx = (name) => names.indexOf(name);

const panda = idx('Giant Panda');
const safari = idx('Safari Egg');
const lion = idx('Blazing Lion');

console.log('Giant Panda index:', panda, 'USD:', sandbox.getItemListSortUsd('Giant Panda'));
console.log('Safari Egg index:', safari, 'USD:', sandbox.getItemListSortUsd('Safari Egg'));
console.log('Blazing Lion index:', lion, 'USD:', sandbox.getItemListSortUsd('Blazing Lion'));

if (panda < 0 || safari < 0 || lion < 0) {
  console.error('Missing item in sorted list');
  process.exit(1);
}

if (!(panda < safari && safari < lion)) {
  console.error('Expected Giant Panda > Safari Egg > Blazing Lion by position');
  process.exit(1);
}

console.log('OK — context:', names.slice(lion - 1, panda + 2));
