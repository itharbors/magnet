import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'itharbors-magnet-package-'));

try {
  const packOutput = execFileSync(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', temporaryRoot],
    { cwd: root, encoding: 'utf8' },
  );
  const [{ filename, files }] = JSON.parse(packOutput);
  const paths = files.map((entry) => entry.path).sort();
  const required = [
    'CHANGELOG.md',
    'README.md',
    'dist/index.d.ts',
    'dist/index.js',
    'dist/manifest.d.ts',
    'dist/manifest.js',
    'package.json',
  ];
  for (const expected of required) {
    if (!paths.includes(expected)) throw new Error(`Packed artifact is missing ${expected}`);
  }
  if (paths.some((entry) => entry.startsWith('src/') || entry.startsWith('tests/'))) {
    throw new Error('Packed artifact contains source or test files');
  }

  const consumer = path.join(temporaryRoot, 'consumer');
  await mkdir(consumer);
  await writeFile(
    path.join(consumer, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  execFileSync('npm', ['install', '--ignore-scripts', path.join(temporaryRoot, filename)], {
    cwd: consumer,
    stdio: 'pipe',
  });

  execFileSync(
    globalThis.process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        import { PluginModule, createPluginPaths } from '@itharbors/magnet';
        import { parsePluginPackageManifest } from '@itharbors/magnet/manifest';
        if (typeof PluginModule !== 'function' || typeof createPluginPaths !== 'function') process.exit(1);
        if (typeof parsePluginPackageManifest !== 'function') process.exit(1);
      `,
    ],
    { cwd: consumer, stdio: 'pipe' },
  );

  const packedPackage = JSON.parse(
    await readFile(path.join(consumer, 'node_modules/@itharbors/magnet/package.json'), 'utf8'),
  );
  if (packedPackage.name !== '@itharbors/magnet') {
    throw new Error('Packed package identity is incorrect');
  }
  globalThis.console.log('PACKAGED_MAGNET_IMPORT_OK');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
