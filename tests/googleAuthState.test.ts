import { describe, expect, it, vi } from 'vitest';
import {
  GoogleAuthState,
  googleReauthorizationReasonForApiResponse,
  googleReauthorizationReasonForTokenResponse,
} from '../main/googleAuthState';

describe('Google authorization state', () => {
  it('classifies revoked refresh tokens as requiring reauthorization', () => {
    expect(googleReauthorizationReasonForTokenResponse(400, JSON.stringify({
      error: 'invalid_grant',
      error_description: 'Token has been expired or revoked.',
    }))).toBe('credentials_rejected');

    expect(googleReauthorizationReasonForTokenResponse(401, JSON.stringify({
      error: 'unauthorized_client',
      error_description: 'Unauthorized',
    }))).toBe('credentials_rejected');
  });

  it('classifies lost Gmail permissions but not OAuth client configuration failures', () => {
    expect(googleReauthorizationReasonForApiResponse(403, JSON.stringify({
      error: {
        status: 'PERMISSION_DENIED',
        message: 'Request had insufficient authentication scopes.',
      },
    }))).toBe('permissions_changed');

    expect(googleReauthorizationReasonForTokenResponse(401, JSON.stringify({
      error: 'invalid_client',
      error_description: 'The OAuth client was not found.',
    }))).toBeNull();
  });

  it('publishes one issue until the account is restored', () => {
    const state = new GoogleAuthState();
    const listener = vi.fn();
    state.subscribe(listener);

    const first = state.mark(
      ' Alex@Example.com ',
      'credentials_rejected',
      '2026-07-23T08:00:00.000Z',
    );
    const duplicate = state.mark(
      'alex@example.com',
      'credentials_rejected',
      '2026-07-23T08:01:00.000Z',
    );

    expect(duplicate).toBe(first);
    expect(state.requiresReauthorization('ALEX@example.com')).toBe(true);
    expect(state.list()).toEqual([first]);
    expect(listener).toHaveBeenCalledTimes(1);

    state.clear('alex@example.com');
    expect(state.list()).toEqual([]);
    expect(listener).toHaveBeenLastCalledWith({
      accountId: 'alex@example.com',
      issue: null,
    });
  });
});
