// Sender sections in the renderer (`shared/senderSections.ts`): the person's
// standing "always sort mail from this sender into …" choices. They live in
// settings (renderer-owned, saved as one blob); the main process only reads
// them. Created from the `V` popover (`⇧`) or the offer after a move, undone
// from the toast, listed and removed on the account page.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { getSenderSections, normalizeAccountId, type AccountSettingsSource } from '../../../shared/accountSettings';
import {
  SENDER_SECTION_ARCHIVE_RULE_OFF,
  createSenderSection,
  deleteSenderSection,
  senderSectionCreatedMessage,
  undoSenderSection,
  type CreateSenderSectionInput,
  type CreateSenderSectionResult,
} from '../../../shared/senderSections';
import type { AppSettings, MailThread, SenderSection, SenderSectionTarget } from '../../../shared/types';
import { emitToast } from '../lib/toastBus';

interface UseSenderSectionsProps {
  settings: AppSettings;
  updateSettings: (updater: (settings: AppSettings) => void) => Promise<void>;
}

const NO_SECTIONS: readonly SenderSection[] = [];

export type SenderSectionOutcome = Pick<CreateSenderSectionResult<AccountSettingsSource>, 'section' | 'replaced' | 'disabledRule'>;

/** A choice whose settings update is queued; `outcome` is set by the update that was actually applied. */
export interface PendingSenderSection {
  accountId: string;
  senderName: string;
  input: CreateSenderSectionInput & { now: Date };
  outcome: SenderSectionOutcome | null;
}

/** A recorded outcome whose section never shows up in settings is given up on after this long. */
const PENDING_SENDER_SECTION_MAX_AGE_MS = 15_000;

/**
 * Splits queued choices against the committed settings:
 * - `announce`: applied and still the sender's section. Its outcome is the
 *   one to offer Undo for.
 * - `waiting`: the update has not run yet, or ran in a render that is not
 *   committed yet.
 * A choice that was applied but already replaced (two choices for one sender
 * before a render) is dropped: only the later one is announced, and its
 * outcome names the earlier one as what it replaced.
 */
export function settleSenderSections(
  pending: readonly PendingSenderSection[],
  settings: AccountSettingsSource,
  now: Date = new Date(),
): { announce: Array<PendingSenderSection & { outcome: SenderSectionOutcome }>; waiting: PendingSenderSection[] } {
  const announce: Array<PendingSenderSection & { outcome: SenderSectionOutcome }> = [];
  const waiting: PendingSenderSection[] = [];
  for (const entry of pending) {
    const expired = now.getTime() - entry.input.now.getTime() > PENDING_SENDER_SECTION_MAX_AGE_MS;
    if (!entry.outcome) {
      if (!expired) waiting.push(entry);
      continue;
    }
    const sections = getSenderSections(settings, entry.accountId);
    if (sections.some(section => section.id === entry.input.id)) {
      announce.push(entry as PendingSenderSection & { outcome: SenderSectionOutcome });
      continue;
    }
    const sender = entry.outcome.section.senderEmail;
    const superseded = sections.some(section => section.senderEmail === sender);
    if (!superseded && !expired) waiting.push(entry);
  }
  return { announce, waiting };
}

/**
 * The name to show for the thread's sender (the author of its last message).
 * `senderNames` lists every participant, so it names the sender only when
 * there is exactly one; otherwise the address is the honest label.
 */
export function senderSectionSenderName(thread: Pick<MailThread, 'senderNames' | 'senderEmail'>): string {
  const names = thread.senderNames.map(name => name.trim()).filter(Boolean);
  return names.length === 1 ? names[0] : thread.senderEmail.trim();
}

export function useSenderSections({ settings, updateSettings }: UseSenderSectionsProps) {
  const overrides = settings.accountOverrides;
  /** Validated once per settings change, keyed by lowercased account id. */
  const sectionsByAccount = useMemo(() => {
    const map = new Map<string, readonly SenderSection[]>();
    for (const accountId of Object.keys(overrides || {})) {
      const key = normalizeAccountId(accountId);
      const sections = getSenderSections({ accountOverrides: overrides }, key);
      if (key && sections.length > 0) map.set(key, sections);
    }
    return map;
  }, [overrides]);
  const sectionsRef = useRef(sectionsByAccount);
  sectionsRef.current = sectionsByAccount;

  /** Stable identity; reads the latest settings. Pair it with `senderSectionsRevision` in memo dependencies. */
  const senderSectionsFor = useCallback(
    (accountId: string): readonly SenderSection[] => sectionsRef.current.get(normalizeAccountId(accountId)) || NO_SECTIONS,
    [],
  );

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pendingRef = useRef<PendingSenderSection[]>([]);

  // `updateSettings` runs its updater later, inside a state update, possibly
  // after other queued updates. What a choice replaced and which rule it
  // switched off is therefore only known from the update that was applied:
  // the updater records it, and the toast (with its Undo) is raised here,
  // once the settings that contain the section are committed.
  useEffect(() => {
    if (pendingRef.current.length === 0) return;
    const { announce, waiting } = settleSenderSections(pendingRef.current, settings);
    pendingRef.current = waiting;
    for (const entry of announce) {
      const outcome = entry.outcome;
      emitToast({
        type: 'success',
        message: `${senderSectionCreatedMessage(entry.senderName, entry.input.section)}${outcome.disabledRule ? ` ${SENDER_SECTION_ARCHIVE_RULE_OFF}` : ''}`,
        actionLabel: 'Undo',
        duration: 8000,
        onAction: () => {
          void updateSettings(next => {
            next.accountOverrides = undoSenderSection(next, entry.accountId, outcome).accountOverrides;
          }).catch(error => {
            console.error('Failed to undo the sender section:', error);
            emitToast({ type: 'error', message: 'Could not undo.' });
          });
        },
      });
    }
  }, [settings, updateSettings]);

  /** Creates (or replaces) the sender's section. Returns false when it could not be made. */
  const alwaysSortSender = useCallback(async (thread: MailThread, target: SenderSectionTarget): Promise<boolean> => {
    const accountId = normalizeAccountId(thread.accountId);
    const pending: PendingSenderSection = {
      accountId,
      senderName: senderSectionSenderName(thread),
      input: { id: crypto.randomUUID(), senderEmail: thread.senderEmail, senderName: senderSectionSenderName(thread), section: target, now: new Date() },
      outcome: null,
    };
    try {
      // A refusal (no sender, the account itself) depends only on the input:
      // found here, never inside the state update.
      createSenderSection(settingsRef.current, accountId, pending.input);
      pendingRef.current = [...pendingRef.current, pending];
      await updateSettings(next => {
        const result = createSenderSection(next, accountId, pending.input);
        next.accountOverrides = result.settings.accountOverrides;
        pending.outcome = { section: result.section, replaced: result.replaced, disabledRule: result.disabledRule };
      });
    } catch (error) {
      pendingRef.current = pendingRef.current.filter(entry => entry !== pending);
      console.error('Failed to save the sender section:', error);
      emitToast({ type: 'error', message: 'Could not save the choice for this sender.' });
      return false;
    }
    return true;
  }, [updateSettings]);

  const removeSenderSection = useCallback(async (accountId: string, sectionId: string) => {
    await updateSettings(next => {
      next.accountOverrides = deleteSenderSection(next, accountId, sectionId).accountOverrides;
    });
  }, [updateSettings]);

  return {
    senderSectionsFor,
    /** Changes whenever any account's sender sections change. */
    senderSectionsRevision: sectionsByAccount,
    alwaysSortSender,
    removeSenderSection,
  };
}

export type SenderSectionsState = ReturnType<typeof useSenderSections>;
