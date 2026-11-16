// What Settings shows for "Open at login". The state comes from the operating
// system (`main/loginItem.ts`); this module only turns it into words.
// Pure and dependency-free.

export interface LoginItemState {
  /** False in a development run or on a platform without login items. */
  supported: boolean;
  /** The system will open the app at login. */
  enabled: boolean;
  /** macOS: the person still has to allow it in System Settings → General → Login Items. */
  needsApproval: boolean;
  /** One line under the switch. */
  note: string;
}

export interface LoginItemInput {
  supported: boolean;
  openAtLogin?: boolean;
  /** macOS `SMAppService` status: not-registered, enabled, requires-approval, not-found. */
  status?: string | null;
  error?: string | null;
}

export const LOGIN_ITEM_DESCRIPTION = 'Mail keeps arriving, reminders fire and scheduled messages go out without opening the app by hand';

export function describeLoginItem(input: LoginItemInput): LoginItemState {
  if (!input.supported) {
    return { supported: false, enabled: false, needsApproval: false, note: 'Available in the installed app.' };
  }
  if (input.error) {
    return { supported: true, enabled: false, needsApproval: false, note: `The system did not accept the change: ${input.error}` };
  }
  if (input.status === 'requires-approval') {
    return {
      supported: true,
      enabled: false,
      needsApproval: true,
      note: 'Allow Dumka Mail in System Settings → General → Login Items to finish.',
    };
  }
  const enabled = input.openAtLogin === true || input.status === 'enabled';
  return {
    supported: true,
    enabled,
    needsApproval: false,
    note: enabled ? 'Opens when you log in to this Mac.' : LOGIN_ITEM_DESCRIPTION,
  };
}
