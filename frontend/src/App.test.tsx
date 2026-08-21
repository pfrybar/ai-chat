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

function chatResponse(content: string) {
  return new Response(
    JSON.stringify({
      message: { content, role: 'assistant' },
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

  it('shows the chat interface and selects the default model', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(optionsResponse());

    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Chat with an LLM.' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('Model')).toHaveValue('default-model'),
    );
  });

  it('restores model and delivery options from the query parameters', async () => {
    window.history.replaceState(
      null,
      '',
      '/?model=alternate-model&delivery=complete',
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(optionsResponse());

    render(<App />);

    await waitFor(() =>
      expect(screen.getByLabelText('Model')).toHaveValue('alternate-model'),
    );
    expect(screen.getByLabelText('Response delivery')).toHaveValue('complete');
  });

  it('writes changed options to the query parameters', async () => {
    window.history.replaceState(null, '', '/?source=test');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(optionsResponse());

    render(<App />);
    await waitFor(() =>
      expect(screen.getByLabelText('Model')).toHaveValue('default-model'),
    );

    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'alternate-model' },
    });
    fireEvent.change(screen.getByLabelText('Response delivery'), {
      target: { value: 'complete' },
    });

    const query = new URLSearchParams(window.location.search);
    expect(query.get('model')).toBe('alternate-model');
    expect(query.get('delivery')).toBe('complete');
    expect(query.get('source')).toBe('test');
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
      .mockResolvedValueOnce(chatResponse('A complete response.'));

    render(<App />);
    await waitFor(() =>
      expect(screen.getByLabelText('Model')).toHaveValue('default-model'),
    );
    fireEvent.change(screen.getByLabelText('Response delivery'), {
      target: { value: 'complete' },
    });
    const input = screen.getByLabelText('Message');

    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.submit(input.closest('form')!);

    expect(await screen.findByText('A complete response.')).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/chat',
      expect.objectContaining({
        body: JSON.stringify({
          messages: [{ content: 'Hello', role: 'user' }],
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
