import { afterEach, describe, expect, it, vi } from 'vitest';

const { createResponse, OpenAIClient } = vi.hoisted(() => {
  const createResponse = vi.fn();
  const OpenAIClient = vi.fn(function OpenAIClient() {
    return {
      responses: {
        create: createResponse,
      },
    };
  });

  return { createResponse, OpenAIClient };
});

vi.mock('openai', () => ({ default: OpenAIClient }));

import { completeResponse, streamResponse } from './responses.js';

describe('Responses API client', () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    vi.clearAllMocks();
  });

  it('returns a complete response with the selected reasoning effort', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    createResponse.mockResolvedValue({
      output_text: 'Hello from the Responses API.',
    });

    await expect(
      completeResponse(
        [{ content: 'Hello', role: 'user' }],
        'test-model',
        'high',
      ),
    ).resolves.toEqual({ content: 'Hello from the Responses API.' });
    expect(createResponse).toHaveBeenCalledWith({
      input: [{ content: 'Hello', role: 'user' }],
      model: 'test-model',
      reasoning: { effort: 'high' },
      store: false,
    });
  });

  it('streams response text with the selected reasoning effort', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const signal = new AbortController().signal;
    createResponse.mockResolvedValue(
      (async function* () {
        yield { delta: 'Hello ', type: 'response.output_text.delta' };
        yield { delta: 'as it arrives.', type: 'response.output_text.delta' };
        yield { type: 'response.completed' };
      })(),
    );

    const result = await streamResponse(
      [{ content: 'Hello', role: 'user' }],
      'test-model',
      'low',
      signal,
    );
    const chunks: string[] = [];

    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Hello ', 'as it arrives.']);
    expect(createResponse).toHaveBeenCalledWith(
      {
        input: [{ content: 'Hello', role: 'user' }],
        model: 'test-model',
        reasoning: { effort: 'low' },
        store: false,
        stream: true,
      },
      { signal },
    );
  });

  it('rejects an empty response', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    createResponse.mockResolvedValue({ output_text: '' });

    await expect(
      completeResponse(
        [{ content: 'Hello', role: 'user' }],
        'test-model',
        null,
      ),
    ).rejects.toThrow('The model returned an empty response.');
    expect(createResponse).toHaveBeenCalledWith({
      input: [{ content: 'Hello', role: 'user' }],
      model: 'test-model',
      store: false,
    });
  });
});
