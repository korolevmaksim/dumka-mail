import { describe, expect, it } from 'vitest';
import { fatalProcessFailureMessage, isLikelyCorruptDatabaseError, startupFailureMessage } from '../shared/startupFailure';

describe('startupFailure', () => {
  it('detects corrupt SQLite errors', () => {
    expect(isLikelyCorruptDatabaseError(new Error('SQLITE_CORRUPT: database disk image is malformed'))).toBe(true);
    expect(isLikelyCorruptDatabaseError(new Error('file is not a database'))).toBe(true);
    expect(isLikelyCorruptDatabaseError(new Error('network timeout'))).toBe(false);
  });

  it('includes a restore/move-aside path in the dialog copy', () => {
    expect(startupFailureMessage(new Error('SQLITE_CORRUPT'))).toContain('move the damaged database aside');
    expect(startupFailureMessage(new Error('SQLITE_CORRUPT'))).toContain('SQLITE_CORRUPT');
    expect(startupFailureMessage(new Error('SQLITE_CORRUPT'), 'runtime')).toContain('while running');
    expect(fatalProcessFailureMessage(new Error('boom'))).toContain('needs to quit');
  });
});
