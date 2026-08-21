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
      .send({ api: 'chat', messages, model: 'alternate-model', stream: false });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: { content: 'Chat response.', role: 'assistant' },
    });
    expect(completeChat).toHaveBeenCalledWith(messages, 'alternate-model');
  });

  it('streams Chat Completions response chunks', async () => {
    const streamChat = vi.fn().mockResolvedValue({
      stream: (async function* () {
        yield 'Hello ';
        yield 'from Chat Completions.';
      })(),
    });
    const response = await request(createApp({ models, streamChat }))
      .post('/api/chat')
      .send({ api: 'chat', messages, model: 'alternate-model', stream: true });

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
      expect.any(AbortSignal),
    );
  });

  it('returns a complete Responses API response', async () => {
    const completeResponse = vi
      .fn()
      .mockResolvedValue({ content: 'Responses response.' });
    const response = await request(createApp({ completeResponse, models }))
      .post('/api/chat')
      .send({
        api: 'responses',
        messages,
        model: 'alternate-model',
        stream: false,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: { content: 'Responses response.', role: 'assistant' },
    });
    expect(completeResponse).toHaveBeenCalledWith(messages, 'alternate-model');
  });

  it('streams Responses API response chunks', async () => {
    const streamResponse = vi.fn().mockResolvedValue({
      stream: (async function* () {
        yield 'Hello ';
        yield 'from Responses.';
      })(),
    });
    const response = await request(createApp({ models, streamResponse }))
      .post('/api/chat')
      .send({
        api: 'responses',
        messages,
        model: 'alternate-model',
        stream: true,
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toBe(
      'data: {"content":"Hello ","type":"delta"}\n\n' +
        'data: {"content":"from Responses.","type":"delta"}\n\n' +
        'data: {"type":"done"}\n\n',
    );
    expect(streamResponse).toHaveBeenCalledWith(
      messages,
      'alternate-model',
      expect.any(AbortSignal),
    );
  });

  it('sends provider errors through an active response stream', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const streamChat = vi.fn().mockResolvedValue({
      stream: (async function* () {
        yield 'Partial response.';
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
