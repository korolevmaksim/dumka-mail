import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
let userDataDir = '';
let encryptionAvailable = true;

function setPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', {
    value,
  });
}

async function loadKeychain() {
  vi.resetModules();
  vi.doMock('electron', () => ({
    app: {
      getPath: vi.fn(() => userDataDir),
    },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => encryptionAvailable),
      encryptString: vi.fn((plainText: string) => Buffer.from(`encrypted:${plainText}`, 'utf8')),
      decryptString: vi.fn((encrypted: Buffer) => encrypted.toString('utf8').replace(/^encrypted:/, '')),
    },
  }));
  return import('../main/keychain');
}

describe('non-macOS safe storage keychain fallback', () => {
  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dumka-mail-keychain-'));
    encryptionAvailable = true;
    setPlatform('linux');
  });

  afterEach(() => {
    vi.doUnmock('electron');
    vi.resetModules();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
  });

  it('stores non-macOS refresh tokens with Electron safeStorage', async () => {
    const keychain = await loadKeychain();
    await keychain.saveRefreshToken('me@example.com', 'refresh-secret');

    const storedFile = path.join(userDataDir, 'secure-tokens.json');
    expect(fs.existsSync(storedFile)).toBe(true);
    expect(fs.readFileSync(storedFile, 'utf8')).not.toContain('refresh-secret');
    expect(await keychain.getRefreshToken('me@example.com')).toBe('refresh-secret');
  });

  it('loads safeStorage tokens after the module memory cache is reset', async () => {
    let keychain = await loadKeychain();
    await keychain.saveRefreshToken('me@example.com', 'refresh-secret');

    keychain = await loadKeychain();
    expect(await keychain.getRefreshToken('me@example.com')).toBe('refresh-secret');
  });

  it('deletes safeStorage tokens from disk', async () => {
    const keychain = await loadKeychain();
    await keychain.saveRefreshToken('me@example.com', 'refresh-secret');
    await keychain.deleteRefreshToken('me@example.com');

    expect(await keychain.getRefreshToken('me@example.com')).toBeNull();
    const stored = JSON.parse(fs.readFileSync(path.join(userDataDir, 'secure-tokens.json'), 'utf8'));
    expect(stored.entries['me@example.com']).toBeUndefined();
  });

  it('keeps memory-only fallback when safeStorage encryption is unavailable', async () => {
    encryptionAvailable = false;
    const keychain = await loadKeychain();
    await keychain.saveRefreshToken('me@example.com', 'refresh-secret');

    expect(await keychain.getRefreshToken('me@example.com')).toBe('refresh-secret');
    expect(fs.existsSync(path.join(userDataDir, 'secure-tokens.json'))).toBe(false);
  });
});
