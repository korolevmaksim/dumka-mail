import { describe, expect, it } from 'vitest';
import { buildSummaryPrompt } from '../shared/agentPrompts';
import { summaryModelRoute, summarySettings, summarySettingsFingerprint, SUMMARY_INSTRUCTIONS_MAX } from '../shared/summarySettings';

describe('summary preferences', () => {
  it('inherits existing provider and model without introducing a built-in model', () => {
    expect(summaryModelRoute(undefined)).toEqual({ preference: 'automatic', overrideModel: undefined, dedicated: false });
    expect(summaryModelRoute({ provider: 'anthropic', globalDefaultModel: 'main-model' }))
      .toEqual({ preference: 'anthropic', overrideModel: 'main-model', dedicated: false });
  });

  it('does not send the primary provider model to a different summary provider', () => {
    expect(summaryModelRoute({ provider: 'anthropic', globalDefaultModel: 'main-model', summary: { provider: 'openAI' } }))
      .toEqual({ preference: 'openAI', overrideModel: undefined, dedicated: true });
    expect(summaryModelRoute({ provider: 'anthropic', summary: { model: 'summary-model' } }))
      .toEqual({ preference: 'anthropic', overrideModel: 'summary-model', dedicated: true });
  });

  it('normalizes malformed stored settings and bounds context', () => {
    expect(summarySettings({ summary: { provider: 'unknown', language: '__proto__', instructions: 5, model: null } }))
      .toEqual({ provider: '', model: '', language: 'auto', instructions: '' });
    expect(summarySettings({ summary: { instructions: 'a'.repeat(5000) } }).instructions).toHaveLength(SUMMARY_INSTRUCTIONS_MAX);
    expect(summarySettingsFingerprint({ summary: { language: 'ru' } })).not.toBe(summarySettingsFingerprint({ summary: { language: 'pl' } }));
  });

  it('adds language and user context to system instructions while treating mail as data', () => {
    const settings = summarySettings({ summary: { language: 'ru', instructions: 'I manage the project. Focus on blockers.' } });
    const prompt = buildSummaryPrompt({ thread: { subject: 'Feedback' }, messages: [], settings });
    expect(prompt.system).toContain('Write all summary bullets in Russian');
    expect(prompt.system).toContain(settings.instructions);
    expect(prompt.system).toContain('not proof that an event happened');
    expect(prompt.system).toContain('untrusted');
    expect(prompt.user).not.toContain(settings.instructions);
    expect(buildSummaryPrompt({ thread: { subject: '' }, messages: [] }).system).toContain('language of the latest substantive message');
  });
});
