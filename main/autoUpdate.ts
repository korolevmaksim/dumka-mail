import { app, autoUpdater, BrowserWindow } from 'electron';
import {
  buildAutoUpdateFeedURL,
  normalizeAutoUpdatePlatform,
  platformSupportsBuiltInAutoUpdater,
  type AutoUpdateStatus,
} from '../shared/autoUpdate';

const AUTO_UPDATE_ENV_KEYS = [
  'DUMKA_UPDATE_FEED_URL',
  'DUMKA_AUTO_UPDATE_FEED_URL',
  'AUTO_UPDATE_FEED_URL',
];

let getMainWindow: (() => BrowserWindow | null) | null = null;
let autoUpdateTimer: NodeJS.Timeout | null = null;
let configured = false;
let status: AutoUpdateStatus = initialStatus();

function configuredFeedBaseURL(): string | null {
  for (const key of AUTO_UPDATE_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return null;
}

function initialStatus(): AutoUpdateStatus {
  const platform = normalizeAutoUpdatePlatform(process.platform);
  const isSupported = platformSupportsBuiltInAutoUpdater(platform);
  const feedURL = buildAutoUpdateFeedURL(configuredFeedBaseURL(), platform, app.getVersion());
  const isConfigured = Boolean(feedURL);
  const isPackaged = app.isPackaged;

  let message = 'Ready to check for updates.';
  if (!isSupported) {
    message = platform === 'linux'
      ? 'Built-in updates are not available on Linux; use the package manager or installer channel.'
      : 'Built-in updates are not available on this platform.';
  } else if (!isPackaged) {
    message = 'Update checks run only from packaged builds.';
  } else if (!isConfigured) {
    message = 'Update feed is not configured.';
  }

  return {
    platform,
    version: app.getVersion(),
    state: isSupported && isPackaged && isConfigured ? 'idle' : 'unavailable',
    isSupported,
    isPackaged,
    isConfigured,
    feedURL,
    message,
    errorMessage: null,
  };
}

function publishStatus() {
  const window = getMainWindow?.() || null;
  if (window && !window.isDestroyed()) {
    window.webContents.send('api:autoUpdateStatus', status);
  }
}

function updateStatus(patch: Partial<AutoUpdateStatus>) {
  status = {
    ...status,
    ...patch,
  };
  publishStatus();
}

function canUseAutoUpdater(): boolean {
  return status.isSupported && status.isPackaged && status.isConfigured && Boolean(status.feedURL);
}

function configureAutoUpdater() {
  if (configured || !canUseAutoUpdater() || !status.feedURL) return;
  autoUpdater.setFeedURL({ url: status.feedURL });
  configured = true;
}

function scheduleAutomaticChecks() {
  if (!canUseAutoUpdater() || autoUpdateTimer) return;
  const check = () => {
    if (status.state !== 'checking' && status.state !== 'downloaded') {
      checkForAppUpdates().catch(err => {
        updateStatus({
          state: 'error',
          message: 'Update check failed.',
          errorMessage: err?.message || String(err),
        });
      });
    }
  };

  setTimeout(check, 30_000);
  autoUpdateTimer = setInterval(check, 6 * 60 * 60 * 1000);
}

export function initializeAutoUpdates(windowGetter: () => BrowserWindow | null) {
  getMainWindow = windowGetter;
  status = initialStatus();

  autoUpdater.on('checking-for-update', () => {
    updateStatus({
      state: 'checking',
      message: 'Checking for updates...',
      errorMessage: null,
      lastCheckedAt: new Date().toISOString(),
    });
  });

  autoUpdater.on('update-available', () => {
    updateStatus({
      state: 'available',
      message: 'Update found. Downloading...',
      errorMessage: null,
    });
  });

  autoUpdater.on('update-not-available', () => {
    updateStatus({
      state: 'notAvailable',
      message: 'Dumka Mail is up to date.',
      errorMessage: null,
      lastCheckedAt: new Date().toISOString(),
    });
  });

  autoUpdater.on('update-downloaded', (_event, releaseNotes, releaseName, _releaseDate, updateURL) => {
    updateStatus({
      state: 'downloaded',
      message: 'Update downloaded. Restart to install.',
      errorMessage: null,
      releaseName: releaseName || null,
      releaseNotes: typeof releaseNotes === 'string' ? releaseNotes : null,
      updateURL: updateURL || null,
    });
  });

  autoUpdater.on('error', (error) => {
    updateStatus({
      state: 'error',
      message: 'Update check failed.',
      errorMessage: error.message,
      lastCheckedAt: new Date().toISOString(),
    });
  });

  configureAutoUpdater();
  scheduleAutomaticChecks();
}

export function getAutoUpdateStatus(): AutoUpdateStatus {
  return status;
}

export async function checkForAppUpdates(): Promise<AutoUpdateStatus> {
  status = initialStatus();
  configureAutoUpdater();

  if (!canUseAutoUpdater()) {
    publishStatus();
    return status;
  }

  if (process.platform === 'win32' && process.argv.includes('--squirrel-firstrun')) {
    updateStatus({
      state: 'unavailable',
      message: 'Update checks are deferred during first-run installer setup.',
    });
    return status;
  }

  autoUpdater.checkForUpdates();
  return status;
}

export async function installDownloadedAppUpdate(): Promise<AutoUpdateStatus> {
  if (status.state !== 'downloaded') {
    return {
      ...status,
      message: 'No downloaded update is ready to install.',
    };
  }

  autoUpdater.quitAndInstall();
  return status;
}
