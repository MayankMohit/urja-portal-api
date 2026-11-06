import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/lib/config.js';

const CONFIG: Config = {
  portalUrl: 'http://localhost',
  portalEmail: 'openapi@example.com',
  portalPassword: 'unused',
  host: '127.0.0.1',
  port: 0,
  syncIntervalHours: 6,
};

async function main(): Promise<void> {
  const { app } = await buildApp({ config: CONFIG });
  await app.ready();
  const spec = app.swagger();
  await app.close();

  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const outPath = join(root, 'openapi.json');
  await writeFile(outPath, JSON.stringify(spec, null, 2) + '\n', 'utf8');

  const pathCount = Object.keys((spec as { paths?: object }).paths ?? {}).length;
  console.log(`Wrote ${outPath} (${pathCount} paths).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
