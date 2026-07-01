import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from '../renderer/src/stores/AppStore';

describe('mail notification defaults', () => {
  it('notifies for every new unread inbox message by default', () => {
    expect(DEFAULT_SETTINGS.notifications.desktopNotifications).toBe(true);
    expect(DEFAULT_SETTINGS.notifications.notifyImportantOnly).toBe(false);
  });

  it('migrates saved settings to notify for every new unread inbox message', () => {
    const merged = mergeSettings({
      settingsSchemaVersion: 5,
      notifications: {
        desktopNotifications: true,
        notifyImportantOnly: true,
      },
    });

    expect(merged.notifications.desktopNotifications).toBe(true);
    expect(merged.notifications.notifyImportantOnly).toBe(false);
  });
});
