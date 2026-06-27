import { describe, it, expect } from 'vitest';
import { MailSignalClassifier, SplitInboxRouter } from '../shared/classifier';
import { MailThread } from '../shared/types';

describe('MailSignalClassifier & SplitInboxRouter', () => {
  const baseThread: MailThread = {
    id: 't1',
    accountId: 'test@gmail.com',
    subject: 'Normal Email',
    snippet: 'This is a normal email snippet',
    lastMessageAt: new Date().toISOString(),
    senderNames: ['John Doe'],
    senderEmail: 'john@example.com',
    labelIds: ['INBOX', 'IMPORTANT'],
    hasAttachments: false,
    isUnread: true
  };

  it('classifies important emails correctly', () => {
    expect(MailSignalClassifier.isImportantCandidate(baseThread)).toBe(true);
    expect(SplitInboxRouter.split(baseThread)).toBe('important');
  });

  it('filters out low-priority automation from Important split', () => {
    const autoThread: MailThread = {
      ...baseThread,
      senderNames: ['No-Reply Team'],
      senderEmail: 'no-reply@company.com',
      subject: 'Weekly digest newsletter'
    };

    expect(MailSignalClassifier.isLowPriorityAutomation(autoThread)).toBe(true);
    expect(MailSignalClassifier.isImportantCandidate(autoThread)).toBe(false);
    expect(SplitInboxRouter.split(autoThread)).toBe('automation');
  });

  it('routes purchases to purchases split', () => {
    const purchaseThread: MailThread = {
      ...baseThread,
      subject: 'Your order invoice receipt #12345'
    };

    expect(SplitInboxRouter.split(purchaseThread)).toBe('purchases');
  });

  it('routes LinkedIn emails to LinkedIn split', () => {
    const linkedinThread: MailThread = {
      ...baseThread,
      senderNames: ['LinkedIn Jobs'],
      senderEmail: 'jobs-listings@linkedin.com'
    };

    expect(SplitInboxRouter.split(linkedinThread)).toBe('linkedIn');
  });
});
