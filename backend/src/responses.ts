import type { ResponseInput } from 'openai/resources/responses/responses';

import type {
  ChatMessage,
  ChatResult,
  ChatStreamResult,
  ReasoningEffort,
} from './chat.js';
import { createOpenAIClient } from './openai.js';

function toResponseInput(messages: ChatMessage[]): ResponseInput {
  return messages.map(({ content, role }) => ({ content, role }));
}

export async function completeResponse(
  messages: ChatMessage[],
  model: string,
  reasoningEffort: ReasoningEffort | null,
): Promise<ChatResult> {
  const client = createOpenAIClient();
  const response = await client.responses.create({
    input: toResponseInput(messages),
    model,
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    store: false,
  });
  const content = response.output_text;

  if (!content) {
    throw new Error('The model returned an empty response.');
  }

  return { content };
}

export async function streamResponse(
  messages: ChatMessage[],
  model: string,
  reasoningEffort: ReasoningEffort | null,
  signal?: AbortSignal,
): Promise<ChatStreamResult> {
  const client = createOpenAIClient();
  const responseStream = await client.responses.create(
    {
      input: toResponseInput(messages),
      model,
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
      store: false,
      stream: true,
    },
    { signal },
  );

  return {
    stream: (async function* () {
      for await (const event of responseStream) {
        if (event.type === 'response.output_text.delta' && event.delta) {
          yield event.delta;
        }
      }
    })(),
  };
}
