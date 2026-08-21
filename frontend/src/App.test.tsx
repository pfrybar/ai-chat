import {
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

describe('App', () => {
  afterEach(() => {
    cleanup();
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

  it('changes models between turns while preserving conversation history', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(optionsResponse())
      .mockResolvedValueOnce(chatResponse('Hello! How can I help?'))
      .mockResolvedValueOnce(chatResponse('Here is a follow-up answer.'));

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
        }),
      }),
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
