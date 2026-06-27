import { MailThread } from './types';

export const MailSignalClassifier = {
  isImportantCandidate(thread: MailThread): boolean {
    return this.hasAnyLabel(thread, ['IMPORTANT', 'CATEGORY_PRIMARY']) && !this.isLowPriorityAutomation(thread);
  },

  isLowPriorityAutomation(thread: MailThread): boolean {
    return this.isVerificationOrSecurityCode(thread) || this.isAutomatedUpdate(thread) || this.isAutomatedSender(thread);
  },

  isAutomatedSender(thread: MailThread): boolean {
    const sender = `${thread.senderNames.join(' ')} ${thread.senderEmail}`.toLowerCase();
    return sender.includes('noreply') ||
      sender.includes('no-reply') ||
      sender.includes('do-not-reply') ||
      sender.includes('donotreply') ||
      sender.includes('dependabot');
  },

  hasAnyLabel(thread: MailThread, labels: string[]): boolean {
    const upperLabels = labels.map(l => l.toUpperCase());
    return thread.labelIds.some(label => upperLabels.includes((label as string).toUpperCase()));
  },

  isVerificationOrSecurityCode(thread: MailThread): boolean {
    const isAuto = this.isAutomatedSender(thread);
    const hasCategory = this.hasAnyLabel(thread, ['CATEGORY_UPDATES', 'CATEGORY_PROMOTIONS']);
    if (!isAuto && !hasCategory) {
      return false;
    }
    const text = `${thread.subject} ${thread.snippet}`.toLowerCase();
    return text.includes('verification code') ||
      text.includes('security code') ||
      text.includes('confirmation code') ||
      text.includes('one-time code') ||
      text.includes('one time code') ||
      text.includes('login code') ||
      text.includes('authentication code') ||
      text.includes('verify your email') ||
      text.includes('verification page') ||
      text.includes('enter this code') ||
      text.includes('this code will expire');
  },

  isAutomatedUpdate(thread: MailThread): boolean {
    const subject = thread.subject.toLowerCase();
    return subject.includes('newsletter') ||
      subject.includes('digest') ||
      subject.includes('notification');
  },

  isMarketingAutomation(thread: MailThread): boolean {
    const subject = thread.subject.toLowerCase();
    return this.hasAnyLabel(thread, ['CATEGORY_PROMOTIONS']) ||
      subject.includes('newsletter') ||
      subject.includes('digest') ||
      subject.includes('promotion') ||
      subject.includes('discount') ||
      subject.includes('sale');
  }
};

export type SplitInboxKind = string;

export const SplitInboxRouter = {
  split(thread: MailThread): SplitInboxKind {
    if (this.isPurchase(thread)) {
      return 'purchases';
    }
    if (this.isLinkedIn(thread)) {
      return 'linkedIn';
    }
    if (this.isImportant(thread)) {
      return 'important';
    }
    if (this.isAutomation(thread)) {
      return 'automation';
    }
    return 'other';
  },

  includes(thread: MailThread, split: SplitInboxKind): boolean {
    return this.split(thread) === split;
  },

  isImportant(thread: MailThread): boolean {
    return MailSignalClassifier.isImportantCandidate(thread);
  },

  isPurchase(thread: MailThread): boolean {
    const subject = thread.subject.toLowerCase();
    return subject.includes('receipt') ||
      subject.includes('invoice') ||
      subject.includes('order');
  },

  isLinkedIn(thread: MailThread): boolean {
    const senderEmail = thread.senderEmail.toLowerCase();
    const names = thread.senderNames.map(n => n.toLowerCase());
    return senderEmail.includes('linkedin') || names.some(n => n.includes('linkedin'));
  },

  isAutomation(thread: MailThread): boolean {
    return MailSignalClassifier.isLowPriorityAutomation(thread);
  }
};
