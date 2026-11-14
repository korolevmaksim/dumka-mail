import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDown, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { useAppStore } from '../../stores/AppStore';
import { emitToast } from '../../lib/toastBus';
import {
  SETTINGS_BUTTON_CLASS,
  SETTINGS_SELECT_CLASS,
  SettingSourceBadge,
  Toggle,
} from './SettingsControls';
import { useConfirmDisconnectAccount } from './accountActions';
import {
  clearAccountOverride,
  deleteSenderRule,
  getSenderRules,
  normalizeAccountId,
  resolveAccountSettings,
  setAccountOverride,
  setSenderRuleEnabled,
  type AccountSettingKey,
  type AccountSettingValues,
} from '../../../../shared/accountSettings';
import { backgroundProvider, defaultBackgroundProvider, effectiveBackgroundModel, seedBackgroundProvider } from '../../lib/backgroundModel';
import { sanitizeGmailSignatureHtml } from '../../../../shared/textNormalizer';
import { senderRuleStatus, type SenderRuleStatus } from '../../../../shared/senderRules';
import type { Account, AgentAutonomy, ComposeSignatureSettings, SenderRule, SenderRuleStats } from '../../../../shared/types';

const AFTER_SEND_OPTIONS: Array<{ value: AccountSettingValues['afterSend']; label: string; summary: string }> = [
  { value: 'archive', label: 'Archive', summary: 'Archive the conversation' },
  { value: 'keep', label: 'Keep in inbox', summary: 'Keep the conversation in the inbox' },
];

const NOTIFICATION_OPTIONS: Array<{ value: AccountSettingValues['notifications']; label: string; summary: string }> = [
  { value: 'people', label: 'People only', summary: 'Only mail from people, invitations and security notices' },
  { value: 'all', label: 'All', summary: 'Every new message in the inbox' },
  { value: 'none', label: 'None', summary: 'No notifications for this account' },
];

const AUTONOMY_OPTIONS: Array<{ value: AccountSettingValues['agentAutonomy']; label: string }> = [
  { value: 'prepare', label: 'Prepare only' },
  { value: 'prepareAndRules', label: 'Prepare and apply my sender rules' },
];

export const AGENT_NEVER_LINE = 'It never sends, unsubscribes, answers invitations or deletes.';

const TITLE_CLASS = 'text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]';
const DESC_CLASS = 'text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]';

function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--rail-bg)]">
      {children}
    </div>
  );
}

interface AccountRowProps {
  rowKey: string;
  title: string;
  titleId: string;
  /** Rendered as a `<label>` for this control id when given. */
  controlId?: string;
  description: ReactNode;
  descriptionId: string;
  source?: 'app' | 'account';
  onReset?: () => void;
  controls?: ReactNode;
  children?: ReactNode;
}

function AccountRow({ rowKey, title, titleId, controlId, description, descriptionId, source, onReset, controls, children }: AccountRowProps) {
  return (
    <div
      data-setting-row={rowKey}
      role="group"
      aria-labelledby={titleId}
      className="flex flex-col gap-3 px-4 py-[max(var(--settings-row-py),10px)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-[240px] flex-col gap-0.5">
          {controlId ? (
            <label id={titleId} htmlFor={controlId} className={TITLE_CLASS}>{title}</label>
          ) : (
            <span id={titleId} className={TITLE_CLASS}>{title}</span>
          )}
          <span id={descriptionId} className={DESC_CLASS}>{description}</span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {source && <SettingSourceBadge source={source} />}
          {source === 'account' && onReset && (
            <button
              type="button"
              onClick={onReset}
              aria-label={`Reset ${title.toLowerCase()} to the app default`}
              className={SETTINGS_BUTTON_CLASS}
            >
              <RotateCcw aria-hidden="true" className="h-3 w-3" />
              Reset
            </button>
          )}
          {controls}
        </div>
      </div>
      {children}
    </div>
  );
}

function formatSince(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime()) || date.getTime() === 0) return 'Since an earlier version';
  return `Since ${date.toLocaleDateString([], { dateStyle: 'medium' })}`;
}

function senderRulesSummary(rules: SenderRule[], autonomy: AgentAutonomy): string {
  if (rules.length === 0) return 'No sender rules yet';
  if (autonomy !== 'prepareAndRules') {
    return `${rules.length} ${rules.length === 1 ? 'rule' : 'rules'} paused: the agent may only prepare for this account`;
  }
  const active = rules.filter(rule => rule.enabled).length;
  const corrections = rules.reduce((sum, rule) => sum + rule.bringBacks, 0);
  const senders = `${active} ${active === 1 ? 'sender' : 'senders'} archived on arrival`;
  const paused = rules.length - active > 0 ? `, ${rules.length - active} off` : '';
  const remembered = corrections > 0 ? `, ${corrections} ${corrections === 1 ? 'correction' : 'corrections'} remembered` : '';
  return `${senders}${paused}${remembered}`;
}

const RULE_STATUS_LABELS: Record<SenderRuleStatus, string> = {
  active: 'Active',
  paused: 'Paused (Prepare only)',
  off: 'Off',
  autoDisabled: 'Turned off after 2 bring-backs',
};

function countLabel(count: number, one: string, other: string): string {
  return `${count} ${count === 1 ? one : other}`;
}

function signatureSummary(signature: ComposeSignatureSettings | undefined, fallbackPlain: string): string {
  const plain = (signature?.signaturePlain ?? fallbackPlain).trim();
  if (plain) return plain.split('\n').map(line => line.trim()).filter(Boolean).join(' · ');
  if (signature?.signatureHtml?.trim()) return 'HTML signature';
  return 'No signature';
}

export function AccountSettingsPage({ account }: { account: Account }) {
  const store = useAppStore();
  const confirmDisconnect = useConfirmDisconnectAccount();
  const accountId = normalizeAccountId(account.email || account.id);
  const resolved = resolveAccountSettings(store.settings, accountId);
  const senderRules = getSenderRules(store.settings, accountId);
  const signature = store.settings.compose.signaturesByAccount?.[accountId];
  const needsReconnect = store.googleAuthIssues.some(issue => normalizeAccountId(issue.accountId) === accountId);
  const reconnecting = store.reauthorizingAccountId !== null && normalizeAccountId(store.reauthorizingAccountId) === accountId;

  const [signatureOpen, setSignatureOpen] = useState(false);
  const [signatureSyncing, setSignatureSyncing] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [calendarEnabled, setCalendarEnabled] = useState<boolean | null>(null);
  const [ruleStats, setRuleStats] = useState<SenderRuleStats[]>([]);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const ids = {
    signature: useId(), signatureDesc: useId(), signatureEditor: useId(), signaturePlain: useId(), signatureHtml: useId(),
    afterSend: useId(), afterSendDesc: useId(), afterSendControl: useId(),
    notifications: useId(), notificationsDesc: useId(), notificationsControl: useId(),
    autonomy: useId(), autonomyDesc: useId(), autonomyControl: useId(),
    model: useId(), modelDesc: useId(), modelControl: useId(),
    background: useId(), backgroundDesc: useId(), backgroundControl: useId(),
    rules: useId(), rulesDesc: useId(), rulesList: useId(),
    calendar: useId(), calendarDesc: useId(),
    heading: useId(),
  };

  // SettingsPanel keys this page by account, so editor state resets on switch.
  useEffect(() => {
    let cancelled = false;
    setCalendarEnabled(null);
    window.electronAPI.getGoogleIntegrationStatus(accountId)
      .then(status => { if (!cancelled) setCalendarEnabled(Boolean(status?.calendarEnabled)); })
      .catch(err => {
        console.error('Failed to read calendar access:', err);
        if (!cancelled) setCalendarEnabled(false);
      });
    return () => { cancelled = true; };
  }, [accountId]);

  // Learning counters per sender (main-process table), shown next to each rule.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      window.electronAPI.listSenderRuleStats(accountId)
        .then(rows => { if (!cancelled) setRuleStats(rows); })
        .catch(err => console.error('Failed to read sender rule counters:', err));
    };
    load();
    const unsubscribe = window.electronAPI.onSenderRulesChanged?.(event => {
      if (event.accountId === accountId) load();
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [accountId]);

  const backgroundModelInUse = effectiveBackgroundModel(
    store.settings,
    backgroundProvider(store.settings, store.aiProviderDesc, store.customEnv),
    store.customEnv,
  );

  const setOverride = <K extends AccountSettingKey>(key: K, value: AccountSettingValues[K]) => {
    void store.updateSettings(settings => {
      settings.accountOverrides = setAccountOverride(settings, accountId, key, value).accountOverrides;
    });
  };

  const resetOverride = (key: AccountSettingKey) => {
    void store.updateSettings(settings => {
      settings.accountOverrides = clearAccountOverride(settings, accountId, key).accountOverrides;
    });
  };

  const updateSignature = (updater: (entry: ComposeSignatureSettings) => ComposeSignatureSettings) => {
    void store.updateSettings(settings => {
      const existing = settings.compose.signaturesByAccount?.[accountId] || {
        signaturePlain: settings.compose.defaultSignature || '',
        signatureHtml: settings.compose.defaultSignatureHtml || '',
        signatureFormat: settings.compose.signatureFormat || (settings.compose.defaultSignatureHtml.trim() ? 'html' : 'plain'),
      };
      settings.compose.signaturesByAccount = {
        ...(settings.compose.signaturesByAccount || {}),
        [accountId]: updater(existing),
      };
    });
  };

  const resetSignature = () => {
    void store.updateSettings(settings => {
      const next = { ...(settings.compose.signaturesByAccount || {}) };
      delete next[accountId];
      settings.compose.signaturesByAccount = next;
    });
  };

  const syncSignature = async () => {
    setSignatureSyncing(true);
    try {
      const result = await store.syncGmailSignature(account.email);
      emitToast(result.found
        ? { type: 'success', message: `Gmail signature synced for ${account.email}.` }
        : { type: 'info', message: `No Gmail signature found for ${account.email}.` });
    } catch (err) {
      console.error('Gmail signature sync failed:', err);
      emitToast({ type: 'error', message: 'Could not sync the Gmail signature. Please try again.' });
    } finally {
      setSignatureSyncing(false);
    }
  };

  const connectCalendar = async () => {
    setCalendarBusy(true);
    try {
      await store.authorizeGoogleIntegration('calendar', account.email);
      const status = await window.electronAPI.getGoogleIntegrationStatus(accountId);
      setCalendarEnabled(Boolean(status?.calendarEnabled));
    } catch (err) {
      console.error('Calendar authorization failed:', err);
      emitToast({ type: 'error', message: `Could not connect the calendar for ${account.email}.` });
    } finally {
      setCalendarBusy(false);
    }
  };

  const toggleRule = (rule: SenderRule, enabled: boolean) => {
    void store.updateSettings(settings => {
      settings.accountOverrides = setSenderRuleEnabled(settings, accountId, rule.id, enabled).accountOverrides;
    });
  };

  const removeRule = (rule: SenderRule) => {
    void store.updateSettings(settings => {
      settings.accountOverrides = deleteSenderRule(settings, accountId, rule.id).accountOverrides;
    });
    emitToast({ type: 'info', message: `Rule for ${rule.senderName || rule.senderEmail} deleted.` });
  };

  const afterSendOption = AFTER_SEND_OPTIONS.find(option => option.value === resolved.afterSend.value) ?? AFTER_SEND_OPTIONS[0];
  const notificationOption = NOTIFICATION_OPTIONS.find(option => option.value === resolved.notifications.value) ?? NOTIFICATION_OPTIONS[0];
  const signaturePlain = signature?.signaturePlain ?? store.settings.compose.defaultSignature;
  const signatureHtml = signature?.signatureHtml ?? store.settings.compose.defaultSignatureHtml;

  return (
    <section
      data-account-settings={accountId}
      aria-labelledby={ids.heading}
      className="flex w-full max-w-[760px] flex-col gap-4 select-text"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <h2 id={ids.heading} className="min-w-0 truncate text-[calc(18px*var(--font-scale))] font-semibold leading-tight text-[var(--text-primary)]">
              {account.email}
            </h2>
            <span
              data-account-status={needsReconnect ? 'reconnect' : 'connected'}
              className="inline-flex items-center gap-1.5 rounded-[5px] border border-[var(--border)] px-1.5 py-0.5 text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]"
            >
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${needsReconnect ? 'bg-[var(--warning)]' : 'bg-[var(--success)]'}`} />
              {needsReconnect ? 'Reconnect needed' : 'Connected'}
            </span>
          </div>
          <p className={`${DESC_CLASS} max-w-[560px]`}>
            Settings on this page apply to this account only. Anything you have not changed follows the app defaults.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void store.reauthorizeAccount(account.email)}
            disabled={store.reauthorizingAccountId !== null}
            className={SETTINGS_BUTTON_CLASS}
          >
            {reconnecting ? 'Reconnecting…' : 'Reconnect'}
          </button>
          <button
            type="button"
            onClick={() => confirmDisconnect(account)}
            className={`${SETTINGS_BUTTON_CLASS} border-[var(--danger)] text-[var(--danger-solid)] hover:border-[var(--danger)]`}
          >
            Disconnect
          </button>
        </div>
      </header>

      <SettingsCard>
        <AccountRow
          rowKey="signature"
          title="Signature"
          titleId={ids.signature}
          description={signatureSummary(signature, store.settings.compose.defaultSignature)}
          descriptionId={ids.signatureDesc}
          source={signature ? 'account' : 'app'}
          onReset={resetSignature}
          controls={(
            <button
              type="button"
              onClick={() => setSignatureOpen(open => !open)}
              aria-expanded={signatureOpen}
              aria-controls={ids.signatureEditor}
              className={SETTINGS_BUTTON_CLASS}
            >
              {signatureOpen ? 'Done' : 'Edit'}
            </button>
          )}
        >
          {signatureOpen && (
            <div id={ids.signatureEditor} className="flex flex-col gap-2">
              {signatureHtml.trim() && (
                <div className="flex flex-col gap-1">
                  <span className={DESC_CLASS}>HTML preview</span>
                  <div className="min-h-[44px] overflow-auto rounded-[6px] border border-[var(--border)] bg-[var(--app-bg)] px-3 py-2 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)]">
                    <div dangerouslySetInnerHTML={{ __html: sanitizeGmailSignatureHtml(signatureHtml) }} />
                  </div>
                  <label htmlFor={ids.signatureHtml} className={DESC_CLASS}>HTML</label>
                  <textarea
                    id={ids.signatureHtml}
                    value={signatureHtml}
                    onChange={event => {
                      const value = event.target.value;
                      updateSignature(entry => ({ ...entry, signatureHtml: value, signatureFormat: value.trim() ? 'html' : 'plain' }));
                    }}
                    className="min-h-[72px] resize-y rounded-[6px] border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 font-mono text-[calc(11px*var(--font-scale))] leading-normal text-[var(--text-primary)] outline-none focus:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                  />
                </div>
              )}
              <label htmlFor={ids.signaturePlain} className={DESC_CLASS}>
                {signatureHtml.trim() ? 'Plain-text fallback' : 'Signature text'}
              </label>
              <textarea
                id={ids.signaturePlain}
                value={signaturePlain}
                placeholder="e.g. Best regards, Alex"
                onChange={event => {
                  const value = event.target.value;
                  updateSignature(entry => ({ ...entry, signaturePlain: value, signatureFormat: entry.signatureHtml.trim() ? 'html' : 'plain' }));
                }}
                className="min-h-[64px] resize-y rounded-[6px] border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(12px*var(--font-scale))] leading-normal text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              />
              <div>
                <button type="button" onClick={() => void syncSignature()} disabled={signatureSyncing} className={SETTINGS_BUTTON_CLASS}>
                  <RefreshCw aria-hidden="true" className={`h-3 w-3 ${signatureSyncing ? 'animate-spin' : ''}`} />
                  {signatureSyncing ? 'Syncing…' : 'Sync from Gmail'}
                </button>
              </div>
            </div>
          )}
        </AccountRow>

        <AccountRow
          rowKey="afterSend"
          title="After sending a reply"
          titleId={ids.afterSend}
          controlId={ids.afterSendControl}
          description={afterSendOption.summary}
          descriptionId={ids.afterSendDesc}
          source={resolved.afterSend.source}
          onReset={() => resetOverride('afterSend')}
          controls={(
            <select
              id={ids.afterSendControl}
              aria-describedby={ids.afterSendDesc}
              value={resolved.afterSend.value}
              onChange={event => setOverride('afterSend', event.target.value === 'keep' ? 'keep' : 'archive')}
              className={SETTINGS_SELECT_CLASS}
            >
              {AFTER_SEND_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          )}
        />

        <AccountRow
          rowKey="notifications"
          title="Notifications"
          titleId={ids.notifications}
          controlId={ids.notificationsControl}
          description={notificationOption.summary}
          descriptionId={ids.notificationsDesc}
          source={resolved.notifications.source}
          onReset={() => resetOverride('notifications')}
          controls={(
            <select
              id={ids.notificationsControl}
              aria-describedby={ids.notificationsDesc}
              value={resolved.notifications.value}
              onChange={event => {
                const option = NOTIFICATION_OPTIONS.find(candidate => candidate.value === event.target.value);
                if (option) setOverride('notifications', option.value);
              }}
              className={SETTINGS_SELECT_CLASS}
            >
              {NOTIFICATION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          )}
        />
      </SettingsCard>

      <SettingsCard>
        <AccountRow
          rowKey="agentAutonomy"
          title="What the agent may do on its own"
          titleId={ids.autonomy}
          controlId={ids.autonomyControl}
          description={`Sender rules you approved can archive mail on arrival. ${AGENT_NEVER_LINE}`}
          descriptionId={ids.autonomyDesc}
          source={resolved.agentAutonomy.source}
          onReset={() => resetOverride('agentAutonomy')}
          controls={(
            <select
              id={ids.autonomyControl}
              aria-describedby={ids.autonomyDesc}
              value={resolved.agentAutonomy.value}
              onChange={event => setOverride('agentAutonomy', event.target.value === 'prepareAndRules' ? 'prepareAndRules' : 'prepare')}
              className={SETTINGS_SELECT_CLASS}
            >
              {AUTONOMY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          )}
        />

        <AccountRow
          rowKey="backgroundSorting"
          title="Sort new mail with the model in the background"
          titleId={ids.background}
          description={!resolved.modelMayReadMail.value
            ? 'Has no effect while mail text may not be sent to the model'
            : resolved.backgroundSorting.value
              ? (backgroundModelInUse
                ? `Uses ${backgroundModelInUse}, chosen in Settings → AI model`
                : 'No model is chosen for background work yet: choose one in Settings → AI model')
              : 'Off: the model works only when you ask; mail is sorted by rules on this Mac'}
          descriptionId={ids.backgroundDesc}
          source={resolved.backgroundSorting.source}
          onReset={() => resetOverride('backgroundSorting')}
          controls={(
            <Toggle
              id={ids.backgroundControl}
              checked={resolved.backgroundSorting.value}
              onChange={value => {
                void store.updateSettings(settings => {
                  settings.accountOverrides = setAccountOverride(settings, accountId, 'backgroundSorting', value).accountOverrides;
                  // The background provider is always explicit once anything runs unattended.
                  if (value) seedBackgroundProvider(settings, defaultBackgroundProvider(store.aiProviderDesc, store.customEnv));
                });
              }}
              ariaLabelledBy={ids.background}
              ariaDescribedBy={ids.backgroundDesc}
            />
          )}
        />

        <AccountRow
          rowKey="modelMayReadMail"
          title="Mail text may be sent to the model"
          titleId={ids.model}
          description={resolved.modelMayReadMail.value
            ? 'On: summaries, reply drafts and Ask Dumka may send this account’s mail text to the model you chose'
            : 'Off: nothing from this account is sent to a model; no summaries, drafts or model sorting'}
          descriptionId={ids.modelDesc}
          source={resolved.modelMayReadMail.source}
          onReset={() => resetOverride('modelMayReadMail')}
          controls={(
            <Toggle
              id={ids.modelControl}
              checked={resolved.modelMayReadMail.value}
              onChange={value => setOverride('modelMayReadMail', value)}
              ariaLabelledBy={ids.model}
              ariaDescribedBy={ids.modelDesc}
            />
          )}
        />

        <AccountRow
          rowKey="senderRules"
          title="Sender rules"
          titleId={ids.rules}
          description={senderRulesSummary(senderRules, resolved.agentAutonomy.value)}
          descriptionId={ids.rulesDesc}
          controls={senderRules.length > 0 ? (
            <button
              type="button"
              onClick={() => setRulesOpen(open => !open)}
              aria-expanded={rulesOpen}
              aria-controls={ids.rulesList}
              className={SETTINGS_BUTTON_CLASS}
            >
              {rulesOpen ? 'Hide rules' : 'Review rules'}
              <ChevronDown aria-hidden="true" className={`h-3 w-3 transition-transform ${rulesOpen ? 'rotate-180' : ''}`} />
            </button>
          ) : undefined}
        >
          {rulesOpen && senderRules.length > 0 && (
            <ul id={ids.rulesList} aria-label="Sender rules" className="flex flex-col divide-y divide-[var(--border)] rounded-[6px] border border-[var(--border)] bg-[var(--panel-bg)]">
              {senderRules.map(rule => {
                const name = rule.senderName || rule.senderEmail;
                const status = senderRuleStatus(rule, resolved.agentAutonomy.value);
                const stats = ruleStats.find(row => row.senderEmail === rule.senderEmail);
                const confirmations = Math.max(rule.confirmations, stats?.confirmations ?? 0);
                return (
                  <li key={rule.id} data-sender-rule={rule.id} data-sender-rule-status={status} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[calc(12px*var(--font-scale))] font-medium text-[var(--text-primary)]">{name}</span>
                      <span className={`${DESC_CLASS} truncate`}>
                        {rule.senderName ? `${rule.senderEmail} · ` : ''}{formatSince(rule.createdAt)} · {RULE_STATUS_LABELS[status]}
                      </span>
                      <span className={`${DESC_CLASS} truncate`}>
                        {countLabel(confirmations, 'confirmation', 'confirmations')} · {countLabel(rule.bringBacks, 'bring-back', 'bring-backs')}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Toggle
                        checked={rule.enabled}
                        onChange={value => toggleRule(rule, value)}
                        ariaLabel={`Archive mail from ${name} on arrival`}
                      />
                      <button
                        type="button"
                        onClick={() => removeRule(rule)}
                        aria-label={`Delete rule for ${name}`}
                        className={`${SETTINGS_BUTTON_CLASS} px-2 text-[var(--danger-solid)]`}
                      >
                        <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </AccountRow>
      </SettingsCard>

      <SettingsCard>
        <AccountRow
          rowKey="calendar"
          title="Calendar"
          titleId={ids.calendar}
          description="Needed to answer invitations from the inbox"
          descriptionId={ids.calendarDesc}
          controls={calendarEnabled ? (
            <span data-calendar-status="connected" className="inline-flex items-center gap-1.5 text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
              Connected
            </span>
          ) : (
            <button
              type="button"
              data-calendar-status={calendarEnabled === null ? 'loading' : 'disconnected'}
              onClick={() => void connectCalendar()}
              disabled={calendarBusy || calendarEnabled === null}
              aria-describedby={ids.calendarDesc}
              className={SETTINGS_BUTTON_CLASS}
            >
              {calendarBusy ? 'Connecting…' : 'Connect'}
            </button>
          )}
        />
      </SettingsCard>
    </section>
  );
}
