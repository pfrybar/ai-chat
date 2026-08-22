import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

function optionsResponse() {
  return new Response(
    JSON.stringify({
      defaultModel: 'default-model',
      models: ['default-model', 'alternate-model'],
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    },
  );
}

function chatResponse(
  content: string,
  reasoningSummary?: string,
  rawResponse?: unknown,
) {
  return new Response(
    JSON.stringify({
      message: { content, role: 'assistant' },
      ...(rawResponse !== undefined ? { rawResponse } : {}),
      ...(reasoningSummary ? { reasoningSummary } : {}),
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    },
  );
}

function streamResponse(...chunks: string[]) {
  const body = [
    ...chunks.map(
      (content) => `data: ${JSON.stringify({ content, type: 'delta' })}\n\n`,
    ),
    `data: ${JSON.stringify({ type: 'done' })}\n\n`,
  ].join('');

  return new Response(body, {
    headers: { 'Content-Type': 'text/event-stream' },
    status: 200,
  });
}

function reasoningSummaryStreamResponse(
  summary: string,
  content: string,
  rawResponse?: unknown,
) {
  return new Response(
    `data: ${JSON.stringify({ content: summary, type: 'reasoning_summary' })}\n\n` +
      `data: ${JSON.stringify({ content, type: 'delta' })}\n\n` +
      `data: ${JSON.stringify({ ...(rawResponse !== undefined ? { rawResponse } : {}), type: 'done' })}\n\n`,
    {
      headers: { 'Content-Type': 'text/event-stream' },
      status: 200,
    },
  );
}

function streamErrorResponse(content: string, error: string) {
  return new Response(
    `data: ${JSON.stringify({ content, type: 'delta' })}\n\n` +
      `data: ${JSON.stringify({ error, type: 'error' })}\n\n`,
    {
      headers: { 'Content-Type': 'text/event-stream' },
      status: 200,
    },
  );
}

function controlledStreamResponse() {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
      },
    }),
    {
      headers: { 'Content-Type': 'text/event-stream' },
      status: 200,
    },
  );

  return {
    close() {
      controller?.close();
    },
    response,
    send(event: object) {
      controller?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    },
  };
}

describe('App', () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
  });

  it('shows the chat interface with the default options', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(optionsResponse());

    render(<App />);

    expect(screen.getByText('OPENAI CHAT PLAYGROUND')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('Model')).toHaveValue('default-model'),
    );
    expect(screen.getByLabelText('API')).toHaveValue('chat');
    expect(
      screen.getByRole('complementary', { name: 'Options' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Web search')).toBeDisabled();
    expect(screen.getByLabelText('Reasoning effort')).toHaveValue('');
  });

  it('restores API, model, reasoning, and delivery options from the query parameters', async () => {
    window.history.replaceState(
      null,
      '',
      '/?api=responses&model=alternate-model&reasoning=high&summary=detailed&web_search=true&delivery=complete',
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(optionsResponse());

    render(<App />);

    await waitFor(() =>
      expect(screen.getByLabelText('Model')).toHaveValue('alternate-model'),
    );
    expect(screen.getByLabelText('API')).toHaveValue('responses');
    expect(screen.getByLabelText('Web search')).toBeChecked();
    expect(screen.getByLabelText('Reasoning effort')).toHaveValue('high');
    expect(screen.getByLabelText('Reasoning summary')).toHaveValue('detailed');
    expect(screen.getByLabelText('Response delivery')).toHaveValue('complete');
  });

  it('writes changed options to the query parameters', async () => {
    window.history.replaceState(null, '', '/?source=test');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(optionsResponse());

    render(<App />);
    await waitFor(() =>
      expect(screen.getByLabelText('Model')).toHaveValue('default-model'),
    );

    fireEvent.change(screen.getByLabelText('API'), {
      target: { value: 'responses' },
    });
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'alternate-model' },
    });
    fireEvent.click(screen.getByLabelText('Web search'));
    fireEvent.change(screen.getByLabelText('Reasoning effort'), {
      target: { value: 'xhigh' },
    });
    fireEvent.change(screen.getByLabelText('Reasoning summary'), {
      target: { value: 'concise' },
    });
    fireEvent.change(screen.getByLabelText('Response delivery'), {
      target: { value: 'complete' },
    });

    const query = new URLSearchParams(window.location.search);
    expect(query.get('api')).toBe('responses');
    expect(query.get('model')).toBe('alternate-model');
    expect(query.get('web_search')).toBe('true');
    expect(query.get('reasoning')).toBe('xhigh');
    expect(query.get('summary')).toBe('concise');
    expect(query.get('delivery')).toBe('complete');
    expect(query.get('source')).toBe('test');
  });

  it('limits reasoning efforts to those supported by the selected API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(optionsResponse());

    render(<App />);
    await waitFor(() =>
      expect(screen.getByLabelText('Model')).toHaveValue('default-model'),
    );

    expect(
      screen.queryByRole('option', { name: 'Minimal' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Max' }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('API'), {
      target: { value: 'responses' },
    });
    expect(screen.getByRole('option', { name: 'Minimal' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Max' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Reasoning effort'), {
      target: { value: 'max' },
    });
    fireEvent.change(screen.getByLabelText('API'), {
      target: { value: 'chat' },
    });

    expect(screen.getByLabelText('Reasoning effort')).toHaveValue('');
    expect(new URLSearchParams(window.location.search).has('reasoning')).toBe(
      false,
    );
  });

  it('changes models between turns while preserving conversation history', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(optionsResponse())
      .mockResolvedValueOnce(streamResponse('Hello! ', 'How can I help?'))
      .mockResolvedValueOnce(streamResponse('Here is a ', 'follow-up answer.'));

    render(<App />);
    await waitFor(() =>
      expect(screen.getByLabelText('Model')).toHaveValue('default-model'),
    );
    const input = screen.getByLabelText('Message');

    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.submit(input.closest('form')!);

    expect(
      await screen.findByText('Hello! How can I help?'),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith('/api/chat', {
      body: JSON.stringify({
        api: 'chat',
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'default-model',
        stream: true,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'alternate-model' },
    });
    fireEvent.change(input, { target: { value: 'Can you say more?' } });
    fireEvent.submit(input.closest('form')!);

    expect(
      await screen.findByText('Here is a follow-up answer.'),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/chat',
      expect.objectContaining({
        body: JSON.stringify({
          api: 'chat',
          messages: [
            { content: 'Hello', role: 'user' },
            { content: 'Hello! How can I help?', role: 'assistant' },
            { content: 'Can you say more?', role: 'user' },
          ],
          model: 'alternate-model',
          stream: true,
        }),
      }),
    );
  });

  it('streams responses from the Responses API', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(optionsResponse())
      .mockResolvedValueOnce(streamResponse('Responses ', 'API result.'));

    render(<App />);
    await waitFor(() =>
      expect(screen.getByLabelText('Model')).toHaveValue('default-model'),
    );
    fireEvent.change(screen.getByLabelText('API'), {
      target: { value: 'responses' },
    });
    fireEvent.change(screen.getByLabelText('Reasoning effort'), {
      target: { value: 'high' },
    });
    fireEvent.click(screen.getByLabelText('Web search'));
    const input = screen.getByLabelText('Message');

    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.submit(input.closest('form')!);

    expect(
      await screen.findByText('Responses API result.'),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/chat',
      expect.objectContaining({
        body: JSON.stringify({
          api: 'responses',
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'default-model',
          reasoningEffort: 'high',
          tools: ['web_search'],
          stream: true,
        }),
      }),
    );
  });

  it('shows a streamed Responses API reasoning summary', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(optionsResponse())
      .mockResolvedValueOnce(
        reasoningSummaryStreamResponse(
          'The model compared the options.',
          'A useful answer.',
          [{ type: 'response.completed' }],
        ),
      );

    render(<App />);
    await waitFor(() =>
      expect(screen.getByLabelText('Model')).toHaveValue('default-model'),
    );
    fireEvent.change(screen.getByLabelText('API'), {
      target: { value: 'responses' },
    });
    fireEvent.change(screen.getByLabelText('Reasoning summary'), {
      target: { value: 'concise' },
    });
    const input = screen.getByLabelText('Message');

    fireEvent.change(input, { target: { value: 'Compare the options.' } });
    fireEvent.submit(input.closest('form')!);

    expect(await screen.findByText('A useful answer.')).toBeInTheDocument();
    expect(
      screen.getByText('The model compared the options.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Reasoning summary', { selector: 'summary' }),
    ).toBeInTheDocument();
    const rawResponseButton = screen.getByLabelText('View raw response');
    fireEvent.click(rawResponseButton);
    expect(
      screen.getByRole('dialog', { name: 'Raw response' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/response\.completed/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close raw response'));
    expect(
      screen.queryByRole('dialog', { name: 'Raw response' }),
    ).not.toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/chat',
      expect.objectContaining({
        body: JSON.stringify({
          api: 'responses',
          messages: [{ content: 'Compare the options.', role: 'user' }],
          model: 'default-model',
          reasoningSummary: 'concise',
          stream: true,
        }),
      }),
    );
  });

  it('follows streaming text at the bottom and stops after the user scrolls up', async () => {
    const stream = controlledStreamResponse();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(optionsResponse())
      .mockResolvedValueOnce(stream.response);

    render(<App />);
    await waitFor(() =>
      expect(screen.getByLabelText('Model')).toHaveValue('default-model'),
    );
    const conversation = screen.getByLabelText('Conversation');
    let contentHeight = 1_000;
    Object.defineProperty(conversation, 'clientHeight', {
      configurable: true,
      value: 300,
    });
    Object.defineProperty(conversation, 'scrollHeight', {
      configurable: true,
      get: () => contentHeight,
    });
    const input = screen.getByLabelText('Message');

    fireEvent.change(input, { target: { value: 'Tell me something long.' } });
    fireEvent.submit(input.closest('form')!);
    await act(async () => {
      stream.send({ content: 'First chunk.', type: 'delta' });
    });
    expect(await screen.findByText('First chunk.')).toBeInTheDocument();
    expect(conversation.scrollTop).toBe(700);

    contentHeight = 1_040;
    await act(async () => {
      stream.send({ content: ' More text.', type: 'delta' });
    });
    expect(conversation.scrollTop).toBe(740);

    conversation.scrollTop = 720;
    fireEvent.wheel(conversation, { deltaY: -20 });
    fireEvent.scroll(conversation);
    contentHeight = 1_080;
    await act(async () => {
      stream.send({ content: ' Final text.', type: 'delta' });
    });

    expect(
      await screen.findByText('First chunk. More text. Final text.'),
    ).toBeInTheDocument();
    expect(conversation.scrollTop).toBe(720);

    await act(async () => {
      stream.send({ type: 'done' });
      stream.close();
    });
  });

  it('can request a complete response instead of a stream', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(optionsResponse())
      .mockResolvedValueOnce(
        chatResponse(
          'A complete response.',
          'The model weighed the tradeoffs.',
          { id: 'resp_complete', object: 'response' },
        ),
      );

    render(<App />);
    await waitFor(() =>
      expect(screen.getByLabelText('Model')).toHaveValue('default-model'),
    );
    fireEvent.change(screen.getByLabelText('API'), {
      target: { value: 'responses' },
    });
    fireEvent.change(screen.getByLabelText('Reasoning summary'), {
      target: { value: 'detailed' },
    });
    fireEvent.change(screen.getByLabelText('Response delivery'), {
      target: { value: 'complete' },
    });
    const input = screen.getByLabelText('Message');

    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.submit(input.closest('form')!);

    expect(await screen.findByText('A complete response.')).toBeInTheDocument();
    expect(
      screen.getByText('The model weighed the tradeoffs.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('View raw response'));
    expect(screen.getByText(/resp_complete/)).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/chat',
      expect.objectContaining({
        body: JSON.stringify({
          api: 'responses',
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'default-model',
          reasoningSummary: 'detailed',
          stream: false,
        }),
      }),
    );
  });

  it('excludes raw responses from later conversation history', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(optionsResponse())
      .mockResolvedValueOnce(
        chatResponse('First answer.', undefined, { id: 'resp_first' }),
      )
      .mockResolvedValueOnce(
        chatResponse('Second answer.', undefined, { id: 'resp_second' }),
      );

    render(<App />);
    await waitFor(() =>
      expect(screen.getByLabelText('Model')).toHaveValue('default-model'),
    );
    fireEvent.change(screen.getByLabelText('Response delivery'), {
      target: { value: 'complete' },
    });
    const input = screen.getByLabelText('Message');

    fireEvent.change(input, { target: { value: 'First message' } });
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByText('First answer.')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'Second message' } });
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByText('Second answer.')).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/chat',
      expect.objectContaining({
        body: JSON.stringify({
          api: 'chat',
          messages: [
            { content: 'First message', role: 'user' },
            { content: 'First answer.', role: 'assistant' },
            { content: 'Second message', role: 'user' },
          ],
          model: 'default-model',
          stream: false,
        }),
      }),
    );
  });

  it('shows an error received after streaming has started', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(optionsResponse())
      .mockResolvedValueOnce(
        streamErrorResponse('Partial response.', 'The stream stopped.'),
      );

    render(<App />);
    await waitFor(() =>
      expect(screen.getByLabelText('Model')).toHaveValue('default-model'),
    );
    const input = screen.getByLabelText('Message');

    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.submit(input.closest('form')!);

    expect(await screen.findByText('Partial response.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The stream stopped.',
      ),
    );
  });

  it('shows an API error and keeps the user message', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(optionsResponse())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'The model is unavailable.' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 502,
        }),
      );

    render(<App />);
    await waitFor(() =>
      expect(screen.getByLabelText('Model')).toHaveValue('default-model'),
    );
    const input = screen.getByLabelText('Message');

    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The model is unavailable.',
      ),
    );
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('reports an empty error response without exposing a JSON parser error', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(optionsResponse())
      .mockResolvedValueOnce(new Response(null, { status: 502 }));

    render(<App />);
    await waitFor(() =>
      expect(screen.getByLabelText('Model')).toHaveValue('default-model'),
    );
    const input = screen.getByLabelText('Message');

    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The API returned status 502.',
      ),
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('JSON.parse');
  });
});
