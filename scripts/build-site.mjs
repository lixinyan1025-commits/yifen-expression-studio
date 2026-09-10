import { build as viteBuild } from 'vite';
import { build as esbuild } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, '.site-build/dist');
const hosting = JSON.parse(await readFile(path.join(root, '.openai/hosting.json'), 'utf8'));
if (!hosting.project_id) throw new Error('Sites project_id is required');
await viteBuild({ root, mode: 'cloud', build: { outDir: path.join(out, 'client') } });
await mkdir(path.join(out, 'server'), { recursive: true });
await mkdir(path.join(out, '.openai'), { recursive: true });
await esbuild({
  entryPoints: [path.join(root, 'worker/index.ts')],
  outfile: path.join(out, 'server/index.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  legalComments: 'linked',
});
await copyFile(path.join(root, '.openai/hosting.json'), path.join(out, '.openai/hosting.json'));
await writeFile(
  path.join(out, 'server/wrangler.json'),
  JSON.stringify(
    {
      name: 'yifen-expression-studio',
      main: 'index.js',
      compatibility_date: '2026-09-01',
      assets: {
        directory: '../client',
        binding: 'ASSETS',
        not_found_handling: 'single-page-application',
        run_worker_first: ['/api/*'],
      },
    },
    null,
    2,
  ),
);
console.log('Sites artifact built at .site-build/dist (no local notes or secrets).');
