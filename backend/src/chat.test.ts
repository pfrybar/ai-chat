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

import { completeChat, getChatModels } from './chat.js';

describe('Chat Completions client', () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_MODELS;
    vi.clearAllMocks();
  });

  it('reads and deduplicates the configured models in order', () => {
    process.env.OPENAI_MODELS = ' gpt-4o-mini, gpt-4.1-mini, gpt-4o-mini ';

    expect(getChatModels()).toEqual(['gpt-4o-mini', 'gpt-4.1-mini']);
  });

  it('uses a default model when no models are configured', () => {
    expect(getChatModels()).toEqual(['gpt-4o-mini']);
  });

  it('returns a completion from the selected model', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    createCompletion.mockResolvedValue({
      choices: [{ message: { content: 'Hello from the model.' } }],
    });

    await expect(
      completeChat([{ content: 'Hello', role: 'user' }], 'test-model'),
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
      completeChat([{ content: 'Hello', role: 'user' }], 'test-model'),
    ).rejects.toThrow('OPENAI_API_KEY is not configured.');
    expect(OpenAIClient).not.toHaveBeenCalled();
  });

  it('rejects an empty model response', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    createCompletion.mockResolvedValue({
      choices: [{ message: { content: null } }],
    });

    await expect(
      completeChat([{ content: 'Hello', role: 'user' }], 'test-model'),
    ).rejects.toThrow('The model returned an empty response.');
  });
});
