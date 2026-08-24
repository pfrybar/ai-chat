import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';

const models = ['default-model', 'alternate-model'];
const messages = [{ content: 'Hello', role: 'user' as const }];

describe('API application', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports its health', async () => {
    const response = await request(createApp()).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('returns the available models and the first model as the default', async () => {
    const response = await request(createApp({ models })).get(
      '/api/chat/options',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      defaultModel: 'default-model',
      models,
    });
  });

  it('returns a complete Chat Completions response', async () => {
    const completeChat = vi
      .fn()
      .mockResolvedValue({ content: 'Chat response.' });
    const response = await request(createApp({ completeChat, models }))
      .post('/api/chat')
      .send({
        api: 'chat',
        messages,
        model: 'alternate-model',
        reasoningEffort: 'high',
        stream: false,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: { content: 'Chat response.', role: 'assistant' },
    });
    expect(completeChat).toHaveBeenCalledWith(
      messages,
      'alternate-model',
      'high',
    );
  });

  it('streams Chat Completions response chunks', async () => {
    const streamChat = vi.fn().mockResolvedValue({
      stream: (async function* () {
        yield { content: 'Hello ', type: 'delta' as const };
        yield { content: 'from Chat Completions.', type: 'delta' as const };
      })(),
    });
    const response = await request(createApp({ models, streamChat }))
      .post('/api/chat')
      .send({
        api: 'chat',
        messages,
        model: 'alternate-model',
        reasoningEffort: 'low',
        stream: true,
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toBe(
      'data: {"content":"Hello ","type":"delta"}\n\n' +
        'data: {"content":"from Chat Completions.","type":"delta"}\n\n' +
        'data: {"type":"done"}\n\n',
    );
    expect(streamChat).toHaveBeenCalledWith(
      messages,
      'alternate-model',
      'low',
      expect.any(AbortSignal),
    );
  });

  it('returns a complete Responses API response and reasoning summary', async () => {
    const completeResponse = vi.fn().mockResolvedValue({
      content: 'Responses response.',
      rawResponse: { id: 'resp_complete', object: 'response' },
      reasoningSummary: 'The model considered the relevant facts.',
    });
    const response = await request(createApp({ completeResponse, models }))
      .post('/api/chat')
      .send({
        api: 'responses',
        messages,
        model: 'alternate-model',
        tools: ['web_search'],
        reasoningEffort: 'minimal',
        reasoningSummary: 'detailed',
        returnTokenBudget: 'unlimited',
        searchContextSize: 'high',
        stream: false,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: { content: 'Responses response.', role: 'assistant' },
      rawResponse: { id: 'resp_complete', object: 'response' },
      reasoningSummary: 'The model considered the relevant facts.',
    });
    expect(completeResponse).toHaveBeenCalledWith(
      messages,
      'alternate-model',
      ['web_search'],
      'minimal',
      'detailed',
      {
        imageCaptions: null,
        imageMaxResults: null,
        returnTokenBudget: 'unlimited',
        searchContextSize: 'high',
        searchContentTypes: null,
      },
    );
  });

  it('passes image search options to the Responses service', async () => {
    const completeResponse = vi.fn().mockResolvedValue({
      content: 'Responses response with images.',
    });
    const response = await request(createApp({ completeResponse, models }))
      .post('/api/chat')
      .send({
        api: 'responses',
        imageCaptions: false,
        imageMaxResults: 5,
        messages,
        model: 'alternate-model',
        searchContentTypes: ['image', 'text'],
        stream: false,
        tools: ['web_search'],
      });

    expect(response.status).toBe(200);
    expect(completeResponse).toHaveBeenCalledWith(
      messages,
      'alternate-model',
      ['web_search'],
      null,
      null,
      {
        imageCaptions: false,
        imageMaxResults: 5,
        returnTokenBudget: null,
        searchContextSize: null,
        searchContentTypes: ['image', 'text'],
      },
    );
  });

  it('streams Responses API response chunks', async () => {
    const streamResponse = vi.fn().mockResolvedValue({
      getRawResponse: () => [{ type: 'response.completed' }],
      stream: (async function* () {
        yield {
          type: 'web_search' as const,
          update: {
            action: {
              query: 'current facts about the topic',
              type: 'search' as const,
            },
            itemId: 'ws_test',
            status: 'searching' as const,
          },
        };
        yield {
          content: 'The model considered ',
          type: 'reasoning_summary' as const,
        };
        yield { content: 'Hello ', type: 'delta' as const };
        yield { content: 'from Responses.', type: 'delta' as const };
      })(),
    });
    const response = await request(createApp({ models, streamResponse }))
      .post('/api/chat')
      .send({
        api: 'responses',
        messages,
        model: 'alternate-model',
        tools: ['web_search'],
        reasoningEffort: 'low',
        reasoningSummary: 'concise',
        stream: true,
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toBe(
      'data: {"type":"web_search","update":{"action":{"query":"current facts about the topic","type":"search"},"itemId":"ws_test","status":"searching"}}\n\n' +
        'data: {"content":"The model considered ","type":"reasoning_summary"}\n\n' +
        'data: {"content":"Hello ","type":"delta"}\n\n' +
        'data: {"content":"from Responses.","type":"delta"}\n\n' +
        'data: {"rawResponse":[{"type":"response.completed"}],"type":"done"}\n\n',
    );
    expect(streamResponse).toHaveBeenCalledWith(
      messages,
      'alternate-model',
      ['web_search'],
      'low',
      'concise',
      expect.any(AbortSignal),
      {
        imageCaptions: null,
        imageMaxResults: null,
        returnTokenBudget: null,
        searchContextSize: null,
        searchContentTypes: null,
      },
    );
  });

  it('sends provider errors through an active response stream', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const streamChat = vi.fn().mockResolvedValue({
      stream: (async function* () {
        yield { content: 'Partial response.', type: 'delta' as const };
        throw new Error('The stream stopped.');
      })(),
    });
    const response = await request(createApp({ models, streamChat }))
      .post('/api/chat')
      .send({ api: 'chat', messages, model: 'default-model', stream: true });

    expect(response.status).toBe(200);
    expect(response.text).toContain(
      'data: {"content":"Partial response.","type":"delta"}\n\n',
    );
    expect(response.text).toContain(
      'data: {"error":"The stream stopped.","type":"error"}\n\n',
    );
  });

  it('rejects an invalid chat request', async () => {
    const completeChat = vi.fn();
    const response = await request(createApp({ completeChat, models }))
      .post('/api/chat')
      .send({
        api: 'chat',
        messages: [],
        model: 'default-model',
        stream: false,
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid chat request.' });
    expect(completeChat).not.toHaveBeenCalled();
  });

  it('rejects an unsupported API', async () => {
    const completeChat = vi.fn();
    const response = await request(createApp({ completeChat, models }))
      .post('/api/chat')
      .send({
        api: 'unknown',
        messages,
        model: 'default-model',
        stream: false,
      });

    expect(response.status).toBe(400);
    expect(completeChat).not.toHaveBeenCalled();
  });

  it('rejects unsupported tools', async () => {
    const completeResponse = vi.fn();
    const response = await request(createApp({ completeResponse, models }))
      .post('/api/chat')
      .send({
        api: 'responses',
        messages,
        model: 'default-model',
        stream: false,
        tools: ['file_search'],
      });

    expect(response.status).toBe(400);
    expect(completeResponse).not.toHaveBeenCalled();
  });

  it('rejects Web search for Chat Completions', async () => {
    const completeChat = vi.fn();
    const response = await request(createApp({ completeChat, models }))
      .post('/api/chat')
      .send({
        api: 'chat',
        messages,
        model: 'default-model',
        stream: false,
        tools: ['web_search'],
      });

    expect(response.status).toBe(400);
    expect(completeChat).not.toHaveBeenCalled();
  });

  it('rejects invalid web search parameters', async () => {
    const completeResponse = vi.fn();
    const response = await request(createApp({ completeResponse, models }))
      .post('/api/chat')
      .send({
        api: 'responses',
        messages,
        model: 'default-model',
        returnTokenBudget: '50000',
        searchContextSize: 'extreme',
        stream: false,
        tools: ['web_search'],
      });

    expect(response.status).toBe(400);
    expect(completeResponse).not.toHaveBeenCalled();
  });

  it('rejects a reasoning summary for Chat Completions', async () => {
    const completeChat = vi.fn();
    const response = await request(createApp({ completeChat, models }))
      .post('/api/chat')
      .send({
        api: 'chat',
        messages,
        model: 'default-model',
        reasoningSummary: 'auto',
        stream: false,
      });

    expect(response.status).toBe(400);
    expect(completeChat).not.toHaveBeenCalled();
  });

  it('rejects reasoning efforts unsupported by Chat Completions', async () => {
    const completeChat = vi.fn();
    const response = await request(createApp({ completeChat, models }))
      .post('/api/chat')
      .send({
        api: 'chat',
        messages,
        model: 'default-model',
        reasoningEffort: 'minimal',
        stream: false,
      });

    expect(response.status).toBe(400);
    expect(completeChat).not.toHaveBeenCalled();
  });

  it('rejects an unsupported reasoning effort', async () => {
    const completeChat = vi.fn();
    const response = await request(createApp({ completeChat, models }))
      .post('/api/chat')
      .send({
        api: 'chat',
        messages,
        model: 'default-model',
        reasoningEffort: 'extreme',
        stream: false,
      });

    expect(response.status).toBe(400);
    expect(completeChat).not.toHaveBeenCalled();
  });

  it('rejects a model that is not configured', async () => {
    const completeChat = vi.fn();
    const response = await request(createApp({ completeChat, models }))
      .post('/api/chat')
      .send({ api: 'chat', messages, model: 'unknown-model', stream: false });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid chat request.' });
    expect(completeChat).not.toHaveBeenCalled();
  });

  it('returns a provider error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const completeChat = vi
      .fn()
      .mockRejectedValue(new Error('The model is unavailable.'));
    const response = await request(createApp({ completeChat, models }))
      .post('/api/chat')
      .send({ api: 'chat', messages, model: 'default-model', stream: false });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: 'The model is unavailable.' });
  });
});
