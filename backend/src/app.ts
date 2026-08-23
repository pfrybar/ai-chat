import express from 'express';

import {
  completeChat,
  getChatModels,
  streamChat,
  type ChatMessage,
  type ChatResult,
  type ChatRole,
  type ChatStreamResult,
  type ReasoningEffort,
  type WebSearchUpdate,
} from './chat.js';
import {
  completeResponse,
  streamResponse,
  type ChatTool,
  type ReasoningSummary,
} from './responses.js';

const validRoles = new Set<ChatRole>(['system', 'user', 'assistant']);
const validApis = new Set<ChatApi>(['chat', 'responses']);
const validTools = new Set<ChatTool>(['web_search']);
const validReasoningEfforts = new Set<ReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);
const validChatReasoningEfforts = new Set<ReasoningEffort>([
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
]);
const maxMessages = 50;
const maxMessageLength = 50_000;
const requestBodyLimit = '128kb';

type ChatApi = 'chat' | 'responses';
type ChatCompleteService = (
  messages: ChatMessage[],
  model: string,
  reasoningEffort: ReasoningEffort | null,
) => Promise<ChatResult>;
type ChatStreamService = (
  messages: ChatMessage[],
  model: string,
  reasoningEffort: ReasoningEffort | null,
  signal?: AbortSignal,
) => Promise<ChatStreamResult>;
type ResponseCompleteService = (
  messages: ChatMessage[],
  model: string,
  tools: ChatTool[],
  reasoningEffort: ReasoningEffort | null,
  reasoningSummary: ReasoningSummary | null,
) => Promise<ChatResult>;
type ResponseStreamService = (
  messages: ChatMessage[],
  model: string,
  tools: ChatTool[],
  reasoningEffort: ReasoningEffort | null,
  reasoningSummary: ReasoningSummary | null,
  signal?: AbortSignal,
) => Promise<ChatStreamResult>;

export interface AppOptions {
  completeChat?: ChatCompleteService;
  completeResponse?: ResponseCompleteService;
  models?: string[];
  streamChat?: ChatStreamService;
  streamResponse?: ResponseStreamService;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseMessages(value: unknown): ChatMessage[] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > maxMessages
  ) {
    return null;
  }

  const messages: ChatMessage[] = [];

  for (const valueMessage of value) {
    if (!isRecord(valueMessage)) {
      return null;
    }

    const { content, role } = valueMessage;

    if (
      typeof role !== 'string' ||
      !validRoles.has(role as ChatRole) ||
      typeof content !== 'string' ||
      content.trim().length === 0 ||
      content.length > maxMessageLength
    ) {
      return null;
    }

    messages.push({ content, role: role as ChatRole });
  }

  return messages;
}

function parseTools(value: unknown): ChatTool[] | null {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const tools: ChatTool[] = [];

  for (const tool of value) {
    if (
      typeof tool !== 'string' ||
      !validTools.has(tool as ChatTool) ||
      tools.includes(tool as ChatTool)
    ) {
      return null;
    }

    tools.push(tool as ChatTool);
  }

  return tools;
}

function parseReasoningEffort(
  value: unknown,
): ReasoningEffort | null | undefined {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (
    typeof value !== 'string' ||
    !validReasoningEfforts.has(value as ReasoningEffort)
  ) {
    return undefined;
  }

  return value as ReasoningEffort;
}

const validReasoningSummaries = new Set<ReasoningSummary>([
  'auto',
  'concise',
  'detailed',
]);

function parseReasoningSummary(
  value: unknown,
): ReasoningSummary | null | undefined {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (
    typeof value !== 'string' ||
    !validReasoningSummaries.has(value as ReasoningSummary)
  ) {
    return undefined;
  }

  return value as ReasoningSummary;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string'
    ? error
    : 'The provider returned an unknown error.';
}

function sendEvent(
  response: express.Response,
  event:
    | { type: 'delta'; content: string }
    | { type: 'reasoning_summary'; content: string }
    | { type: 'web_search'; update: WebSearchUpdate }
    | { type: 'done'; rawResponse?: unknown }
    | { type: 'error'; error: string },
) {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function streamToResponse(
  response: express.Response,
  createStream: (signal: AbortSignal) => Promise<ChatStreamResult>,
  logLabel: string,
) {
  const abortController = new AbortController();
  const abortStream = () => abortController.abort();
  response.once('close', abortStream);

  try {
    const result = await createStream(abortController.signal);

    response.status(200).set({
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();

    let hasContent = false;

    for await (const chunk of result.stream) {
      if (response.destroyed) {
        return;
      }

      if (chunk.type === 'web_search') {
        sendEvent(response, { type: 'web_search', update: chunk.update });
      } else if (chunk.content) {
        if (chunk.type === 'delta') {
          hasContent = true;
          sendEvent(response, { content: chunk.content, type: 'delta' });
        } else {
          sendEvent(response, {
            content: chunk.content,
            type: 'reasoning_summary',
          });
        }
      }
    }

    if (!hasContent) {
      throw new Error('The model returned an empty response.');
    }

    if (!response.destroyed) {
      sendEvent(response, {
        ...(result.getRawResponse
          ? { rawResponse: result.getRawResponse() }
          : {}),
        type: 'done',
      });
      response.end();
    }
  } catch (error) {
    console.error(`${logLabel} stream failed:`, error);
    const message = getErrorMessage(error);

    if (!response.headersSent) {
      response.status(502).json({ error: message });
    } else if (!response.destroyed) {
      sendEvent(response, { error: message, type: 'error' });
      response.end();
    }
  } finally {
    response.off('close', abortStream);
  }
}

async function completeToResponse(
  response: express.Response,
  complete: () => Promise<ChatResult>,
  logLabel: string,
) {
  try {
    const result = await complete();
    response.json({
      message: {
        content: result.content,
        role: 'assistant',
      },
      ...(result.rawResponse !== undefined
        ? { rawResponse: result.rawResponse }
        : {}),
      ...(result.reasoningSummary
        ? { reasoningSummary: result.reasoningSummary }
        : {}),
      ...(result.webSearchUpdates && result.webSearchUpdates.length > 0
        ? { webSearchUpdates: result.webSearchUpdates }
        : {}),
    });
  } catch (error) {
    console.error(`${logLabel} failed:`, error);
    response.status(502).json({ error: getErrorMessage(error) });
  }
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const services = {
    completeChat: options.completeChat ?? completeChat,
    completeResponse: options.completeResponse ?? completeResponse,
    streamChat: options.streamChat ?? streamChat,
    streamResponse: options.streamResponse ?? streamResponse,
  };
  const models = options.models?.length
    ? [...new Set(options.models)]
    : getChatModels();
  const defaultModel = models[0] ?? 'gpt-4o-mini';

  app.use(express.json({ limit: requestBodyLimit }));

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.get('/api/chat/options', (_request, response) => {
    response.json({ defaultModel, models });
  });

  app.post('/api/chat', async (request, response) => {
    const messages = isRecord(request.body)
      ? parseMessages(request.body.messages)
      : null;
    const api = isRecord(request.body) ? request.body.api : null;
    const model = isRecord(request.body) ? request.body.model : null;
    const tools = isRecord(request.body)
      ? parseTools(request.body.tools)
      : null;
    const reasoningEffort = isRecord(request.body)
      ? parseReasoningEffort(request.body.reasoningEffort)
      : undefined;
    const reasoningSummary = isRecord(request.body)
      ? parseReasoningSummary(request.body.reasoningSummary)
      : undefined;
    const stream = isRecord(request.body) ? request.body.stream : null;

    if (
      !messages ||
      typeof api !== 'string' ||
      !validApis.has(api as ChatApi) ||
      typeof model !== 'string' ||
      !models.includes(model) ||
      !tools ||
      reasoningEffort === undefined ||
      reasoningSummary === undefined ||
      (api === 'chat' &&
        (tools.length > 0 ||
          reasoningSummary !== null ||
          (reasoningEffort !== null &&
            !validChatReasoningEfforts.has(reasoningEffort)))) ||
      typeof stream !== 'boolean'
    ) {
      response.status(400).json({ error: 'Invalid chat request.' });
      return;
    }

    const chatApi = api as ChatApi;
    const logLabel =
      chatApi === 'chat' ? 'Chat completion' : 'Responses API request';

    if (stream) {
      await streamToResponse(
        response,
        (signal) =>
          chatApi === 'chat'
            ? services.streamChat(messages, model, reasoningEffort, signal)
            : services.streamResponse(
                messages,
                model,
                tools,
                reasoningEffort,
                reasoningSummary,
                signal,
              ),
        logLabel,
      );
      return;
    }

    await completeToResponse(
      response,
      () =>
        chatApi === 'chat'
          ? services.completeChat(messages, model, reasoningEffort)
          : services.completeResponse(
              messages,
              model,
              tools,
              reasoningEffort,
              reasoningSummary,
            ),
      logLabel,
    );
  });

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      next: express.NextFunction,
    ) => {
      if (isRecord(error) && error.type === 'entity.too.large') {
        response.status(413).json({ error: 'Request body too large.' });
        return;
      }

      if (error instanceof SyntaxError) {
        response.status(400).json({ error: 'Invalid JSON request body.' });
        return;
      }

      next(error);
    },
  );

  return app;
}

export const app = createApp();
