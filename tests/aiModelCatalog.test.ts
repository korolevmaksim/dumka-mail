import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildModelChoices, compareModelIdsNewestFirst, isTextModelId } from '../shared/aiModelCatalog';

describe('isTextModelId', () => {
  it('drops models that cannot sort or write mail', () => {
    for (const id of ['acme-embedding-3-large', 'acme-audio', 'acme-realtime-2.1', 'acme-image-2', 'whisper-1', 'omni-moderation-latest', 'acme-6-transcribe']) {
      expect(isTextModelId(id), id).toBe(false);
    }
    for (const id of ['acme-6-small', 'vendor/acme-5.5-pro', 'local3.3:70b', 'chat-latest']) {
      expect(isTextModelId(id), id).toBe(true);
    }
    expect(isTextModelId('  ')).toBe(false);
  });
});

describe('compareModelIdsNewestFirst', () => {
  it('puts newer versions first and ignores snapshot dates', () => {
    const sorted = ['acme-5.6-pro', 'acme-4o-2024-08-06', 'acme-6.1-pro', 'acme-6-small', 'chat-latest', 'acme-5-mini'].sort(compareModelIdsNewestFirst);
    expect(sorted).toEqual(['acme-6.1-pro', 'acme-6-small', 'acme-5.6-pro', 'acme-5-mini', 'acme-4o-2024-08-06', 'chat-latest']);
  });

  it('does not rank a preview or a dated snapshot above the model itself', () => {
    expect(['acme-2.5-fast-preview-05-20', 'acme-2.5-fast'].sort(compareModelIdsNewestFirst))
      .toEqual(['acme-2.5-fast', 'acme-2.5-fast-preview-05-20']);
    expect(['acme-5-2025-08-07', 'acme-5.6-pro'].sort(compareModelIdsNewestFirst)).toEqual(['acme-5.6-pro', 'acme-5-2025-08-07']);
  });
});

describe('buildModelChoices', () => {
  const catalog = ['acme-4.1', 'acme-6-small', 'acme-6.1-pro', 'acme-6-max', 'acme-audio', 'acme-embedding-3-small', 'acme-6-small'];

  it('lists the provider’s text models newest first, without duplicates or suggestions', () => {
    const choices = buildModelChoices(catalog, 'acme-6-small');
    expect(choices.models).toEqual(['acme-6.1-pro', 'acme-6-max', 'acme-6-small', 'acme-4.1']);
    expect(choices.currentMissing).toBe(false);
  });

  it('flags a saved model the provider no longer lists', () => {
    expect(buildModelChoices(catalog, 'acme-3-retired').currentMissing).toBe(true);
    // Nothing loaded: nothing can be said about the saved model.
    expect(buildModelChoices([], 'acme-3-retired').currentMissing).toBe(false);
    expect(buildModelChoices(catalog, '').currentMissing).toBe(false);
  });

  it('does not flag an alias whose dated snapshot is listed', () => {
    expect(buildModelChoices(['acme-pro-5-5-20260915'], 'acme-pro-5-5').currentMissing).toBe(false);
    expect(buildModelChoices(['acme-6-small-2026-09-22'], 'acme-6-small').currentMissing).toBe(false);
    expect(buildModelChoices(['acme-pro-5-5-preview'], 'acme-pro-5-5').currentMissing).toBe(true);
  });
});

// The owner's rule: no model id is built into the app; the model always comes
// from settings. This guards against one creeping back in as a default.
describe('no built-in model ids', () => {
  const ROOTS = ['main', 'shared', 'renderer/src'];
  const MODEL_ID = /['"`](?:~?[a-z]+\/)?(?:gpt|chatgpt|o[1-9]|claude|gemini|gemma|deepseek|grok|llama|mistral|qwen|text-embedding|voyage|embed-v|nomic)[-.:][a-z0-9][a-z0-9.:\-]*['"`]/gi;

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }

  it('has none in the main process, shared logic or the interface', () => {
    const found: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(join(__dirname, '..', root))) {
        for (const match of readFileSync(file, 'utf8').match(MODEL_ID) || []) found.push(`${file}: ${match}`);
      }
    }
    expect(found).toEqual([]);
  });
});
