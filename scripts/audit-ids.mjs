import { readFileSync } from 'node:fs';

const pages = ['popup', 'dashboard', 'block', 'timeline'];
let problems = 0;
for (const page of pages) {
  const js = readFileSync(`src/pages/${page}.js`, 'utf8');
  const html = readFileSync(`src/pages/${page}.html`, 'utf8');
  const used = new Set();
  for (const m of js.matchAll(/\$\('([\w-]+)'\)/g)) used.add(m[1]);
  for (const m of js.matchAll(/getElementById\('([\w-]+)'\)/g)) used.add(m[1]);
  for (const id of used) {
    if (!html.includes(`id="${id}"`)) {
      console.log(`MISSING in ${page}.html: #${id}`);
      problems += 1;
    }
  }
  console.log(`${page}: ${used.size} ids checked`);
}
console.log(problems === 0 ? 'ALL IDS OK' : `${problems} MISSING`);
