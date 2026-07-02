import { execFile } from 'child_process';
import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const SERVICE_NAME = 'dumka-mail';
const LEGACY_SERVICE_NAMES = ['dumka-mail-agy'];
const SAFE_STORAGE_FILENAME = 'secure-tokens.json';

// Memory fallback for tests or systems where OS-backed encryption is unavailable.
const memoryStore = new Map<string, string>();

interface SafeStorageFile {
  version: 1;
  entries: Record<string, string>;
}

function safeStoragePath(): string {
  return path.join(app.getPath('userData'), SAFE_STORAGE_FILENAME);
}

function safeStorageIsAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function readSafeStorageFile(): SafeStorageFile {
  try {
    const raw = fs.readFileSync(safeStoragePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<SafeStorageFile>;
    return {
      version: 1,
      entries: parsed && typeof parsed.entries === 'object' && parsed.entries
        ? Object.fromEntries(
            Object.entries(parsed.entries).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
          )
        : {},
    };
  } catch {
    return { version: 1, entries: {} };
  }
}

function writeSafeStorageFile(file: SafeStorageFile): void {
  const target = safeStoragePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(file, null, 2), { mode: 0o600 });
  fs.renameSync(temp, target);
  try {
    fs.chmodSync(target, 0o600);
  } catch {
    // chmod is best-effort on Windows.
  }
}

function saveSafeStorageToken(key: string, token: string): boolean {
  if (!safeStorageIsAvailable()) return false;

  const file = readSafeStorageFile();
  file.entries[key] = safeStorage.encryptString(token).toString('base64');
  writeSafeStorageFile(file);
  return true;
}

function getSafeStorageToken(key: string): string | null {
  if (!safeStorageIsAvailable()) return null;

  const encrypted = readSafeStorageFile().entries[key];
  if (!encrypted) return null;

  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch (error) {
    console.error(`Safe storage decrypt failed for ${key}:`, error);
    return null;
  }
}

function deleteSafeStorageToken(key: string): void {
  const file = readSafeStorageFile();
  if (!(key in file.entries)) return;
  delete file.entries[key];
  writeSafeStorageFile(file);
}

async function saveTokenForService(email: string, token: string, serviceName: string): Promise<void> {
  // -a: account name, -s: service name, -w: password, -U: update if exists
  await execFileAsync('security', [
    'add-generic-password',
    '-a', email,
    '-s', serviceName,
    '-w', token,
    '-U'
  ]);
}

async function getTokenForService(email: string, serviceName: string): Promise<string | null> {
  // -a: account name, -s: service name, -w: return only password text
  const { stdout } = await execFileAsync('security', [
    'find-generic-password',
    '-a', email,
    '-s', serviceName,
    '-w'
  ]);
  return stdout.trim();
}

export async function saveRefreshToken(email: string, token: string): Promise<void> {
  if (process.platform !== 'darwin') {
    try {
      if (saveSafeStorageToken(email, token)) {
        memoryStore.set(email, token);
        return;
      }
    } catch (error) {
      console.error(`Safe storage save failed for ${email}, using memory fallback:`, error);
    }
    memoryStore.set(email, token);
    return;
  }

  try {
    await saveTokenForService(email, token, SERVICE_NAME);
  } catch (error) {
    console.error(`Keychain save failed for ${email}, using memory fallback:`, error);
    memoryStore.set(email, token);
  }
}

export async function getRefreshToken(email: string): Promise<string | null> {
  if (process.platform !== 'darwin') {
    const memoryToken = memoryStore.get(email);
    if (memoryToken) return memoryToken;
    try {
      const token = getSafeStorageToken(email);
      if (token) {
        memoryStore.set(email, token);
        return token;
      }
    } catch (error) {
      console.error(`Safe storage get failed for ${email}:`, error);
    }
    return null;
  }

  try {
    return await getTokenForService(email, SERVICE_NAME);
  } catch (error: any) {
    // If the item doesn't exist, find-generic-password exits with status 44
    if (error.code === 44) {
      for (const serviceName of LEGACY_SERVICE_NAMES) {
        try {
          const token = await getTokenForService(email, serviceName);
          if (token) {
            try {
              await saveTokenForService(email, token, SERVICE_NAME);
            } catch (migrationError) {
              console.error(`Keychain migration failed for ${email}:`, migrationError);
            }
            return token;
          }
        } catch (legacyError: any) {
          if (legacyError.code !== 44) {
            console.error(`Legacy Keychain get failed for ${email}:`, legacyError);
          }
        }
      }
      return memoryStore.get(email) || null;
    }
    console.error(`Keychain get failed for ${email}:`, error);
    return memoryStore.get(email) || null;
  }
}

export async function deleteRefreshToken(email: string): Promise<void> {
  memoryStore.delete(email);
  if (process.platform !== 'darwin') {
    try {
      deleteSafeStorageToken(email);
    } catch (error) {
      console.error(`Safe storage delete failed for ${email}:`, error);
    }
    return;
  }

  try {
    await execFileAsync('security', [
      'delete-generic-password',
      '-a', email,
      '-s', SERVICE_NAME
    ]);
  } catch (error: any) {
    if (error.code !== 44) {
      console.error(`Keychain delete failed for ${email}:`, error);
    }
  }

  for (const serviceName of LEGACY_SERVICE_NAMES) {
    try {
      await execFileAsync('security', [
        'delete-generic-password',
        '-a', email,
        '-s', serviceName
      ]);
    } catch (error: any) {
      if (error.code !== 44) {
        console.error(`Legacy Keychain delete failed for ${email}:`, error);
      }
    }
  }
}
