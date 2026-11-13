import { useEffect, useState } from 'react';
import { useAppStore } from '../../../stores/AppStore';
import { SETTINGS_BUTTON_CLASS, SETTINGS_PRIMARY_BUTTON_CLASS } from '../SettingsControls';
import { SettingRow, SettingsCard, SettingsGroup, SettingsPage, SETTING_DESC_CLASS } from './SettingsPageParts';
import { appUpdateStatusText, canCheckForAppUpdates, formatMeasuredMs, offlineCoverageText } from './settingsCopy';
import type { AutoUpdateStatus } from '../../../../../shared/autoUpdate';

export function AboutTab() {
  const store = useAppStore();
  const [updateStatus, setUpdateStatus] = useState<AutoUpdateStatus | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [repairing, setRepairing] = useState(false);

  useEffect(() => {
    let mounted = true;
    window.electronAPI.getAutoUpdateStatus()
      .then(status => {
        if (mounted) setUpdateStatus(status);
      })
      .catch(err => {
        console.error('Failed to load auto-update status:', err);
      });
    const unsubscribe = window.electronAPI.onAutoUpdateStatus(status => {
      if (mounted) setUpdateStatus(status);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const checkForUpdates = async () => {
    setUpdateBusy(true);
    try {
      setUpdateStatus(await window.electronAPI.checkForAppUpdates());
    } catch (err) {
      console.error('Failed to check for app updates:', err);
    } finally {
      setUpdateBusy(false);
    }
  };

  const installUpdate = async () => {
    setUpdateBusy(true);
    try {
      setUpdateStatus(await window.electronAPI.installDownloadedAppUpdate());
    } catch (err) {
      console.error('Failed to install downloaded update:', err);
      setUpdateBusy(false);
    }
  };

  const repairOffline = async () => {
    setRepairing(true);
    try {
      await store.triggerVisibleBodyRepair();
    } finally {
      setRepairing(false);
    }
  };

  const checking = updateStatus?.state === 'checking' || updateBusy;
  const speed = store.speedProof;
  const speedRows: Array<{ key: string; title: string; description: string; ms: number | undefined }> = [
    { key: 'cacheReadyMs', title: 'Opening your mailbox', description: 'The last time mail was loaded from this Mac', ms: speed.cacheReadyMs },
    { key: 'syncReadyMs', title: 'Getting new mail', description: 'The last check of Gmail for new mail', ms: speed.syncReadyMs },
    { key: 'searchMs', title: 'Searching', description: 'The last search on this Mac', ms: speed.searchMs },
    { key: 'aiMs', title: 'Model answer', description: 'The last answer from the model', ms: speed.aiMs },
  ];

  return (
    <SettingsPage
      pageKey="about"
      title="About"
      description="Dumka Mail sorts your Gmail inbox into what needs a decision and prepares replies with the model you choose. Your mail is kept on this Mac."
    >
      <SettingsCard>
        <SettingRow
          rowKey="version"
          title="Dumka Mail"
          description={updateStatus?.version ? `Version ${updateStatus.version}` : 'Reading the version…'}
        />
        <SettingRow
          rowKey="appUpdates"
          title="App updates"
          description={appUpdateStatusText(updateStatus)}
          control={({ descriptionId }) => (
            <>
              {updateStatus?.state === 'downloaded' && (
                <button
                  type="button"
                  onClick={() => void installUpdate()}
                  disabled={updateBusy}
                  aria-describedby={descriptionId}
                  className={SETTINGS_PRIMARY_BUTTON_CLASS}
                >
                  Restart to update
                </button>
              )}
              <button
                type="button"
                onClick={() => void checkForUpdates()}
                disabled={updateBusy || !canCheckForAppUpdates(updateStatus)}
                aria-describedby={descriptionId}
                className={SETTINGS_BUTTON_CLASS}
              >
                {checking ? 'Checking…' : 'Check now'}
              </button>
            </>
          )}
        />
      </SettingsCard>

      <SettingsGroup title="Speed on this Mac">
        <SettingsCard>
          {speedRows.map(row => (
            <SettingRow
              key={row.key}
              rowKey={row.key}
              title={row.title}
              description={row.description}
              control={() => (
                <span className={`${SETTING_DESC_CLASS} font-medium tabular-nums text-[var(--text-primary)]`}>{formatMeasuredMs(row.ms)}</span>
              )}
            />
          ))}
          <SettingRow
            rowKey="offlineCoverage"
            title="Messages ready offline"
            description={offlineCoverageText(speed.detailCacheCoverage)}
            control={({ descriptionId }) => (
              <button
                type="button"
                onClick={() => void repairOffline()}
                disabled={repairing}
                aria-describedby={descriptionId}
                className={SETTINGS_BUTTON_CLASS}
              >
                {repairing ? 'Downloading…' : 'Download messages on screen'}
              </button>
            )}
          />
        </SettingsCard>
      </SettingsGroup>
    </SettingsPage>
  );
}
