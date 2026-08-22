import type {
  Response as OpenAIResponse,
  ResponseInput,
  ResponseReasoningItem,
  Tool as ResponseTool,
} from 'openai/resources/responses/responses';

import type {
  ChatMessage,
  ChatResult,
  ChatStreamChunk,
  ChatStreamResult,
  ReasoningEffort,
} from './chat.js';
import { createOpenAIClient } from './openai.js';

export type ReasoningSummary = 'auto' | 'concise' | 'detailed';
export type ChatTool = 'web_search';

function toResponseInput(messages: ChatMessage[]): ResponseInput {
  return messages.map(({ content, role }) => ({ content, role }));
}

function toResponseTools(tools: ChatTool[]): ResponseTool[] | undefined {
  return tools.includes('web_search') ? [{ type: 'web_search' }] : undefined;
}

function toReasoning(
  reasoningEffort: ReasoningEffort | null,
  reasoningSummary: ReasoningSummary | null,
) {
  if (!reasoningEffort && !reasoningSummary) {
    return undefined;
  }

  return {
    ...(reasoningEffort ? { effort: reasoningEffort } : {}),
    ...(reasoningSummary ? { summary: reasoningSummary } : {}),
  };
}

function getReasoningSummary(response: OpenAIResponse): string | undefined {
  const summaryParts = (response.output ?? [])
    .filter((item): item is ResponseReasoningItem => item.type === 'reasoning')
    .flatMap((item) => item.summary ?? [])
    .map((part) => part.text.trim())
    .filter(Boolean);

  return summaryParts.length > 0 ? summaryParts.join('\n\n') : undefined;
}

export async function completeResponse(
  messages: ChatMessage[],
  model: string,
  tools: ChatTool[],
  reasoningEffort: ReasoningEffort | null,
  reasoningSummary: ReasoningSummary | null,
): Promise<ChatResult> {
  const client = createOpenAIClient();
  const responseTools = toResponseTools(tools);
  const reasoning = toReasoning(reasoningEffort, reasoningSummary);
  const response = await client.responses.create({
    input: toResponseInput(messages),
    model,
    ...(responseTools ? { tools: responseTools } : {}),
    ...(reasoning ? { reasoning } : {}),
    store: false,
  });
  const content = response.output_text;

  if (!content) {
    throw new Error('The model returned an empty response.');
  }

  const summary = getReasoningSummary(response);

  return {
    content,
    rawResponse: response,
    ...(summary ? { reasoningSummary: summary } : {}),
  };
}

export async function streamResponse(
  messages: ChatMessage[],
  model: string,
  tools: ChatTool[],
  reasoningEffort: ReasoningEffort | null,
  reasoningSummary: ReasoningSummary | null,
  signal?: AbortSignal,
): Promise<ChatStreamResult> {
  const client = createOpenAIClient();
  const responseTools = toResponseTools(tools);
  const reasoning = toReasoning(reasoningEffort, reasoningSummary);
  const responseStream = await client.responses.create(
    {
      input: toResponseInput(messages),
      model,
      ...(responseTools ? { tools: responseTools } : {}),
      ...(reasoning ? { reasoning } : {}),
      store: false,
      stream: true,
    },
    { signal },
  );

  const rawResponse: unknown[] = [];

  return {
    getRawResponse: () => rawResponse,
    stream: (async function* () {
      const summaryPartsWithDeltas = new Set<number>();

      for await (const event of responseStream) {
        rawResponse.push(event);
        if (event.type === 'response.output_text.delta' && event.delta) {
          yield {
            content: event.delta,
            type: 'delta',
          } satisfies ChatStreamChunk;
        } else if (
          event.type === 'response.reasoning_summary_text.delta' &&
          event.delta
        ) {
          summaryPartsWithDeltas.add(event.summary_index);
          yield {
            content: event.delta,
            type: 'reasoning_summary',
          } satisfies ChatStreamChunk;
        } else if (
          event.type === 'response.reasoning_summary_text.done' &&
          !summaryPartsWithDeltas.has(event.summary_index) &&
          event.text
        ) {
          yield {
            content: event.text,
            type: 'reasoning_summary',
          } satisfies ChatStreamChunk;
        }
      }
    })(),
  };
}
