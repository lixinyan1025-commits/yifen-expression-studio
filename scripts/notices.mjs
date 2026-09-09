import { readFile, readdir, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
let output =
  '# Third-party notices\n\nDirect production dependencies. Original license notices are reproduced below. Transitive dependency licenses remain in each installed package.\n';
for (const name of Object.keys(pkg.dependencies)) {
  const folder = new URL(`node_modules/${name}/`, root);
  const meta = JSON.parse(await readFile(new URL('package.json', folder), 'utf8'));
  const files = await readdir(folder);
  const license = files.find((f) => /^licen[sc]e(?:\.md|\.txt)?$/i.test(f));
  if (!license) throw new Error(`Missing license for ${name}`);
  output += `\n## ${name} ${meta.version} — ${meta.license}\n\n${typeof meta.repository === 'object' ? meta.repository.url : meta.repository || ''}\n\n`;
  output += await readFile(new URL(license, folder), 'utf8');
  output += '\n';
}
await writeFile(new URL('THIRD_PARTY_NOTICES.md', root), output);
