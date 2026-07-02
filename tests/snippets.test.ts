import { describe, it, expect } from 'vitest';
import {
  createSnippetTemplateId,
  normalizeSnippetTemplates,
  renderTokens,
  renderDefaultSnippet,
  renderDefaultSnippetHtml,
  renderSnippetTemplate,
  renderSnippetTemplateHtml,
  expandSnippetAtCursor,
} from '../shared/snippets';
import type { ProfileSettings, SnippetSettings, ComposeSettings } from '../shared/types';

const profile: ProfileSettings = {
  fullName: 'Alex Example',
  role: 'Engineer',
  company: 'Example Co',
  timezone: 'UTC',
};

const snippets: SnippetSettings = {
  enabled: true,
  expandWithTab: true,
  includeSignature: true,
  defaultSnippetTrigger: ';thanks',
  defaultSnippet: 'Thanks, Alex',
  templates: [],
};

const compose: ComposeSettings = {
  defaultSignature: '',
  defaultSignatureHtml: '',
  signatureFormat: 'plain',
  signaturesByAccount: {},
  autoSaveDrafts: true,
  spellCheck: true,
  autocorrect: true,
  smartCompose: true,
  alwaysReplyAll: false,
  sendUndoDelay: 10,
  defaultFontSize: 'normal',
};

describe('renderTokens', () => {
  it('replaces every supported token', () => {
    const out = renderTokens(
      '{full_name} / {first_name} / {role} / {company}',
      profile,
    );
    expect(out).toBe('Alex Example / Alex / Engineer / Example Co');
  });

  it('derives first_name as the first whitespace word', () => {
    expect(renderTokens('{first_name}', { ...profile, fullName: 'Jean Luc Picard' })).toBe('Jean');
  });

  it('handles leading whitespace in full name for first_name', () => {
    expect(renderTokens('{first_name}', { ...profile, fullName: '  Ada Lovelace' })).toBe('Ada');
  });

  it('falls back to full name when there is no word for first_name', () => {
    expect(renderTokens('{first_name}', { ...profile, fullName: '' })).toBe('');
  });

  it('replaces multiple occurrences of the same token', () => {
    expect(renderTokens('{company}-{company}', profile)).toBe('Example Co-Example Co');
  });

  it('leaves text without tokens unchanged', () => {
    expect(renderTokens('plain text', profile)).toBe('plain text');
  });

  it('substitutes empty values for empty profile fields', () => {
    const out = renderTokens('{role}{company}', { ...profile, role: '', company: '' });
    expect(out).toBe('');
  });
});

describe('renderDefaultSnippet', () => {
  it('returns the body without signature when includeSignature is off', () => {
    const out = renderDefaultSnippet(
      { ...snippets, includeSignature: false },
      { ...compose, defaultSignature: 'Best,\nAlex' },
      profile,
    );
    expect(out).toBe('Thanks, Alex');
  });

  it('appends the rendered signature with a blank-line separator', () => {
    const out = renderDefaultSnippet(
      snippets,
      { ...compose, defaultSignature: '{first_name} @ {company}' },
      profile,
    );
    expect(out).toBe('Thanks, Alex\n\nAlex @ Example Co');
  });

  it('uses the signature saved for the draft account', () => {
    const out = renderDefaultSnippet(
      snippets,
      {
        ...compose,
        signaturesByAccount: {
          'work@example.com': {
            signaturePlain: '{first_name} @ Work',
            signatureHtml: '<div>Alex @ Work</div>',
            signatureFormat: 'html',
          },
          'personal@example.com': {
            signaturePlain: 'Personal Alex',
            signatureHtml: '',
            signatureFormat: 'plain',
          },
        },
      },
      profile,
      'work@example.com',
    );

    expect(out).toBe('Thanks, Alex\n\nAlex @ Work');
  });

  it('omits the signature when it renders empty even if includeSignature is on', () => {
    const out = renderDefaultSnippet(snippets, { ...compose, defaultSignature: '   ' }, profile);
    expect(out).toBe('Thanks, Alex');
  });

  it('renders tokens inside the snippet body', () => {
    const out = renderDefaultSnippet(
      { ...snippets, includeSignature: false, defaultSnippet: 'Hi from {first_name}' },
      compose,
      profile,
    );
    expect(out).toBe('Hi from Alex');
  });

  it('trims surrounding whitespace from the rendered body', () => {
    const out = renderDefaultSnippet(
      { ...snippets, includeSignature: false, defaultSnippet: '  Thanks  ' },
      compose,
      profile,
    );
    expect(out).toBe('Thanks');
  });

  it('returns null when snippets are disabled', () => {
    expect(renderDefaultSnippet({ ...snippets, enabled: false }, compose, profile)).toBeNull();
  });

  it('returns null when the rendered body is empty', () => {
    expect(
      renderDefaultSnippet({ ...snippets, defaultSnippet: '   ' }, compose, profile),
    ).toBeNull();
  });

  it('renders rich snippets with the selected account HTML signature', () => {
    const out = renderDefaultSnippetHtml(
      snippets,
      {
        ...compose,
        signaturesByAccount: {
          'work@example.com': {
            signaturePlain: 'Alex @ Work',
            signatureHtml: '<div style="color:#444"><b>Alex</b><br><img src="https://assets.example.com/logo.png" alt="Example Co"></div>',
            signatureFormat: 'html',
          },
        },
      },
      profile,
      'work@example.com',
    );

    expect(out).toContain('<p>Thanks, Alex</p>');
    expect(out).toContain('<b>Alex</b>');
    expect(out).toContain('src="https://assets.example.com/logo.png"');
    expect(out).toContain('alt="Example Co"');
  });
});

describe('snippet template library', () => {
  it('normalizes saved snippet templates', () => {
    expect(normalizeSnippetTemplates([
      { id: 'Follow Up!', title: 'Follow Up', trigger: ';follow', body: 'Hi' },
      { title: '', trigger: ';empty', body: '   ' },
      null,
    ])).toEqual([
      {
        id: 'follow-up',
        title: 'Follow Up',
        trigger: ';follow',
        body: 'Hi',
        includeSignature: true,
      },
    ]);
  });

  it('creates unique template ids from titles', () => {
    expect(createSnippetTemplateId('Follow Up', [{ id: 'follow-up' }, { id: 'follow-up-2' }])).toBe('follow-up-3');
  });

  it('renders a named snippet template with tokens and signature', () => {
    const out = renderSnippetTemplate(
      {
        id: 'follow-up',
        title: 'Follow up',
        trigger: ';follow',
        body: 'Hi {first_name}',
        includeSignature: true,
      },
      snippets,
      { ...compose, defaultSignature: '{first_name} @ {company}' },
      profile,
    );

    expect(out).toBe('Hi Alex\n\nAlex @ Example Co');
  });

  it('renders a named HTML snippet template', () => {
    const out = renderSnippetTemplateHtml(
      {
        id: 'rich',
        title: 'Rich',
        trigger: ';rich',
        body: '<p>Hello <strong>{first_name}</strong></p>',
        includeSignature: false,
      },
      snippets,
      compose,
      profile,
    );

    expect(out).toBe('<p>Hello <strong>Alex</strong></p>');
  });
});

describe('expandSnippetAtCursor', () => {
  it('expands when the line is exactly the trigger (Rule 1)', () => {
    const body = ';thanks';
    const edit = expandSnippetAtCursor(body, body.length, snippets, compose, profile);
    expect(edit).not.toBeNull();
    expect(edit!.text).toBe('Thanks, Alex');
    expect(edit!.selection).toBe('Thanks, Alex'.length);
  });

  it('expands a trigger on its own line within a larger body, keeping other lines', () => {
    const body = 'Hello\n;thanks';
    const cursor = body.length;
    const edit = expandSnippetAtCursor(body, cursor, snippets, compose, profile);
    expect(edit).not.toBeNull();
    expect(edit!.text).toBe('Hello\nThanks, Alex');
    expect(edit!.selection).toBe('Hello\n'.length + 'Thanks, Alex'.length);
  });

  it('expands a named template trigger', () => {
    const body = ';follow';
    const edit = expandSnippetAtCursor(
      body,
      body.length,
      {
        ...snippets,
        templates: [
          {
            id: 'follow-up',
            title: 'Follow up',
            trigger: ';follow',
            body: 'Hi {first_name}',
            includeSignature: false,
          },
        ],
      },
      compose,
      profile,
    );

    expect(edit).not.toBeNull();
    expect(edit!.text).toBe('Hi Alex');
  });

  it('keeps the default trigger ahead of duplicate template triggers', () => {
    const body = ';thanks';
    const edit = expandSnippetAtCursor(
      body,
      body.length,
      {
        ...snippets,
        templates: [
          {
            id: 'custom-thanks',
            title: 'Custom thanks',
            trigger: ';thanks',
            body: 'Custom',
            includeSignature: false,
          },
        ],
      },
      compose,
      profile,
    );

    expect(edit).not.toBeNull();
    expect(edit!.text).toBe('Thanks, Alex');
  });

  it('does not expand a trigger when the line suffix is non-blank', () => {
    // cursor sits right after ";thanks" but the line continues with " now".
    const body = ';thanks now';
    const cursor = ';thanks'.length;
    expect(expandSnippetAtCursor(body, cursor, snippets, compose, profile)).toBeNull();
  });

  it('does not expand when the prefix only contains the trigger as a substring', () => {
    const body = 'say ;thanks';
    const edit = expandSnippetAtCursor(body, body.length, snippets, compose, profile);
    expect(edit).toBeNull();
  });

  it('replaces the whole body on a blank empty body (Rule 2, empty)', () => {
    const edit = expandSnippetAtCursor('', 0, snippets, compose, profile);
    expect(edit).not.toBeNull();
    expect(edit!.text).toBe('Thanks, Alex');
    expect(edit!.selection).toBe('Thanks, Alex'.length);
  });

  it('replaces the whole body when it is only whitespace', () => {
    const body = '   ';
    const edit = expandSnippetAtCursor(body, body.length, snippets, compose, profile);
    expect(edit).not.toBeNull();
    expect(edit!.text).toBe('Thanks, Alex');
    expect(edit!.selection).toBe('Thanks, Alex'.length);
  });

  it('replaces only the blank current line mid-body (Rule 2, non-empty body)', () => {
    const body = 'First line\n\nSecond line';
    const cursor = 'First line\n'.length; // start of the blank middle line
    const edit = expandSnippetAtCursor(body, cursor, snippets, compose, profile);
    expect(edit).not.toBeNull();
    expect(edit!.text).toBe('First line\nThanks, Alex\nSecond line');
    expect(edit!.selection).toBe('First line\n'.length + 'Thanks, Alex'.length);
  });

  it('returns null when the current line has non-blank text and is not the trigger', () => {
    const body = 'Some real content';
    expect(expandSnippetAtCursor(body, body.length, snippets, compose, profile)).toBeNull();
  });

  it('includes the signature in the expansion when configured', () => {
    const edit = expandSnippetAtCursor(
      ';thanks',
      ';thanks'.length,
      snippets,
      { ...compose, defaultSignature: 'Sent from Dumka' },
      profile,
    );
    expect(edit).not.toBeNull();
    expect(edit!.text).toBe('Thanks, Alex\n\nSent from Dumka');
    expect(edit!.selection).toBe('Thanks, Alex\n\nSent from Dumka'.length);
  });

  it('returns null when snippets are disabled', () => {
    expect(
      expandSnippetAtCursor(';thanks', 7, { ...snippets, enabled: false }, compose, profile),
    ).toBeNull();
  });

  it('returns null when expandWithTab is off', () => {
    expect(
      expandSnippetAtCursor(';thanks', 7, { ...snippets, expandWithTab: false }, compose, profile),
    ).toBeNull();
  });

  it('returns null when the cursor is out of range', () => {
    expect(expandSnippetAtCursor(';thanks', 999, snippets, compose, profile)).toBeNull();
    expect(expandSnippetAtCursor(';thanks', -1, snippets, compose, profile)).toBeNull();
  });

  it('returns null when the rendered snippet is empty (nothing to insert)', () => {
    const edit = expandSnippetAtCursor(
      '',
      0,
      { ...snippets, defaultSnippet: '   ' },
      compose,
      profile,
    );
    expect(edit).toBeNull();
  });

  it('falls back to blank-line rule when the trigger is empty', () => {
    // Empty trigger disables Rule 1; a blank line still expands via Rule 2.
    const edit = expandSnippetAtCursor(
      '',
      0,
      { ...snippets, defaultSnippetTrigger: '   ' },
      compose,
      profile,
    );
    expect(edit).not.toBeNull();
    expect(edit!.text).toBe('Thanks, Alex');
  });
});
