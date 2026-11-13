import { loadAIConfigAsync } from './aiConfig';
import { abortError, isAbortError, ModelRequestError } from './modelErrors';
import { buildOpenAIDecisionsRequest, parseOpenAIDecisionsResponse } from '../shared/openAIDecisions';
import type { DecisionPromptItem } from '../shared/agentPrompts';

export interface OpenAIDecisionsOptions {
  model: string;
  minConfidence: number;
  signal?: AbortSignal;
}

export function openAIDecisionsUrl(baseUrl: string | undefined): string {
  const url = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
    .replace(/\/(?:chat\/completions|responses|models|decisions)$/, '');
  return `${url}/decisions`;
}

export async function completeOpenAIDecisions(items: readonly DecisionPromptItem[], now: Date, options: OpenAIDecisionsOptions) {
  if (!options.model.trim()) throw new ModelRequestError('config', 'openAI', 'Choose a model for OpenAI Decisions in Settings → AI model.');
  if (options.signal?.aborted) throw abortError();
  const env = await loadAIConfigAsync();
  if (!env.OPENAI_API_KEY) throw new ModelRequestError('config', 'openAI', 'OpenAI API key missing.');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
  try {
    const response = await fetch(openAIDecisionsUrl(env.OPENAI_BASE_URL), {
      method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildOpenAIDecisionsRequest(items, options.model, now)), signal: controller.signal,
    });
    if (!response.ok) {
      // Do not echo provider bodies: they may contain mail or credential details.
      throw new ModelRequestError('http', 'openAI', `OpenAI Decisions returned HTTP ${response.status}. Check that the selected model supports Decisions and your key has access.`, response.status);
    }
    const data: unknown = await response.json();
    if (controller.signal.aborted) throw abortError();
    const result = parseOpenAIDecisionsResponse(data, items, options.minConfidence);
    if (!result.valid) throw new ModelRequestError('invalid', 'openAI', 'OpenAI Decisions returned an invalid classification response.');
    return { ...result, model: options.model };
  } catch (error) {
    if (options.signal?.aborted) throw abortError();
    if (timedOut) throw new ModelRequestError('timeout', 'openAI', 'OpenAI Decisions timed out.');
    if (error instanceof ModelRequestError || isAbortError(error)) throw error;
    if (error instanceof SyntaxError) throw new ModelRequestError('invalid', 'openAI', 'OpenAI Decisions did not return valid JSON.');
    throw new ModelRequestError('network', 'openAI', 'OpenAI Decisions request failed. Check your connection and endpoint.');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}
