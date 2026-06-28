import { MailThread, TriageRecommendation, MailTriagePlan, AutomationRulePreview } from './types';
import { MailSignalClassifier } from './classifier';

export const AutomationRulePreviewBuilder = {
  build(threadsList: MailThread[]): AutomationRulePreview {
    const candidates = [
      {
        id: 'unread-automation',
        title: 'Unread automation',
        criteria: 'Unread no-reply, code, digest, or notification mail',
        recommendation: 'readNow' as TriageRecommendation,
        priority: 100,
        predicate: (t: MailThread) => t.isUnread && MailSignalClassifier.isLowPriorityAutomation(t)
      },
      {
        id: 'security-codes',
        title: 'Security codes',
        criteria: 'Verification or login-code wording from automation',
        recommendation: 'readNow' as TriageRecommendation,
        priority: 90,
        predicate: (t: MailThread) => MailSignalClassifier.isVerificationOrSecurityCode(t)
      },
      {
        id: 'read-automation',
        title: 'Read automation',
        criteria: 'Read automated updates already seen',
        recommendation: 'markDoneCandidate' as TriageRecommendation,
        priority: 80,
        predicate: (t: MailThread) => !t.isUnread && MailSignalClassifier.isLowPriorityAutomation(t)
      },
      {
        id: 'marketing-digests',
        title: 'Marketing and digests',
        criteria: 'Promotions, newsletters, digests, or campaign mail',
        recommendation: 'markDoneCandidate' as TriageRecommendation,
        priority: 70,
        predicate: (t: MailThread) => MailSignalClassifier.isMarketingAutomation(t)
      },
      {
        id: 'bot-notifications',
        title: 'Bot notifications',
        criteria: 'No-reply, bot, dependency, or service notifications',
        recommendation: 'markDoneCandidate' as TriageRecommendation,
        priority: 60,
        predicate: (t: MailThread) => MailSignalClassifier.isAutomatedSender(t) && !MailSignalClassifier.isVerificationOrSecurityCode(t)
      }
    ];

    const rules = candidates
      .map(candidate => {
        const matchCount = threadsList.filter(candidate.predicate).length;
        if (matchCount === 0) return null;
        return {
          id: candidate.id,
          title: candidate.title,
          criteria: candidate.criteria,
          recommendation: candidate.recommendation,
          matchCount,
          priority: candidate.priority
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => {
        if (a.matchCount === b.matchCount) {
          if (a.priority === b.priority) {
            return a.title.localeCompare(b.title);
          }
          return b.priority - a.priority;
        }
        return b.matchCount - a.matchCount;
      });

    return {
      rules: rules.slice(0, 4)
    };
  },

  matchingRuleIds(thread: MailThread): string[] {
    const candidates = [
      { id: 'unread-automation', predicate: (t: MailThread) => t.isUnread && MailSignalClassifier.isLowPriorityAutomation(t) },
      { id: 'security-codes', predicate: (t: MailThread) => MailSignalClassifier.isVerificationOrSecurityCode(t) },
      { id: 'read-automation', predicate: (t: MailThread) => !t.isUnread && MailSignalClassifier.isLowPriorityAutomation(t) },
      { id: 'marketing-digests', predicate: (t: MailThread) => MailSignalClassifier.isMarketingAutomation(t) },
      { id: 'bot-notifications', predicate: (t: MailThread) => MailSignalClassifier.isAutomatedSender(t) && !MailSignalClassifier.isVerificationOrSecurityCode(t) }
    ];
    return candidates.filter(c => c.predicate(thread)).map(c => c.id);
  }
};

export const MailTriagePlanner = {
  build(
    accountId: string,
    sourceTitle: string,
    threadsList: MailThread[],
    now: Date,
    intent: 'mailboxTriage' | 'automationCleanup',
    limit = 8
  ): MailTriagePlan {
    const items = threadsList
      .map(thread => {
        const rec = this.recommendation(thread, now, intent);
        return {
          item: {
            threadId: thread.id,
            subject: thread.subject,
            sender: thread.senderNames[0] || thread.senderEmail,
            recommendation: rec.kind,
            reason: rec.reason,
            priority: rec.priority,
            automationRuleIds: AutomationRulePreviewBuilder.matchingRuleIds(thread)
          },
          lastMessageAt: thread.lastMessageAt
        };
      })
      .sort((a, b) => {
        if (a.item.priority === b.item.priority) {
          return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
        }
        return b.item.priority - a.item.priority;
      })
      .slice(0, limit)
      .map(x => x.item);

    const autoPreview = intent === 'automationCleanup' ? AutomationRulePreviewBuilder.build(threadsList) : null;

    return {
      accountId,
      sourceTitle,
      generatedAt: now.toISOString(),
      sourceThreadCount: threadsList.length,
      items,
      intent,
      automationRulePreview: autoPreview && autoPreview.rules.length > 0 ? autoPreview : null
    };
  },

  recommendation(
    thread: MailThread,
    now: Date,
    intent: 'mailboxTriage' | 'automationCleanup'
  ): { kind: TriageRecommendation; reason: string; priority: number } {
    const isAuto = MailSignalClassifier.isLowPriorityAutomation(thread);
    if (isAuto) {
      if (thread.isUnread) {
        return {
          kind: 'readNow',
          reason: intent === 'automationCleanup' ? 'Unread automated update' : 'Unread low-priority automation',
          priority: 78
        };
      }
      return {
        kind: 'markDoneCandidate',
        reason: intent === 'automationCleanup' ? 'Read automated update' : 'Likely automated update',
        priority: 52
      };
    }

    const isImportant = MailSignalClassifier.isImportantCandidate(thread);
    if (thread.isUnread && isImportant) {
      return { kind: 'reply', reason: 'Unread important thread', priority: 100 };
    }
    if (thread.hasAttachments && thread.isUnread) {
      return { kind: 'reviewAttachment', reason: 'Unread thread has an attachment', priority: 90 };
    }
    
    const ageHrs = Math.max(0, (now.getTime() - new Date(thread.lastMessageAt).getTime()) / 3600000);
    if (thread.isUnread && ageHrs >= 18) {
      return { kind: 'setReminder', reason: 'Unread for more than 18 hours', priority: 82 };
    }
    if (thread.isUnread) {
      return { kind: 'readNow', reason: 'Unread thread', priority: 75 };
    }
    if (thread.hasAttachments) {
      return { kind: 'reviewAttachment', reason: 'Attachment may need review', priority: 65 };
    }

    const subject = thread.subject.toLowerCase();
    const isLowSignal = isAuto ||
      subject.includes('receipt') ||
      subject.includes('invoice') ||
      subject.includes('newsletter') ||
      subject.includes('digest') ||
      subject.includes('notification');
    if (isLowSignal) {
      return { kind: 'markDoneCandidate', reason: 'Likely automated update', priority: 52 };
    }

    if (ageHrs >= 48) {
      return { kind: 'markDoneCandidate', reason: 'Read thread older than 48 hours', priority: 45 };
    }

    return { kind: 'readNow', reason: 'Visible thread', priority: 30 };
  }
};
