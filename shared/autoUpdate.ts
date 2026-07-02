export type AutoUpdatePlatform = 'darwin' | 'win32' | 'linux' | 'other';

export type AutoUpdateState =
  | 'unavailable'
  | 'idle'
  | 'checking'
  | 'available'
  | 'notAvailable'
  | 'downloaded'
  | 'error';

export interface AutoUpdateStatus {
  platform: AutoUpdatePlatform;
  version: string;
  state: AutoUpdateState;
  isSupported: boolean;
  isPackaged: boolean;
  isConfigured: boolean;
  feedURL: string | null;
  message: string;
  errorMessage?: string | null;
  releaseName?: string | null;
  releaseNotes?: string | null;
  updateURL?: string | null;
  lastCheckedAt?: string | null;
}

export function normalizeAutoUpdatePlatform(platform: string): AutoUpdatePlatform {
  if (platform === 'darwin' || platform === 'win32' || platform === 'linux') return platform;
  return 'other';
}

export function platformSupportsBuiltInAutoUpdater(platform: AutoUpdatePlatform): boolean {
  return platform === 'darwin' || platform === 'win32';
}

function normalizeBaseURL(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function buildAutoUpdateFeedURL(baseURL: string | undefined | null, platform: AutoUpdatePlatform, version: string): string | null {
  if (!baseURL || !platformSupportsBuiltInAutoUpdater(platform)) return null;

  const versionPart = encodeURIComponent(version);
  const raw = baseURL.trim();
  if (raw.includes('{platform}') || raw.includes('{version}')) {
    return normalizeBaseURL(
      raw
      .replace(/\{platform\}/g, platform)
        .replace(/\{version\}/g, versionPart),
    );
  }

  const normalized = normalizeBaseURL(baseURL);
  if (!normalized) return null;
  return `${normalized}/update/${platform}/${versionPart}`;
}
