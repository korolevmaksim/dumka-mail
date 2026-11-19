import type { MailMessage, MailThread } from '../shared/types';

/** Excludes deletions which overlap one account's asynchronous read, including its last published delta. */
export class MailboxRead {
  constructor(readonly excluded: Set<string>) {}

  threads(rows: MailThread[]): MailThread[] {
    return this.excluded.size ? rows.filter(row => !this.excluded.has(row.id)) : rows;
  }

  messages(rows: MailMessage[]): MailMessage[] {
    return this.excluded.size ? rows.filter(row => !this.excluded.has(row.threadId)) : rows;
  }
}
