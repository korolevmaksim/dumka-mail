import fs from 'fs';
import path from 'path';

export const APP_SLUG = 'dumka-mail';
export const LEGACY_APP_SLUGS = ['dumka-mail-agy'];
export const LEGACY_CONFIG_SLUGS = [...LEGACY_APP_SLUGS, 'personal-mail-client'];

function homePath(...parts: string[]): string {
  return path.join(process.env.HOME || '', ...parts);
}

export function configDirCandidates(): string[] {
  return [
    homePath('.config', APP_SLUG),
    ...LEGACY_CONFIG_SLUGS.map(slug => homePath('.config', slug)),
  ];
}

export function configFileCandidates(fileName: string, legacyFileNames: string[] = []): string[] {
  return configDirCandidates().flatMap(dir => [
    path.join(dir, fileName),
    ...legacyFileNames.map(legacyFileName => path.join(dir, legacyFileName)),
  ]);
}

export function resolveConfigFile(
  fileName: string,
  legacyFileNames: string[] = [],
): { primaryPath: string; path: string | null; candidates: string[] } {
  const candidates = configFileCandidates(fileName, legacyFileNames);
  return {
    primaryPath: candidates[0],
    path: candidates.find(candidate => fs.existsSync(candidate)) || null,
    candidates,
  };
}

export function ensurePrimaryConfigDir(): string {
  const [primaryDir] = configDirCandidates();
  if (!fs.existsSync(primaryDir)) {
    fs.mkdirSync(primaryDir, { recursive: true });
  }
  return primaryDir;
}

function appSupportDir(slug: string): string {
  return homePath('Library', 'Application Support', slug);
}

export function appSupportDirCandidates(): string[] {
  return [
    appSupportDir(APP_SLUG),
    ...LEGACY_APP_SLUGS.map(appSupportDir),
  ];
}

export function ensureAppSupportDir(): string {
  const [primaryDir, ...legacyDirs] = appSupportDirCandidates();

  if (!fs.existsSync(primaryDir)) {
    const legacyDir = legacyDirs.find(candidate => fs.existsSync(candidate));
    if (legacyDir) {
      fs.mkdirSync(path.dirname(primaryDir), { recursive: true });
      try {
        fs.renameSync(legacyDir, primaryDir);
      } catch {
        fs.mkdirSync(primaryDir, { recursive: true });
        for (const entry of fs.readdirSync(legacyDir)) {
          const source = path.join(legacyDir, entry);
          const target = path.join(primaryDir, entry);
          if (!fs.existsSync(target)) {
            fs.cpSync(source, target, { recursive: true });
          }
        }
      }
    }
  }

  if (!fs.existsSync(primaryDir)) {
    fs.mkdirSync(primaryDir, { recursive: true });
  }

  return primaryDir;
}
