import { afterEach, describe, expect, it, vi } from 'vitest';

const { createCompletion, OpenAIClient } = vi.hoisted(() => {
  const createCompletion = vi.fn();
  const OpenAIClient = vi.fn(function OpenAIClient() {
    return {
      chat: {
        completions: {
          create: createCompletion,
        },
      },
    };
  });

  return { createCompletion, OpenAIClient };
});

vi.mock('openai', () => ({ default: OpenAIClient }));

import { completeChat } from './chat.js';

describe('Chat Completions client', () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_MODEL;
    vi.clearAllMocks();
  });

  it('returns a completion from the configured model', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'test-model';
    createCompletion.mockResolvedValue({
      choices: [{ message: { content: 'Hello from the model.' } }],
    });

    await expect(
      completeChat([{ content: 'Hello', role: 'user' }]),
    ).resolves.toEqual({
      content: 'Hello from the model.',
    });
    expect(createCompletion).toHaveBeenCalledWith({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'test-model',
    });
  });

  it('requires an API key', async () => {
    await expect(
      completeChat([{ content: 'Hello', role: 'user' }]),
    ).rejects.toThrow('OPENAI_API_KEY is not configured.');
    expect(OpenAIClient).not.toHaveBeenCalled();
  });

  it('rejects an empty model response', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    createCompletion.mockResolvedValue({
      choices: [{ message: { content: null } }],
    });

    await expect(
      completeChat([{ content: 'Hello', role: 'user' }]),
    ).rejects.toThrow('The model returned an empty response.');
  });
});
