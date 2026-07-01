import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function withTempHome<T>(run: () => Promise<T> | T): Promise<T> {
  const previousHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), 'dumka-paths-'));

  vi.resetModules();
  process.env.HOME = home;

  try {
    return await run();
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    vi.resetModules();
    rmSync(home, { recursive: true, force: true });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('app path compatibility', () => {
  it('prefers dumka-mail config files and falls back to legacy locations', async () => {
    await withTempHome(async () => {
      const { resolveConfigFile } = await import('../main/appPaths');
      const home = process.env.HOME || '';
      const legacyDir = join(home, '.config', 'dumka-mail-agy');
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(join(legacyDir, 'openai.env'), 'OPENAI_MODEL=gpt-5\n');

      expect(resolveConfigFile('openai.env').path).toBe(join(legacyDir, 'openai.env'));

      const primaryDir = join(home, '.config', 'dumka-mail');
      mkdirSync(primaryDir, { recursive: true });
      writeFileSync(join(primaryDir, 'openai.env'), 'OPENAI_MODEL=gpt-5.4-mini\n');

      expect(resolveConfigFile('openai.env').path).toBe(join(primaryDir, 'openai.env'));
    });
  });

  it('migrates the legacy app support directory when the primary directory is absent', async () => {
    await withTempHome(async () => {
      const { ensureAppSupportDir } = await import('../main/appPaths');
      const home = process.env.HOME || '';
      const legacyDir = join(home, 'Library', 'Application Support', 'dumka-mail-agy');
      const primaryDir = join(home, 'Library', 'Application Support', 'dumka-mail');
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(join(legacyDir, 'database.sqlite'), 'fixture-db');

      expect(ensureAppSupportDir()).toBe(primaryDir);
      expect(existsSync(join(primaryDir, 'database.sqlite'))).toBe(true);
    });
  });
});
