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
  reasoningSummary?: string;
}

export type ChatStreamChunk =
  | { type: 'delta'; content: string }
  | { type: 'reasoning_summary'; content: string };

export interface ChatStreamResult {
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

  return { content };
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
    },
    { signal },
  );

  return {
    stream: (async function* () {
      for await (const chunk of completionStream) {
        const content = chunk.choices[0]?.delta.content;

        if (content) {
          yield { content, type: 'delta' } satisfies ChatStreamChunk;
        }
      }
    })(),
  };
}
