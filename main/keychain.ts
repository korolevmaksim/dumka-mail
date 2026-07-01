import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const SERVICE_NAME = 'dumka-mail';
const LEGACY_SERVICE_NAMES = ['dumka-mail-agy'];

// Memory fallback for tests or non-macOS systems
const memoryStore = new Map<string, string>();

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
    return memoryStore.get(email) || null;
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
