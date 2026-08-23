import type {
  Response as OpenAIResponse,
  ResponseFunctionWebSearch,
  ResponseInput,
  ResponseReasoningItem,
  ResponseStreamEvent,
  Tool as ResponseTool,
} from 'openai/resources/responses/responses';

import type {
  ChatMessage,
  ChatResult,
  ChatStreamChunk,
  ChatStreamResult,
  ReasoningEffort,
  WebSearchAction,
  WebSearchStatus,
  WebSearchUpdate,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toWebSearchAction(action: unknown): WebSearchAction | undefined {
  if (!isRecord(action) || typeof action.type !== 'string') {
    return undefined;
  }

  if (action.type === 'search') {
    const queries = Array.isArray(action.queries)
      ? action.queries.filter(
          (query): query is string => typeof query === 'string',
        )
      : undefined;
    const query = typeof action.query === 'string' ? action.query : undefined;
    const sources = Array.isArray(action.sources)
      ? action.sources.flatMap((source) => {
          if (!isRecord(source) || typeof source.url !== 'string') {
            return [];
          }

          return [
            {
              ...(typeof source.title === 'string'
                ? { title: source.title }
                : {}),
              url: source.url,
            },
          ];
        })
      : undefined;

    return {
      type: 'search',
      ...(queries && queries.length > 0 ? { queries } : {}),
      ...(query ? { query } : {}),
      ...(sources && sources.length > 0 ? { sources } : {}),
    };
  }

  if (action.type === 'open_page') {
    return {
      type: 'open_page',
      ...(typeof action.url === 'string' ? { url: action.url } : {}),
    };
  }

  if (
    action.type === 'find_in_page' &&
    typeof action.pattern === 'string' &&
    typeof action.url === 'string'
  ) {
    return { pattern: action.pattern, type: 'find_in_page', url: action.url };
  }

  return undefined;
}

function toWebSearchUpdate(
  webSearchCall: ResponseFunctionWebSearch,
): WebSearchUpdate {
  const action = toWebSearchAction(webSearchCall.action);

  return {
    ...(action ? { action } : {}),
    itemId: webSearchCall.id,
    status: webSearchCall.status,
  };
}

export function getWebSearchUpdates(
  response: OpenAIResponse,
): WebSearchUpdate[] {
  return (response.output ?? [])
    .filter(
      (item): item is ResponseFunctionWebSearch =>
        item.type === 'web_search_call',
    )
    .map(toWebSearchUpdate);
}

function getWebSearchUpdateFromEvent(
  event: ResponseStreamEvent,
): WebSearchUpdate | null {
  if (
    event.type === 'response.web_search_call.in_progress' ||
    event.type === 'response.web_search_call.searching' ||
    event.type === 'response.web_search_call.completed'
  ) {
    return {
      itemId: event.item_id,
      status: event.type.slice(
        'response.web_search_call.'.length,
      ) as WebSearchStatus,
    };
  }

  if (
    (event.type === 'response.output_item.added' ||
      event.type === 'response.output_item.done') &&
    event.item.type === 'web_search_call'
  ) {
    return toWebSearchUpdate(event.item);
  }

  return null;
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
    ...(responseTools ? { include: ['web_search_call.action.sources'] } : {}),
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
  const webSearchUpdates = getWebSearchUpdates(response);

  return {
    content,
    rawResponse: response,
    ...(summary ? { reasoningSummary: summary } : {}),
    ...(webSearchUpdates.length > 0 ? { webSearchUpdates } : {}),
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
      ...(responseTools ? { include: ['web_search_call.action.sources'] } : {}),
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
        const webSearchUpdate = getWebSearchUpdateFromEvent(event);

        if (webSearchUpdate) {
          yield {
            type: 'web_search',
            update: webSearchUpdate,
          } satisfies ChatStreamChunk;
        } else if (event.type === 'response.output_text.delta' && event.delta) {
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
