import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

import { createOpenAIClient } from './openai.js';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatResult {
  content: string;
}

export interface ChatStreamResult {
  stream: AsyncIterable<string>;
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
): Promise<ChatResult> {
  const client = createOpenAIClient();
  const completion = await client.chat.completions.create({
    messages: messages as ChatCompletionMessageParam[],
    model,
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
  signal?: AbortSignal,
): Promise<ChatStreamResult> {
  const client = createOpenAIClient();
  const completionStream = await client.chat.completions.create(
    {
      messages: messages as ChatCompletionMessageParam[],
      model,
      stream: true,
    },
    { signal },
  );

  return {
    stream: (async function* () {
      for await (const chunk of completionStream) {
        const content = chunk.choices[0]?.delta.content;

        if (content) {
          yield content;
        }
      }
    })(),
  };
}
