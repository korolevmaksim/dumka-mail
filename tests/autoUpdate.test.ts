import { describe, expect, it } from 'vitest';
import {
  buildAutoUpdateFeedURL,
  normalizeAutoUpdatePlatform,
  platformSupportsBuiltInAutoUpdater,
} from '../shared/autoUpdate';

describe('auto update helpers', () => {
  it('normalizes supported Electron updater platforms', () => {
    expect(normalizeAutoUpdatePlatform('darwin')).toBe('darwin');
    expect(normalizeAutoUpdatePlatform('win32')).toBe('win32');
    expect(normalizeAutoUpdatePlatform('linux')).toBe('linux');
    expect(normalizeAutoUpdatePlatform('freebsd')).toBe('other');
  });

  it('uses the built-in updater only where Electron supports it', () => {
    expect(platformSupportsBuiltInAutoUpdater('darwin')).toBe(true);
    expect(platformSupportsBuiltInAutoUpdater('win32')).toBe(true);
    expect(platformSupportsBuiltInAutoUpdater('linux')).toBe(false);
    expect(platformSupportsBuiltInAutoUpdater('other')).toBe(false);
  });

  it('builds a Squirrel-style feed URL from a base URL', () => {
    expect(buildAutoUpdateFeedURL('https://updates.example.com/', 'darwin', '1.2.3')).toBe(
      'https://updates.example.com/update/darwin/1.2.3',
    );
  });

  it('supports explicit platform and version feed URL templates', () => {
    expect(buildAutoUpdateFeedURL('https://updates.example.com/{platform}/feed/{version}', 'win32', '1.2.3 beta')).toBe(
      'https://updates.example.com/win32/feed/1.2.3%20beta',
    );
  });

  it('rejects unsupported platforms and invalid feed URLs', () => {
    expect(buildAutoUpdateFeedURL('https://updates.example.com', 'linux', '1.2.3')).toBeNull();
    expect(buildAutoUpdateFeedURL('file:///tmp/feed', 'darwin', '1.2.3')).toBeNull();
    expect(buildAutoUpdateFeedURL('', 'darwin', '1.2.3')).toBeNull();
  });
});
