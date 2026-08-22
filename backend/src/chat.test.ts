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

import {
  completeChat,
  getChatModels,
  streamChat,
  type ChatStreamChunk,
} from './chat.js';

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

  it('returns a completion with the selected reasoning effort', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    createCompletion.mockResolvedValue({
      choices: [{ message: { content: 'Hello from the model.' } }],
    });

    await expect(
      completeChat([{ content: 'Hello', role: 'user' }], 'test-model', 'high'),
    ).resolves.toEqual({
      content: 'Hello from the model.',
      rawResponse: {
        choices: [{ message: { content: 'Hello from the model.' } }],
      },
    });
    expect(createCompletion).toHaveBeenCalledWith({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'test-model',
      reasoning_effort: 'high',
    });
  });

  it('streams completion content with the selected reasoning effort', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const signal = new AbortController().signal;
    createCompletion.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: 'Hello ' } }] };
        yield { choices: [{ delta: { content: 'as it ' } }] };
        yield { choices: [{ delta: { content: 'arrives.' } }] };
      })(),
    );

    const result = await streamChat(
      [{ content: 'Hello', role: 'user' }],
      'stream-model',
      'low',
      signal,
    );
    const chunks: ChatStreamChunk[] = [];

    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: 'Hello ', type: 'delta' },
      { content: 'as it ', type: 'delta' },
      { content: 'arrives.', type: 'delta' },
    ]);
    expect(result.getRawResponse?.()).toEqual([
      { choices: [{ delta: { content: 'Hello ' } }] },
      { choices: [{ delta: { content: 'as it ' } }] },
      { choices: [{ delta: { content: 'arrives.' } }] },
    ]);
    expect(createCompletion).toHaveBeenCalledWith(
      {
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'stream-model',
        reasoning_effort: 'low',
        stream: true,
      },
      { signal },
    );
  });

  it('requires an API key', async () => {
    await expect(
      completeChat([{ content: 'Hello', role: 'user' }], 'test-model', null),
    ).rejects.toThrow('OPENAI_API_KEY is not configured.');
    expect(OpenAIClient).not.toHaveBeenCalled();
  });

  it('rejects an empty model response', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    createCompletion.mockResolvedValue({
      choices: [{ message: { content: null } }],
    });

    await expect(
      completeChat([{ content: 'Hello', role: 'user' }], 'test-model', null),
    ).rejects.toThrow('The model returned an empty response.');
    expect(createCompletion).toHaveBeenCalledWith({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'test-model',
    });
  });
});
