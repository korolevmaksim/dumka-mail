import { AIChatMessage, AIProviderPreference } from '../shared/types';
import { getAIProviderConfig } from '../shared/aiProviders';
import { MCPManager } from './mcpManager';
import { loadAIConfig, saveAIConfig, getAIProviderDescriptor, listProviderModels, loadAIConfigAsync, saveAIConfigAsync, loadAIConfigForRenderer } from './aiConfig';

export { loadAIConfig, saveAIConfig, getAIProviderDescriptor, listProviderModels, loadAIConfigAsync, saveAIConfigAsync, loadAIConfigForRenderer };

export interface AIRequest {
  action: string;
  context: string;
  conversationHistory: AIChatMessage[];
  userInstruction: string;
}

export interface AIResponse {
  text: string;
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

function resolveRealModel(model: string): string {
  return model;
}

function buildChatCompletionsUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions') || trimmed.endsWith('/completions')) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

function addOpenRouterHeaders(headers: Record<string, string>, env: Record<string, string>): void {
  if (env['OPENROUTER_REFERER']) {
    headers['HTTP-Referer'] = env['OPENROUTER_REFERER'];
  }
  headers['X-OpenRouter-Title'] = env['OPENROUTER_APP_TITLE'] || 'Dumka Mail';
}

function supportsGeminiThinkingLevel(model: string): boolean {
  const normalized = model.replace(/^models\//, '');
  return /^gemini-3(?:[.-]|$)/.test(normalized);
}

export async function completeAI(request: AIRequest, preference: AIProviderPreference, overrideModel?: string): Promise<AIResponse> {
  const descriptor = await getAIProviderDescriptor(preference, overrideModel);
  if (descriptor.preference === 'disabled') {
    throw new Error('AI operations are disabled.');
  }

  const env = await loadAIConfigAsync();
  const promptText = buildPrompt(request);
  const sysInstruction = 'You are an email operating assistant. Return only user-visible useful output.';
  const activeTools = MCPManager.getActiveTools();
  const resolvedModel = resolveRealModel(descriptor.model);

  switch (descriptor.preference) {
    case 'openAI': {
      const apiKey = env['OPENAI_API_KEY'];
      if (!apiKey) throw new Error('OpenAI API key missing.');

      const customResponsesUrl = env['OPENAI_RESPONSES_URL'];
      const endpoint = customResponsesUrl || env['OPENAI_BASE_URL'] || 'https://api.openai.com/v1/chat/completions';
      const isResponsesApi = endpoint.includes('/responses');

      if (isResponsesApi) {
        // Responses API doesn't support tools in the same way, fallback to simple completion
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ model: resolvedModel, input: promptText })
        });
        if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`);
        const data = await res.json() as any;
        let text = '';
        if (data.output_text) {
          text = data.output_text;
        } else if (data.output) {
          text = data.output.flatMap((o: any) => o.content || []).map((c: any) => c.text || '').join('\n');
        }
        if (!text) throw new Error('Empty response from OpenAI API.');
        return { text };
      }

      // Standard Chat Completions with Tool Calling Loop
      const openAITools = activeTools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema
        }
      }));

      const messages: any[] = [
        { role: 'system', content: sysInstruction },
        { role: 'user', content: promptText }
      ];

      let loop = true;
      let iterations = 0;
      let finalResponseText = '';

      while (loop && iterations < 5) {
        iterations++;
        const body: any = {
          model: resolvedModel,
          messages,
          stream: false
        };
        if (openAITools.length > 0) {
          body.tools = openAITools;
        }

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
        const message = data.choices?.[0]?.message;
        if (!message) throw new Error('Empty response from OpenAI.');

        if (message.tool_calls && message.tool_calls.length > 0) {
          messages.push(message);
          for (const tc of message.tool_calls) {
            const name = tc.function.name;
            const args = JSON.parse(tc.function.arguments || '{}');
            console.log(`[AI] OpenAI requested tool "${name}" with args:`, args);
            let result;
            try {
              result = await MCPManager.executeTool(name, args);
            } catch (err: any) {
              console.error(`[AI] Tool execution failed:`, err);
              result = { error: err.message || String(err) };
            }
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name,
              content: typeof result === 'string' ? result : JSON.stringify(result)
            });
          }
        } else {
          finalResponseText = message.content || '';
          loop = false;
        }
      }

      if (!finalResponseText) throw new Error('Empty response from OpenAI.');
      return { text: finalResponseText };
    }

    case 'anthropic': {
      const apiKey = env['ANTHROPIC_API_KEY'];
      if (!apiKey) throw new Error('Anthropic API key missing.');
      const endpoint = env['ANTHROPIC_BASE_URL'] || 'https://api.anthropic.com/v1/messages';
      const version = env['ANTHROPIC_VERSION'] || '2023-06-01';
      const maxTokens = parseInt(env['ANTHROPIC_MAX_TOKENS'] || '4096', 10);

      const anthropicTools = activeTools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema
      }));

      const messages: any[] = [
        { role: 'user', content: promptText }
      ];

      let loop = true;
      let iterations = 0;
      let finalResponseText = '';

      while (loop && iterations < 5) {
        iterations++;
        const body: any = {
          model: resolvedModel,
          max_tokens: maxTokens,
          system: sysInstruction,
          messages
        };
        if (anthropicTools.length > 0) {
          body.tools = anthropicTools;
        }

        const anthropicThinkingEffort = env['ANTHROPIC_THINKING_EFFORT'];
        if (anthropicThinkingEffort && anthropicThinkingEffort !== 'disabled') {
          body.thinking = {
            type: 'adaptive'
          };
          body.output_config = {
            effort: anthropicThinkingEffort === 'max' ? 'xhigh' : anthropicThinkingEffort
          };
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': version,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        if (!res.ok) {
          throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
        }

        const data = await res.json() as any;
        if (data.stop_reason === 'tool_use') {
          messages.push({ role: 'assistant', content: data.content });

          const toolResults = [];
          for (const block of data.content) {
            if (block.type === 'tool_use') {
              const name = block.name;
              const input = block.input;
              console.log(`[AI] Anthropic requested tool "${name}" with args:`, input);
              let result;
              try {
                result = await MCPManager.executeTool(name, input);
              } catch (err: any) {
                console.error(`[AI] Tool execution failed:`, err);
                result = { error: err.message || String(err) };
              }
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: typeof result === 'string' ? result : JSON.stringify(result)
              });
            }
          }
          messages.push({ role: 'user', content: toolResults });
        } else {
          finalResponseText = (data.content || []).map((c: any) => c.type === 'text' ? c.text : '').join('\n');
          loop = false;
        }
      }

      if (!finalResponseText) throw new Error('Empty response from Anthropic.');
      return { text: finalResponseText };
    }

    case 'gemini': {
      const apiKey = env['GEMINI_API_KEY'];
      if (!apiKey) throw new Error('Gemini API key missing.');
      const baseURL = env['GEMINI_BASE_URL'] || 'https://generativelanguage.googleapis.com/v1beta';
      
      const modelName = resolvedModel.startsWith('models/') ? resolvedModel.substring(7) : resolvedModel;
      const endpoint = `${baseURL}/models/${modelName}:generateContent?key=${apiKey}`;

      const geminiTools = activeTools.length > 0 ? [{
        functionDeclarations: activeTools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.inputSchema
        }))
      }] : undefined;

      const contents: any[] = [
        { role: 'user', parts: [{ text: promptText }] }
      ];

      let loop = true;
      let iterations = 0;
      let finalResponseText = '';

      while (loop && iterations < 5) {
        iterations++;
        const body: any = {
          system_instruction: { parts: [{ text: sysInstruction }] },
          contents
        };
        if (geminiTools) {
          body.tools = geminiTools;
        }

        const geminiThinkingLevel = env['GEMINI_THINKING_LEVEL'];
        if (geminiThinkingLevel && geminiThinkingLevel !== 'disabled' && supportsGeminiThinkingLevel(resolvedModel)) {
          body.generationConfig = {
            thinkingConfig: {
              thinkingLevel: geminiThinkingLevel
            }
          };
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (!res.ok) {
          throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
        }

        const data = await res.json() as any;
        const candidate = data.candidates?.[0];
        if (!candidate) throw new Error('Empty response from Gemini.');

        const parts = candidate.content?.parts || [];
        const functionCalls = parts.filter((p: any) => p.functionCall);

        if (functionCalls.length > 0) {
          contents.push(candidate.content);

          const responseParts = [];
          for (const p of parts) {
            if (p.functionCall) {
              const name = p.functionCall.name;
              const args = p.functionCall.args || {};
              console.log(`[AI] Gemini requested tool "${name}" with args:`, args);
              let result;
              try {
                result = await MCPManager.executeTool(name, args);
              } catch (err: any) {
                console.error(`[AI] Tool execution failed:`, err);
                result = { error: err.message || String(err) };
              }
              responseParts.push({
                functionResponse: {
                  name,
                  response: { result }
                }
              });
            }
          }
          contents.push({ role: 'function', parts: responseParts });
        } else {
          finalResponseText = parts.map((p: any) => p.text || '').join('\n');
          loop = false;
        }
      }

      if (!finalResponseText) throw new Error('Empty response from Gemini.');
      return { text: finalResponseText };
    }

    case 'openRouter':
    case 'deepSeek':
    case 'openAICompatible': {
      const isDeepSeek = descriptor.preference === 'deepSeek';
      const isOpenRouter = descriptor.preference === 'openRouter';
      const config = getAIProviderConfig(descriptor.preference);
      const apiKey = isDeepSeek
        ? env['DEEPSEEK_API_KEY']
        : isOpenRouter
          ? env['OPENROUTER_API_KEY']
          : env['OPENAI_COMPATIBLE_API_KEY'];
      const defaultEndpoint = isDeepSeek
        ? 'https://api.deepseek.com/chat/completions'
        : isOpenRouter
          ? `${getAIProviderConfig('openRouter').defaultBaseUrl}/chat/completions`
          : '';
      const endpoint = env[config.baseUrlEnv] || defaultEndpoint;

      if (!apiKey) throw new Error(`${config.displayName} API key missing.`);
      if (!endpoint) throw new Error(`${config.displayName} endpoint URL missing.`);

      const url = buildChatCompletionsUrl(endpoint);

      const openAITools = activeTools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema
        }
      }));

      const messages: any[] = [
        { role: 'system', content: sysInstruction },
        { role: 'user', content: promptText }
      ];

      let loop = true;
      let iterations = 0;
      let finalResponseText = '';

      while (loop && iterations < 5) {
        iterations++;
        const body: any = {
          model: resolvedModel,
          messages,
          stream: false
        };
        if (openAITools.length > 0) {
          body.tools = openAITools;
        }

        if (isDeepSeek) {
          const thinking = env['DEEPSEEK_THINKING'] || 'disabled';
          if (thinking !== 'disabled') {
            body.thinking = { type: thinking };
            if (env['DEEPSEEK_REASONING_EFFORT']) {
              body.reasoning_effort = env['DEEPSEEK_REASONING_EFFORT'];
            }
          }
        } else if (isOpenRouter) {
          const openRouterReasoningEffort = env['OPENROUTER_REASONING_EFFORT'];
          if (openRouterReasoningEffort && openRouterReasoningEffort !== 'disabled') {
            body.reasoning = { effort: openRouterReasoningEffort };
          }
        } else if (preference === 'openAI') {
          const openAIReasoningEffort = env['OPENAI_REASONING_EFFORT'];
          if (openAIReasoningEffort && openAIReasoningEffort !== 'disabled') {
            body.reasoning_effort = openAIReasoningEffort;
          }
        }

        const headers: Record<string, string> = {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        };
        if (isOpenRouter) {
          addOpenRouterHeaders(headers, env);
        }

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body)
        });

        if (!res.ok) {
          throw new Error(`Chat Completions HTTP ${res.status}: ${await res.text()}`);
        }

        const data = await res.json() as any;
        const message = data.choices?.[0]?.message;
        if (!message) throw new Error('Empty response from Chat completions API.');

        if (message.tool_calls && message.tool_calls.length > 0) {
          messages.push(message);
          for (const tc of message.tool_calls) {
            const name = tc.function.name;
            const args = JSON.parse(tc.function.arguments || '{}');
            console.log(`[AI] Chat completions requested tool "${name}" with args:`, args);
            let result;
            try {
              result = await MCPManager.executeTool(name, args);
            } catch (err: any) {
              console.error(`[AI] Tool execution failed:`, err);
              result = { error: err.message || String(err) };
            }
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name,
              content: typeof result === 'string' ? result : JSON.stringify(result)
            });
          }
        } else {
          finalResponseText = message.content || '';
          loop = false;
        }
      }

      if (!finalResponseText) throw new Error('Empty response from Chat completions API.');
      return { text: finalResponseText };
    }

    default:
      throw new Error('Unsupported AI provider.');
  }
}
