import express from 'express';

import {
  completeChat,
  type ChatMessage,
  type ChatResult,
  type ChatRole,
} from './chat.js';

const validRoles = new Set<ChatRole>(['system', 'user', 'assistant']);
const maxMessages = 50;
const maxMessageLength = 50_000;
const requestBodyLimit = '128kb';

export interface AppOptions {
  completeChat?: (messages: ChatMessage[]) => Promise<ChatResult>;
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

export function createApp(options: AppOptions = {}) {
  const app = express();
  const createCompletion = options.completeChat ?? completeChat;

  app.use(express.json({ limit: requestBodyLimit }));

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.post('/api/chat', async (request, response) => {
    const messages = isRecord(request.body)
      ? parseMessages(request.body.messages)
      : null;

    if (!messages) {
      response.status(400).json({ error: 'Invalid chat request.' });
      return;
    }

    try {
      const result = await createCompletion(messages);
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
