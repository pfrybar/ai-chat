import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

import { createOpenAIClient } from './openai.js';

export type ChatRole = 'system' | 'user' | 'assistant';
export type ReasoningEffort =
  'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatResult {
  content: string;
  rawResponse?: unknown;
  reasoningSummary?: string;
}

export type ChatStreamChunk =
  | { type: 'delta'; content: string }
  | { type: 'reasoning_summary'; content: string };

export interface ChatStreamResult {
  getRawResponse?: () => unknown;
  stream: AsyncIterable<ChatStreamChunk>;
}

export function getChatModels() {
  const configuredModels = (process.env.OPENAI_MODELS ?? '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  return configuredModels.length > 0
    ? [...new Set(configuredModels)]
    : ['gpt-4o-mini'];
}

export async function completeChat(
  messages: ChatMessage[],
  model: string,
  reasoningEffort: ReasoningEffort | null,
): Promise<ChatResult> {
  const client = createOpenAIClient();
  const completion = await client.chat.completions.create({
    messages: messages as ChatCompletionMessageParam[],
    model,
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  });
  const content = completion.choices[0]?.message.content;

  if (!content) {
    throw new Error('The model returned an empty response.');
  }

  return { content, rawResponse: completion };
}

export async function streamChat(
  messages: ChatMessage[],
  model: string,
  reasoningEffort: ReasoningEffort | null,
  signal?: AbortSignal,
): Promise<ChatStreamResult> {
  const client = createOpenAIClient();
  const completionStream = await client.chat.completions.create(
    {
      messages: messages as ChatCompletionMessageParam[],
      model,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      stream: true,
      stream_options: { include_usage: true },
    },
    { signal },
  );

  const rawResponse: unknown[] = [];

  return {
    getRawResponse: () => rawResponse,
    stream: (async function* () {
      for await (const chunk of completionStream) {
        rawResponse.push(chunk);
        const content = chunk.choices[0]?.delta.content;

        if (content) {
          yield { content, type: 'delta' } satisfies ChatStreamChunk;
        }
      }
    })(),
  };
}
