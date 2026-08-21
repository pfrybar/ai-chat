import express from 'express';

import {
  completeChat,
  getChatModels,
  streamChat,
  type ChatMessage,
  type ChatResult,
  type ChatRole,
  type ChatStreamResult,
} from './chat.js';

const validRoles = new Set<ChatRole>(['system', 'user', 'assistant']);
const maxMessages = 50;
const maxMessageLength = 50_000;
const requestBodyLimit = '128kb';

export interface AppOptions {
  completeChat?: (
    messages: ChatMessage[],
    model: string,
  ) => Promise<ChatResult>;
  models?: string[];
  streamChat?: (
    messages: ChatMessage[],
    model: string,
    signal?: AbortSignal,
  ) => Promise<ChatStreamResult>;
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
    | { type: 'done' }
    | { type: 'error'; error: string },
) {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function streamToResponse(
  response: express.Response,
  createStream: (signal: AbortSignal) => Promise<ChatStreamResult>,
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

    for await (const content of result.stream) {
      if (response.destroyed) {
        return;
      }

      if (content) {
        hasContent = true;
        sendEvent(response, { content, type: 'delta' });
      }
    }

    if (!hasContent) {
      throw new Error('The model returned an empty response.');
    }

    if (!response.destroyed) {
      sendEvent(response, { type: 'done' });
      response.end();
    }
  } catch (error) {
    console.error('Chat completion stream failed:', error);
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

export function createApp(options: AppOptions = {}) {
  const app = express();
  const createCompletion = options.completeChat ?? completeChat;
  const createCompletionStream = options.streamChat ?? streamChat;
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
    const model = isRecord(request.body) ? request.body.model : null;
    const stream = isRecord(request.body) ? request.body.stream : null;

    if (
      !messages ||
      typeof model !== 'string' ||
      !models.includes(model) ||
      typeof stream !== 'boolean'
    ) {
      response.status(400).json({ error: 'Invalid chat request.' });
      return;
    }

    if (stream) {
      await streamToResponse(response, (signal) =>
        createCompletionStream(messages, model, signal),
      );
      return;
    }

    try {
      const result = await createCompletion(messages, model);
      response.json({
        message: {
          content: result.content,
          role: 'assistant',
        },
      });
    } catch (error) {
      console.error('Chat completion failed:', error);
      response.status(502).json({ error: getErrorMessage(error) });
    }
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
