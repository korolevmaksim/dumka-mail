// Removing rows from the `mail_search` full-text table.
//
// FTS5 reaches a row through its index or its rowid and through nothing else.
// `DELETE FROM mail_search WHERE account_id = ? AND thread_id = ?` therefore
// reads every indexed message, body included, to compare two columns: 160 ms
// per call on a 2 GB cache, whether or not anything matches. A sync pass that
// removed 184 conversations this way kept its thread busy for half a minute.
//
// The id columns are indexed like the text columns, so the id is looked up as
// a phrase in its own column first, and the plain comparison then only
// confirms the handful of rows the index returned.
import type Database from 'better-sqlite3';

export type MailSearchIdColumn = 'thread_id' | 'message_id';

/**
 * The full-text query that finds the rows whose `column` holds `id`, or null
 * when the id cannot be found through the index. A stored value and a query
 * are split into the same words, so the phrase finds its row whenever the id
 * holds at least one word; ASCII letters and digits always make one. A NUL
 * character would end the query text early.
 */
export function mailSearchIdQuery(column: MailSearchIdColumn, id: string): string | null {
  if (id.includes('\0') || !/[A-Za-z0-9]/.test(id)) return null;
  return `${column} : "${id.replace(/"/g, '""')}"`;
}

/** Returns a function that removes the search rows of one conversation or message of an account. */
export function mailSearchRowRemover(
  db: Database.Database,
  column: MailSearchIdColumn,
): (accountId: string, id: string) => void {
  const indexed = db.prepare(
    `DELETE FROM mail_search WHERE mail_search MATCH ? AND account_id = ? AND ${column} = ?`,
  );
  // Only for an id the index cannot look up, which Gmail never issues.
  let scanned: Database.Statement<[string, string]> | null = null;
  return (accountId, id) => {
    const query = mailSearchIdQuery(column, id);
    if (query) {
      indexed.run(query, accountId, id);
      return;
    }
    scanned ??= db.prepare<[string, string]>(`DELETE FROM mail_search WHERE account_id = ? AND ${column} = ?`);
    scanned.run(accountId, id);
  };
}
