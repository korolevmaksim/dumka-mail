import { rmSync } from 'node:fs';

// Electron's entries share one output directory. Remove old hashed chunks
// before the first entry runs so packaged builds contain only current code.
for (const directory of ['dist', 'dist-electron']) {
  rmSync(new URL(`../${directory}/`, import.meta.url), { recursive: true, force: true });
}
