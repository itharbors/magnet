import { rm } from 'node:fs/promises';

await Promise.all([
  rm(new globalThis.URL('../coverage', import.meta.url), { recursive: true, force: true }),
  rm(new globalThis.URL('../dist', import.meta.url), { recursive: true, force: true }),
]);
