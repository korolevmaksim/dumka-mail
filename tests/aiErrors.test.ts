import { describe, expect, it } from 'vitest';
import { formatAIUserError } from '../shared/aiErrors';

describe('formatAIUserError', () => {
  it('keeps provider error details but redacts secrets', () => {
    const err = new Error('Anthropic HTTP 400: x-api-key: fixture-anthropic-secret thinking.adaptive.effort: Extra inputs are not permitted');

    const message = formatAIUserError(err);

    expect(message).toContain('Anthropic HTTP 400');
    expect(message).toContain('thinking.adaptive.effort');
    expect(message).not.toContain('fixture-anthropic-secret');
  });
});
