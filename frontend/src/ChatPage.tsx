import {
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ApiErrorResponse {
  error?: string;
  details?: string;
}

interface ChatResponse extends ApiErrorResponse {
  message?: {
    content?: string;
  };
}

interface ChatOptionsResponse extends ApiErrorResponse {
  defaultModel?: unknown;
  models?: unknown;
}

type ChatStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'done' }
  | { type: 'error'; error: string };

function formatApiError(error: string, details?: string) {
  return [error, details].filter(Boolean).join('\n\n');
}

function getInitialStreamingOption() {
  return (
    new URLSearchParams(window.location.search).get('delivery') !== 'complete'
  );
}

function setOptionQueryParameter(name: 'delivery' | 'model', value: string) {
  const url = new URL(window.location.href);
  url.searchParams.set(name, value);
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  );
}

async function readApiResponse<T extends object>(
  response: Response,
): Promise<Partial<T>> {
  const body = await response.text();

  if (!body.trim()) {
    return {};
  }

  try {
    const data: unknown = JSON.parse(body);

    if (typeof data === 'object' && data !== null) {
      return data as Partial<T>;
    }
  } catch {
    // Report a stable API error below instead of exposing a JSON parser error.
  }

  throw new Error(
    `The API returned status ${response.status} with an invalid JSON response.`,
  );
}

async function consumeChatStream(
  response: Response,
  onDelta: (content: string) => void,
) {
  if (!response.body) {
    throw new Error('The API did not provide a response stream.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamCompleted = false;

  function processFrame(frame: string) {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart())
      .join('\n');

    if (!data) {
      return;
    }

    let parsedEvent: unknown;

    try {
      parsedEvent = JSON.parse(data);
    } catch {
      throw new Error('The API returned an invalid streaming response.');
    }

    if (
      typeof parsedEvent !== 'object' ||
      parsedEvent === null ||
      !('type' in parsedEvent)
    ) {
      throw new Error('The API returned an invalid streaming event.');
    }

    const event = parsedEvent as ChatStreamEvent;

    if (event.type === 'delta' && typeof event.content === 'string') {
      onDelta(event.content);
    } else if (event.type === 'error' && typeof event.error === 'string') {
      throw new Error(event.error);
    } else if (event.type === 'done') {
      streamCompleted = true;
    } else {
      throw new Error('The API returned an invalid streaming event.');
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        processFrame(frame);
      }

      if (done) {
        break;
      }
    }

    if (buffer.trim()) {
      processFrame(buffer);
    }
  } finally {
    reader.releaseLock();
  }

  if (!streamCompleted) {
    throw new Error('The API ended the response before completing the stream.');
  }
}

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streaming, setStreaming] = useState(getInitialStreamingOption);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [isOptionsLoading, setIsOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadOptions() {
      try {
        const response = await fetch('/api/chat/options', {
          signal: abortController.signal,
        });
        const data = await readApiResponse<ChatOptionsResponse>(response);

        if (!response.ok) {
          throw new Error(
            formatApiError(
              data.error ?? `The API returned status ${response.status}.`,
              data.details,
            ),
          );
        }

        const availableModels = data.models;

        if (
          !Array.isArray(availableModels) ||
          availableModels.length === 0 ||
          !availableModels.every((model) => typeof model === 'string')
        ) {
          throw new Error('The API returned invalid chat options.');
        }

        const requestedModel = new URLSearchParams(window.location.search).get(
          'model',
        );
        const defaultModel =
          typeof data.defaultModel === 'string' &&
          availableModels.includes(data.defaultModel)
            ? data.defaultModel
            : availableModels[0];

        setModels(availableModels);
        setSelectedModel(
          requestedModel && availableModels.includes(requestedModel)
            ? requestedModel
            : defaultModel,
        );
      } catch (caughtError) {
        if (!abortController.signal.aborted) {
          setOptionsError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to load chat options.',
          );
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsOptionsLoading(false);
        }
      }
    }

    void loadOptions();

    return () => abortController.abort();
  }, []);

  useLayoutEffect(() => {
    const messageList = messageListRef.current;

    if (messageList && shouldAutoScrollRef.current) {
      messageList.scrollTop = Math.max(
        0,
        messageList.scrollHeight - messageList.clientHeight,
      );
    }
  }, [messages]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = draft.trim();

    if (!content || !selectedModel || isLoading) {
      return;
    }

    const nextMessages: ChatMessage[] = [
      ...messages,
      { content, role: 'user' },
    ];

    shouldAutoScrollRef.current = true;
    setMessages(nextMessages);
    setDraft('');
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        body: JSON.stringify({
          messages: nextMessages,
          model: selectedModel,
          stream: streaming,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      if (!response.ok) {
        const data = await readApiResponse<ChatResponse>(response);

        throw new Error(
          formatApiError(
            data.error ?? `The API returned status ${response.status}.`,
            data.details,
          ),
        );
      }

      if (streaming) {
        await consumeChatStream(response, appendAssistantDelta);
      } else {
        const data = await readApiResponse<ChatResponse>(response);
        const assistantContent = data.message?.content;

        if (!assistantContent) {
          throw new Error('The API returned an empty response.');
        }

        setMessages((currentMessages) => [
          ...currentMessages,
          { content: assistantContent, role: 'assistant' },
        ]);
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to contact the API.',
      );
    } finally {
      setIsLoading(false);
    }
  }

  function appendAssistantDelta(delta: string) {
    setMessages((currentMessages) => {
      const lastMessage = currentMessages[currentMessages.length - 1];

      if (lastMessage?.role === 'assistant') {
        return [
          ...currentMessages.slice(0, -1),
          { ...lastMessage, content: lastMessage.content + delta },
        ];
      }

      return [...currentMessages, { content: delta, role: 'assistant' }];
    });
  }

  function handleModelChange(model: string) {
    setSelectedModel(model);
    setOptionQueryParameter('model', model);
  }

  function handleDeliveryChange(delivery: 'complete' | 'stream') {
    setStreaming(delivery === 'stream');
    setOptionQueryParameter('delivery', delivery);
  }

  function handleConversationScroll() {
    const messageList = messageListRef.current;

    if (!messageList) {
      return;
    }

    const distanceFromBottom =
      messageList.scrollHeight -
      messageList.scrollTop -
      messageList.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom <= 2;
  }

  function handleConversationWheel(event: WheelEvent<HTMLDivElement>) {
    if (event.deltaY < 0) {
      shouldAutoScrollRef.current = false;
    }
  }

  function handleConversationPointerDown(event: PointerEvent<HTMLDivElement>) {
    const messageList = event.currentTarget;
    const bounds = messageList.getBoundingClientRect();
    const isUsingScrollbar =
      messageList.scrollHeight > messageList.clientHeight &&
      event.clientX >= bounds.right - 20;

    if (isUsingScrollbar) {
      shouldAutoScrollRef.current = false;
    }
  }

  function pauseAutoScroll() {
    shouldAutoScrollRef.current = false;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <main className="app-shell">
      <section className="chat-card" aria-labelledby="chat-title">
        <header className="chat-header">
          <div>
            <p className="eyebrow">OPENAI CHAT PLAYGROUND</p>
            <h1 id="chat-title">Chat with an LLM.</h1>
            <p className="chat-intro">
              Send a message using the Chat Completions API.
            </p>
          </div>
        </header>

        <section className="chat-options" aria-labelledby="options-title">
          <div className="chat-options-heading">
            <h2 id="options-title">Options</h2>
            <p>Changes apply to the next response.</p>
          </div>
          <label className="chat-option" htmlFor="chat-model">
            <span>Model</span>
            <select
              disabled={isLoading || isOptionsLoading || models.length === 0}
              id="chat-model"
              onChange={(event) => handleModelChange(event.target.value)}
              value={selectedModel}
            >
              {isOptionsLoading && <option value="">Loading models…</option>}
              {!isOptionsLoading && models.length === 0 && (
                <option value="">No models available</option>
              )}
              {models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
          <label className="chat-option" htmlFor="response-delivery">
            <span>Response delivery</span>
            <select
              disabled={isLoading}
              id="response-delivery"
              onChange={(event) =>
                handleDeliveryChange(
                  event.target.value as 'complete' | 'stream',
                )
              }
              value={streaming ? 'stream' : 'complete'}
            >
              <option value="stream">Streaming</option>
              <option value="complete">Complete</option>
            </select>
          </label>
          {optionsError && (
            <p className="options-error" role="alert">
              {optionsError}
            </p>
          )}
        </section>

        <div
          className="chat-messages"
          aria-label="Conversation"
          aria-live="polite"
          onPointerDown={handleConversationPointerDown}
          onScroll={handleConversationScroll}
          onTouchStart={pauseAutoScroll}
          onWheel={handleConversationWheel}
          ref={messageListRef}
        >
          {messages.length === 0 && !isLoading && (
            <div className="empty-chat">
              <span className="empty-chat-icon" aria-hidden="true">
                ✦
              </span>
              <p>Start a conversation</p>
              <span>
                Ask a question or share something you would like help with.
              </span>
            </div>
          )}

          {messages.map((message, index) => (
            <article
              className={`chat-message ${message.role}`}
              key={`${message.role}-${index}`}
            >
              <span className="message-role">
                {message.role === 'user' ? 'You' : 'Assistant'}
              </span>
              {message.role === 'assistant' ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </ReactMarkdown>
              ) : (
                <p>{message.content}</p>
              )}
            </article>
          ))}

          {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
            <article className="chat-message assistant" role="status">
              <span className="message-role">Assistant</span>
              <p className="thinking">Thinking…</p>
            </article>
          )}
        </div>

        <div className="composer-dock">
          {error && (
            <p className="chat-error" role="alert">
              {error}
            </p>
          )}

          <form className="chat-composer" onSubmit={sendMessage}>
            <label className="sr-only" htmlFor="chat-input">
              Message
            </label>
            <textarea
              disabled={isLoading || isOptionsLoading || !selectedModel}
              id="chat-input"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message the assistant…"
              rows={1}
              value={draft}
            />
            <button
              disabled={
                isLoading ||
                isOptionsLoading ||
                !selectedModel ||
                draft.trim().length === 0
              }
              type="submit"
            >
              {isLoading ? 'Sending…' : 'Send'}
            </button>
          </form>
          <p className="composer-hint">
            Enter to send · Shift + Enter for a new line
          </p>
        </div>
      </section>
    </main>
  );
}
