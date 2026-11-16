// Sender sections in the renderer (`shared/senderSections.ts`): the person's
// standing "always sort mail from this sender into …" choices. They live in
// settings (renderer-owned, saved as one blob); the main process only reads
// them. Created from the `V` popover (`⇧`) or the offer after a move, undone
// from the toast, listed and removed on the account page.
import { useCallback, useMemo, useRef } from 'react';
import { getSenderSections, normalizeAccountId } from '../../../shared/accountSettings';
import {
  SENDER_SECTION_ARCHIVE_RULE_OFF,
  createSenderSection,
  deleteSenderSection,
  senderSectionCreatedMessage,
  undoSenderSection,
} from '../../../shared/senderSections';
import type { AppSettings, MailThread, SenderSection, SenderSectionTarget } from '../../../shared/types';
import { emitToast } from '../lib/toastBus';

interface UseSenderSectionsProps {
  settings: AppSettings;
  updateSettings: (updater: (settings: AppSettings) => void) => Promise<void>;
}

const NO_SECTIONS: readonly SenderSection[] = [];

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

  /** Creates (or replaces) the sender's section. Returns false when it could not be made. */
  const alwaysSortSender = useCallback(async (thread: MailThread, target: SenderSectionTarget): Promise<boolean> => {
    const accountId = normalizeAccountId(thread.accountId);
    const senderName = senderSectionSenderName(thread);
    const input = { id: crypto.randomUUID(), senderEmail: thread.senderEmail, senderName, section: target, now: new Date() };
    // `updateSettings` runs its updater later, inside a state update: the
    // outcome (and any refusal) is worked out here, against the settings as
    // they are now, and the updater repeats the same pure step on the state
    // it is given.
    let outcome: Pick<ReturnType<typeof createSenderSection>, 'section' | 'replaced' | 'disabledRule'>;
    try {
      const result = createSenderSection(settingsRef.current, accountId, input);
      outcome = { section: result.section, replaced: result.replaced, disabledRule: result.disabledRule };
      await updateSettings(next => {
        next.accountOverrides = createSenderSection(next, accountId, input).settings.accountOverrides;
      });
    } catch (error) {
      console.error('Failed to save the sender section:', error);
      emitToast({ type: 'error', message: 'Could not save the choice for this sender.' });
      return false;
    }
    emitToast({
      type: 'success',
      message: `${senderSectionCreatedMessage(senderName, target)}${outcome.disabledRule ? ` ${SENDER_SECTION_ARCHIVE_RULE_OFF}` : ''}`,
      actionLabel: 'Undo',
      duration: 8000,
      onAction: () => {
        void updateSettings(next => {
          next.accountOverrides = undoSenderSection(next, accountId, outcome).accountOverrides;
        }).catch(error => {
          console.error('Failed to undo the sender section:', error);
          emitToast({ type: 'error', message: 'Could not undo.' });
        });
      },
    });
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
