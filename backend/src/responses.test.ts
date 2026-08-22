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

  it('returns a complete response and requested reasoning summary', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    createResponse.mockResolvedValue({
      output: [
        {
          summary: [
            {
              text: 'The model considered the relevant facts.',
              type: 'summary_text',
            },
          ],
          type: 'reasoning',
        },
      ],
      output_text: 'Hello from the Responses API.',
    });

    await expect(
      completeResponse(
        [{ content: 'Hello', role: 'user' }],
        'test-model',
        ['web_search'],
        'high',
        'detailed',
      ),
    ).resolves.toEqual({
      content: 'Hello from the Responses API.',
      reasoningSummary: 'The model considered the relevant facts.',
    });
    expect(createResponse).toHaveBeenCalledWith({
      input: [{ content: 'Hello', role: 'user' }],
      model: 'test-model',
      reasoning: { effort: 'high', summary: 'detailed' },
      tools: [{ type: 'web_search' }],
      store: false,
    });
  });

  it('streams response text and reasoning summary deltas', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const signal = new AbortController().signal;
    createResponse.mockResolvedValue(
      (async function* () {
        yield {
          delta: 'The model considered ',
          summary_index: 0,
          type: 'response.reasoning_summary_text.delta',
        };
        yield {
          delta: 'the relevant facts.',
          summary_index: 0,
          type: 'response.reasoning_summary_text.delta',
        };
        yield { delta: 'Hello ', type: 'response.output_text.delta' };
        yield { delta: 'as it arrives.', type: 'response.output_text.delta' };
      })(),
    );

    const result = await streamResponse(
      [{ content: 'Hello', role: 'user' }],
      'test-model',
      ['web_search'],
      'low',
      'concise',
      signal,
    );
    const chunks = [];

    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: 'The model considered ', type: 'reasoning_summary' },
      { content: 'the relevant facts.', type: 'reasoning_summary' },
      { content: 'Hello ', type: 'delta' },
      { content: 'as it arrives.', type: 'delta' },
    ]);
    expect(createResponse).toHaveBeenCalledWith(
      {
        input: [{ content: 'Hello', role: 'user' }],
        model: 'test-model',
        reasoning: { effort: 'low', summary: 'concise' },
        tools: [{ type: 'web_search' }],
        store: false,
        stream: true,
      },
      { signal },
    );
  });

  it('emits a completed summary when no summary deltas are available', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    createResponse.mockResolvedValue(
      (async function* () {
        yield {
          summary_index: 0,
          text: 'A completed reasoning summary.',
          type: 'response.reasoning_summary_text.done',
        };
        yield { delta: 'Response text.', type: 'response.output_text.delta' };
      })(),
    );

    const result = await streamResponse(
      [{ content: 'Hello', role: 'user' }],
      'test-model',
      [],
      null,
      'auto',
    );
    const chunks = [];

    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: 'A completed reasoning summary.', type: 'reasoning_summary' },
      { content: 'Response text.', type: 'delta' },
    ]);
  });

  it('rejects an empty response', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    createResponse.mockResolvedValue({ output: [], output_text: '' });

    await expect(
      completeResponse(
        [{ content: 'Hello', role: 'user' }],
        'test-model',
        [],
        null,
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
