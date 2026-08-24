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
          action: {
            queries: ['current facts about the topic'],
            sources: [{ type: 'url', url: 'https://example.com/source' }],
            type: 'search',
          },
          id: 'ws_test',
          status: 'completed',
          type: 'web_search_call',
        },
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
        {
          imageCaptions: true,
          imageMaxResults: 3,
          returnTokenBudget: 'unlimited',
          searchContextSize: 'low',
          searchContentTypes: ['image', 'text'],
        },
      ),
    ).resolves.toEqual({
      content: 'Hello from the Responses API.',
      rawResponse: {
        output: [
          {
            action: {
              queries: ['current facts about the topic'],
              sources: [{ type: 'url', url: 'https://example.com/source' }],
              type: 'search',
            },
            id: 'ws_test',
            status: 'completed',
            type: 'web_search_call',
          },
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
      },
      reasoningSummary: 'The model considered the relevant facts.',
      webSearchUpdates: [
        {
          action: {
            queries: ['current facts about the topic'],
            sources: [{ url: 'https://example.com/source' }],
            type: 'search',
          },
          itemId: 'ws_test',
          status: 'completed',
        },
      ],
    });
    expect(createResponse).toHaveBeenCalledWith({
      include: ['web_search_call.action.sources', 'web_search_call.results'],
      input: [{ content: 'Hello', role: 'user' }],
      model: 'test-model',
      reasoning: { effort: 'high', summary: 'detailed' },
      tools: [
        {
          image_settings: { caption: true, max_results: 3 },
          return_token_budget: 'unlimited',
          search_content_types: ['image', 'text'],
          search_context_size: 'low',
          type: 'web_search',
        },
      ],
      store: false,
    });
  });

  it('streams response text and reasoning summary deltas', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const signal = new AbortController().signal;
    createResponse.mockResolvedValue(
      (async function* () {
        yield {
          item: {
            id: 'ws_test',
            status: 'in_progress',
            type: 'web_search_call',
          },
          output_index: 0,
          sequence_number: 0,
          type: 'response.output_item.added',
        };
        yield {
          item_id: 'ws_test',
          output_index: 0,
          sequence_number: 1,
          type: 'response.web_search_call.searching',
        };
        yield {
          item: {
            action: {
              queries: ['current facts about the topic'],
              sources: [{ type: 'url', url: 'https://example.com/source' }],
              type: 'search',
            },
            id: 'ws_test',
            status: 'completed',
            type: 'web_search_call',
          },
          output_index: 0,
          sequence_number: 2,
          type: 'response.output_item.done',
        };
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
      {
        imageCaptions: true,
        imageMaxResults: 3,
        returnTokenBudget: 'unlimited',
        searchContextSize: 'high',
        searchContentTypes: ['image'],
      },
    );
    const chunks = [];

    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      {
        type: 'web_search',
        update: {
          itemId: 'ws_test',
          status: 'in_progress',
        },
      },
      {
        type: 'web_search',
        update: {
          itemId: 'ws_test',
          status: 'searching',
        },
      },
      {
        type: 'web_search',
        update: {
          action: {
            queries: ['current facts about the topic'],
            sources: [{ url: 'https://example.com/source' }],
            type: 'search',
          },
          itemId: 'ws_test',
          status: 'completed',
        },
      },
      { content: 'The model considered ', type: 'reasoning_summary' },
      { content: 'the relevant facts.', type: 'reasoning_summary' },
      { content: 'Hello ', type: 'delta' },
      { content: 'as it arrives.', type: 'delta' },
    ]);
    expect(result.getRawResponse?.()).toEqual([
      {
        item: {
          id: 'ws_test',
          status: 'in_progress',
          type: 'web_search_call',
        },
        output_index: 0,
        sequence_number: 0,
        type: 'response.output_item.added',
      },
      {
        item_id: 'ws_test',
        output_index: 0,
        sequence_number: 1,
        type: 'response.web_search_call.searching',
      },
      {
        item: {
          action: {
            queries: ['current facts about the topic'],
            sources: [{ type: 'url', url: 'https://example.com/source' }],
            type: 'search',
          },
          id: 'ws_test',
          status: 'completed',
          type: 'web_search_call',
        },
        output_index: 0,
        sequence_number: 2,
        type: 'response.output_item.done',
      },
      {
        delta: 'The model considered ',
        summary_index: 0,
        type: 'response.reasoning_summary_text.delta',
      },
      {
        delta: 'the relevant facts.',
        summary_index: 0,
        type: 'response.reasoning_summary_text.delta',
      },
      { delta: 'Hello ', type: 'response.output_text.delta' },
      { delta: 'as it arrives.', type: 'response.output_text.delta' },
    ]);
    expect(createResponse).toHaveBeenCalledWith(
      {
        input: [{ content: 'Hello', role: 'user' }],
        model: 'test-model',
        reasoning: { effort: 'low', summary: 'concise' },
        include: ['web_search_call.action.sources', 'web_search_call.results'],
        tools: [
          {
            image_settings: { caption: true, max_results: 3 },
            return_token_budget: 'unlimited',
            search_content_types: ['image'],
            search_context_size: 'high',
            type: 'web_search',
          },
        ],
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
