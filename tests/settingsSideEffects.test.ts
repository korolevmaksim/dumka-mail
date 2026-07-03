import { describe, expect, it } from 'vitest';
import {
  settingsAffectMCPRuntime,
  settingsAffectSearchBodyIndexing,
} from '../main/settingsSideEffects';
import type { AppSettings } from '../shared/types';

function baseSettings(): Partial<AppSettings> {
  return {
    ai: {
      externalToolsEnabled: false,
    } as AppSettings['ai'],
    mcpServers: [
      {
        id: 'filesystem',
        name: 'Filesystem',
        type: 'stdio',
        enabled: true,
        command: 'node',
        args: ['server.js'],
        env: {
          TOKEN: '__DUMKA_SECRET_STORED__',
        },
      },
    ],
    searchProviders: {
      tavily: { enabled: true, apiKey: '__DUMKA_SECRET_STORED__' },
      brave: { enabled: false, apiKey: '' },
      perplexity: { enabled: false, apiKey: '' },
    },
    privacy: {
      includeBodiesInSearchIndex: true,
    } as AppSettings['privacy'],
  };
}

describe('app settings side effects', () => {
  it('does not reinitialize MCP when only AI tool-use policy changes', () => {
    const previous = baseSettings();
    const next = {
      ...previous,
      ai: {
        ...previous.ai,
        externalToolsEnabled: true,
      } as AppSettings['ai'],
    };

    expect(settingsAffectMCPRuntime(previous, next)).toBe(false);
  });

  it('reinitializes MCP when server configuration changes', () => {
    const previous = baseSettings();
    const next = {
      ...previous,
      mcpServers: [
        {
          ...previous.mcpServers![0],
          enabled: false,
        },
      ],
    };

    expect(settingsAffectMCPRuntime(previous, next)).toBe(true);
  });

  it('reinitializes MCP when search provider configuration changes', () => {
    const previous = baseSettings();
    const next = {
      ...previous,
      searchProviders: {
        ...previous.searchProviders!,
        brave: { enabled: true, apiKey: '__DUMKA_SECRET_STORED__' },
      },
    };

    expect(settingsAffectMCPRuntime(previous, next)).toBe(true);
  });

  it('does not rebuild the search body index when only AI tool-use policy changes', () => {
    const previous = baseSettings();
    const next = {
      ...previous,
      ai: {
        ...previous.ai,
        externalToolsEnabled: true,
      } as AppSettings['ai'],
    };

    expect(settingsAffectSearchBodyIndexing(previous, next)).toBe(false);
  });

  it('rebuilds the search body index when the privacy setting changes', () => {
    const previous = baseSettings();
    const next = {
      ...previous,
      privacy: {
        ...previous.privacy,
        includeBodiesInSearchIndex: false,
      } as AppSettings['privacy'],
    };

    expect(settingsAffectSearchBodyIndexing(previous, next)).toBe(true);
  });
});
