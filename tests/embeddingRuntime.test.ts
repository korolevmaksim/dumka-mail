import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmbeddings } from '../main/ai';

vi.mock('../main/database', () => ({
  SettingsRepo: {
    get: vi.fn(() => JSON.stringify({ privacy: { useKeychainForSecrets: true } })),
  },
}));

vi.mock('../main/keychain', () => ({
  getRefreshToken: vi.fn(async (key: string) => key === 'ai-secret:GEMINI_API_KEY' ? 'fixture-gemini-key' : null),
  saveRefreshToken: vi.fn(),
  deleteRefreshToken: vi.fn(),
}));

vi.mock('../main/mcpManager', () => ({
  MCPManager: {
    getActiveTools: vi.fn(() => []),
    executeTool: vi.fn(),
  },
}));

describe('embedding runtime adapters', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      embeddings: [{ values: [0.1, 0.2, 0.3] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends Gemini dimensions through embedContentConfig', async () => {
    await createEmbeddings(['Find the design contractor agreement'], {
      purpose: 'query',
      settings: {
        provider: 'gemini',
        model: 'gemini-embedding-2',
        baseURL: 'https://generativelanguage.googleapis.com/v1beta',
        dimensions: 768,
      },
    });

    const fetchMock = vi.mocked(fetch);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const request = body.requests[0];

    expect(fetchMock.mock.calls[0]?.[0]).toContain('models/gemini-embedding-2:batchEmbedContents');
    expect(request.embedContentConfig.outputDimensionality).toBe(768);
    expect(request.outputDimensionality).toBe(768);
    expect(request.output_dimensionality).toBeUndefined();
    expect(request.taskType).toBeUndefined();
  });
});
