import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';

describe('API application', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports its health', async () => {
    const response = await request(createApp()).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('returns a complete chat response', async () => {
    const completeChat = vi
      .fn()
      .mockResolvedValue({ content: 'Hello from the assistant.' });
    const response = await request(createApp({ completeChat }))
      .post('/api/chat')
      .send({ messages: [{ content: 'Hello', role: 'user' }] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: { content: 'Hello from the assistant.', role: 'assistant' },
    });
    expect(completeChat).toHaveBeenCalledWith([
      { content: 'Hello', role: 'user' },
    ]);
  });

  it('rejects an invalid chat request', async () => {
    const completeChat = vi.fn();
    const response = await request(createApp({ completeChat }))
      .post('/api/chat')
      .send({ messages: [] });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid chat request.' });
    expect(completeChat).not.toHaveBeenCalled();
  });

  it('returns a provider error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const completeChat = vi
      .fn()
      .mockRejectedValue(new Error('The model is unavailable.'));
    const response = await request(createApp({ completeChat }))
      .post('/api/chat')
      .send({ messages: [{ content: 'Hello', role: 'user' }] });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: 'The model is unavailable.' });
  });
});
