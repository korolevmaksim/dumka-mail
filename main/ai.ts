import fs from 'fs';
import path from 'path';
import { AIChatMessage, AIProviderDescriptor, AIProviderPreference } from '../shared/types';

export interface AIRequest {
  action: string;
  context: string;
  conversationHistory: AIChatMessage[];
  userInstruction: string;
}

export interface AIResponse {
  text: string;
}

// Loads env vars from dotenv file
function parseEnvFile(filePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return env;

  try {
    const text = fs.readFileSync(filePath, 'utf-8');
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const equalIdx = trimmed.indexOf('=');
      if (equalIdx > 0) {
        const key = trimmed.substring(0, equalIdx).trim();
        let value = trimmed.substring(equalIdx + 1).trim();
        
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.substring(1, value.length - 1);
        }
        env[key] = value;
      }
    }
  } catch (e) {
    console.error('Error parsing env file:', e);
  }
  return env;
}

export function loadAIConfig(): Record<string, string> {
  const primaryPath = path.join(process.env.HOME || '', '.config', 'dumka-mail-agy', 'openai.env');
  const fallbackPath = path.join(process.env.HOME || '', '.config', 'personal-mail-client', 'openai.env');

  let env = parseEnvFile(primaryPath);
  if (Object.keys(env).length === 0) {
    env = parseEnvFile(fallbackPath);
  }

  // Allow system process environment overrides
  return { ...env, ...process.env } as Record<string, string>;
}

export function saveAIConfig(config: Record<string, string>): void {
  const dir = path.join(process.env.HOME || '', '.config', 'dumka-mail-agy');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, 'openai.env');
  
  let content = '# Dumka Mail AI Configuration\n';
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined && value !== null) {
      content += `${key}=${value}\n`;
    }
  }
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function getAIProviderDescriptor(preference: AIProviderPreference, overrideModel?: string): AIProviderDescriptor {
  const env = loadAIConfig();
  const activePref = preference === 'automatic'
    ? (env['PMC_AI_PROVIDER'] as AIProviderPreference || 'automatic')
    : preference;

  if (activePref === 'disabled') {
    return {
      preference: 'disabled',
      displayName: 'Disabled',
      model: 'None',
      transport: 'None',
      status: 'AI disabled in settings',
      capabilities: { canTriage: false, canSummarize: false, canDraft: false }
    };
  }

  const selectDesc = (pref: AIProviderPreference): AIProviderDescriptor => {
    switch (pref) {
      case 'openAI':
        return {
          preference: 'openAI',
          displayName: 'OpenAI',
          model: overrideModel || env['OPENAI_MODEL'] || 'gpt-4o-mini',
          transport: 'responses',
          status: env['OPENAI_API_KEY'] ? 'Configured' : 'Missing API Key',
          capabilities: { canTriage: true, canSummarize: true, canDraft: true }
        };
      case 'anthropic':
        return {
          preference: 'anthropic',
          displayName: 'Anthropic',
          model: overrideModel || env['ANTHROPIC_MODEL'] || 'claude-3-5-sonnet-latest',
          transport: 'messages',
          status: env['ANTHROPIC_API_KEY'] ? 'Configured' : 'Missing API Key',
          capabilities: { canTriage: true, canSummarize: true, canDraft: true }
        };
      case 'gemini':
        return {
          preference: 'gemini',
          displayName: 'Gemini',
          model: overrideModel || env['GEMINI_MODEL'] || 'gemini-3.5-flash',
          transport: 'generateContent',
          status: env['GEMINI_API_KEY'] ? 'Configured' : 'Missing API Key',
          capabilities: { canTriage: true, canSummarize: true, canDraft: true }
        };
      case 'deepSeek':
        return {
          preference: 'deepSeek',
          displayName: 'DeepSeek',
          model: overrideModel || env['DEEPSEEK_MODEL'] || 'deepseek-chat',
          transport: 'chat.completions',
          status: env['DEEPSEEK_API_KEY'] ? 'Configured' : 'Missing API Key',
          capabilities: { canTriage: true, canSummarize: true, canDraft: true }
        };
      case 'openAICompatible':
        return {
          preference: 'openAICompatible',
          displayName: env['OPENAI_COMPATIBLE_NAME'] || 'Local Model',
          model: overrideModel || env['OPENAI_COMPATIBLE_MODEL'] || 'local-mail-model',
          transport: 'chat.completions',
          status: env['OPENAI_COMPATIBLE_API_KEY'] ? 'Configured' : 'Missing API Key/Base URL',
          capabilities: { canTriage: true, canSummarize: true, canDraft: true }
        };
      default:
        // Try automatic fallback chain
        if (env['OPENAI_API_KEY']) return selectDesc('openAI');
        if (env['ANTHROPIC_API_KEY']) return selectDesc('anthropic');
        if (env['GEMINI_API_KEY']) return selectDesc('gemini');
        if (env['DEEPSEEK_API_KEY']) return selectDesc('deepSeek');
        if (env['OPENAI_COMPATIBLE_API_KEY']) return selectDesc('openAICompatible');
        return {
          preference: 'disabled',
          displayName: 'None',
          model: 'None',
          transport: 'None',
          status: 'No AI keys found',
          capabilities: { canTriage: false, canSummarize: false, canDraft: false }
        };
    }
  };

  return selectDesc(activePref);
}

export async function listProviderModels(provider: string, apiKey: string, baseUrl?: string): Promise<string[]> {
  if (provider !== 'openAICompatible' && !apiKey) {
    throw new Error(`API Key is required to list models for ${provider}`);
  }

  try {
    switch (provider) {
      case 'openAI': {
        const url = baseUrl || 'https://api.openai.com/v1/models';
        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        if (!res.ok) {
          let errText = '';
          try { errText = await res.text(); } catch {}
          throw new Error(`HTTP ${res.status}${errText ? ': ' + errText : ''}`);
        }
        const data = await res.json() as any;
        return (data.data || [])
          .map((m: any) => m.id)
          .filter((id: string) => id.startsWith('gpt') || id.startsWith('o1') || id.startsWith('o3'))
          .sort();
      }
      case 'gemini': {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const res = await fetch(url);
        if (!res.ok) {
          let errText = '';
          try { errText = await res.text(); } catch {}
          throw new Error(`HTTP ${res.status}${errText ? ': ' + errText : ''}`);
        }
        const data = await res.json() as any;
        return (data.models || [])
          .map((m: any) => m.name.replace('models/', ''))
          .filter((name: string) => name.includes('gemini'))
          .sort();
      }
      case 'deepSeek': {
        const url = baseUrl || 'https://api.deepseek.com/models';
        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        if (!res.ok) {
          let errText = '';
          try { errText = await res.text(); } catch {}
          throw new Error(`HTTP ${res.status}${errText ? ': ' + errText : ''}`);
        }
        const data = await res.json() as any;
        return (data.data || []).map((m: any) => m.id).sort();
      }
      case 'anthropic': {
        const url = 'https://api.anthropic.com/v1/models';
        const res = await fetch(url, {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          }
        });
        if (!res.ok) {
          let errText = '';
          try { errText = await res.text(); } catch {}
          throw new Error(`HTTP ${res.status}${errText ? ': ' + errText : ''}`);
        }
        const data = await res.json() as any;
        return (data.data || []).map((m: any) => m.id).sort();
      }
      case 'openAICompatible': {
        const url = baseUrl ? (baseUrl.endsWith('/models') ? baseUrl : `${baseUrl}/models`) : '';
        if (!url) {
          throw new Error('Base URL is required for OpenAI-Compatible provider');
        }
        const headers: any = {};
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        const res = await fetch(url, { headers });
        if (!res.ok) {
          let errText = '';
          try { errText = await res.text(); } catch {}
          throw new Error(`HTTP ${res.status}${errText ? ': ' + errText : ''}`);
        }
        const data = await res.json() as any;
        return (data.data || []).map((m: any) => m.id).sort();
      }
      default:
        return [];
    }
  } catch (e) {
    console.error(`Failed to fetch models for ${provider}:`, e);
    throw e;
  }
}

function buildPrompt(request: AIRequest): string {
  const historyStr = request.conversationHistory.length > 0
    ? request.conversationHistory.map(m => `${m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System'}: ${m.text}`).join('\n')
    : 'No previous AI chat turns.';

  return `You are helping Max handle email inside a macOS mail client.
Use the selected mail or draft context together with the conversation history to answer follow-up questions.
Action: ${request.action}

Selected mail or draft context:
${request.context}

Conversation history:
${historyStr}

Current user instruction:
${request.userInstruction}

Return the complete useful email text or answer for the current request.
Do not truncate the answer, omit the ending, or finish with an ellipsis because of length.
For translation requests, translate the available selected content fully instead of summarizing it.
Do not claim that you performed actions outside drafting text.`;
}

export async function completeAI(request: AIRequest, preference: AIProviderPreference, overrideModel?: string): Promise<AIResponse> {
  const descriptor = getAIProviderDescriptor(preference, overrideModel);
  if (descriptor.preference === 'disabled') {
    throw new Error('AI operations are disabled.');
  }

  const env = loadAIConfig();
  const promptText = buildPrompt(request);
  const sysInstruction = 'You are an email operating assistant. Return only user-visible useful output.';

  switch (descriptor.preference) {
    case 'openAI': {
      const apiKey = env['OPENAI_API_KEY'];
      if (!apiKey) throw new Error('OpenAI API key missing.');

      const customResponsesUrl = env['OPENAI_RESPONSES_URL'];
      const endpoint = customResponsesUrl || env['OPENAI_BASE_URL'] || 'https://api.openai.com/v1/chat/completions';
      const isResponsesApi = endpoint.includes('/responses');

      const body = isResponsesApi
        ? { model: descriptor.model, input: promptText }
        : {
            model: descriptor.model,
            messages: [
              { role: 'system', content: sysInstruction },
              { role: 'user', content: promptText }
            ]
          };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`);
      }

      const data = await res.json() as any;
      let text = '';
      if (isResponsesApi) {
        if (data.output_text) {
          text = data.output_text;
        } else if (data.output) {
          text = data.output.flatMap((o: any) => o.content || []).map((c: any) => c.text || '').join('\n');
        }
      } else {
        text = data.choices?.[0]?.message?.content || '';
      }

      if (!text) throw new Error('Empty response from OpenAI API.');
      return { text };
    }

    case 'anthropic': {
      const apiKey = env['ANTHROPIC_API_KEY'];
      if (!apiKey) throw new Error('Anthropic API key missing.');
      const endpoint = env['ANTHROPIC_BASE_URL'] || 'https://api.anthropic.com/v1/messages';
      const version = env['ANTHROPIC_VERSION'] || '2023-06-01';
      const maxTokens = parseInt(env['ANTHROPIC_MAX_TOKENS'] || '4096', 10);

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': version,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: descriptor.model,
          max_tokens: maxTokens,
          system: sysInstruction,
          messages: [{ role: 'user', content: promptText }]
        })
      });

      if (!res.ok) {
        throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
      }

      const data = await res.json() as any;
      const text = (data.content || []).map((c: any) => c.type === 'text' ? c.text : '').join('\n');
      if (!text) throw new Error('Empty response from Anthropic.');
      return { text };
    }

    case 'gemini': {
      const apiKey = env['GEMINI_API_KEY'];
      if (!apiKey) throw new Error('Gemini API key missing.');
      const baseURL = env['GEMINI_BASE_URL'] || 'https://generativelanguage.googleapis.com/v1beta';
      
      const modelName = descriptor.model.startsWith('models/') ? descriptor.model.substring(7) : descriptor.model;
      const endpoint = `${baseURL}/models/${modelName}:generateContent?key=${apiKey}`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: sysInstruction }] },
          contents: [{ role: 'user', parts: [{ text: promptText }] }]
        })
      });

      if (!res.ok) {
        throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
      }

      const data = await res.json() as any;
      const text = (data.candidates || [])
        .flatMap((cand: any) => cand.content?.parts || [])
        .map((p: any) => p.text || '')
        .join('\n');

      if (!text) throw new Error('Empty response from Gemini.');
      return { text };
    }

    case 'deepSeek':
    case 'openAICompatible': {
      const isDeepSeek = descriptor.preference === 'deepSeek';
      const apiKey = isDeepSeek ? env['DEEPSEEK_API_KEY'] : env['OPENAI_COMPATIBLE_API_KEY'];
      const defaultEndpoint = isDeepSeek ? 'https://api.deepseek.com/chat/completions' : '';
      const endpoint = isDeepSeek
        ? (env['DEEPSEEK_BASE_URL'] || defaultEndpoint)
        : (env['OPENAI_COMPATIBLE_BASE_URL'] || '');

      if (!apiKey) throw new Error(`${isDeepSeek ? 'DeepSeek' : 'OpenAI-compatible'} API key missing.`);
      if (!endpoint) throw new Error(`${isDeepSeek ? 'DeepSeek' : 'OpenAI-compatible'} endpoint URL missing.`);

      // Format endpoint to end with chat/completions if not done
      let url = endpoint;
      if (!url.endsWith('/chat/completions') && !url.endsWith('/completions')) {
        url = url.endsWith('/') ? `${url}chat/completions` : `${url}/chat/completions`;
      }

      const body: any = {
        model: descriptor.model,
        messages: [
          { role: 'system', content: sysInstruction },
          { role: 'user', content: promptText }
        ],
        stream: false
      };

      if (isDeepSeek) {
        const thinking = env['DEEPSEEK_THINKING'] || 'disabled';
        if (thinking !== 'disabled') {
          body.thinking = { type: thinking };
          if (env['DEEPSEEK_REASONING_EFFORT']) {
            body.reasoning_effort = env['DEEPSEEK_REASONING_EFFORT'];
          }
        }
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        throw new Error(`Chat Completions HTTP ${res.status}: ${await res.text()}`);
      }

      const data = await res.json() as any;
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error('Empty response from Chat completions API.');
      return { text };
    }

    default:
      throw new Error('Unsupported AI provider.');
  }
}
