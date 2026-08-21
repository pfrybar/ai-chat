import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  message?: {
    role?: string;
    content?: string;
  };
  error?: string;
  details?: string;
}

function formatApiError(error: string, details?: string) {
  return [error, details].filter(Boolean).join('\n\n');
}

async function readChatResponse(response: Response): Promise<ChatResponse> {
  const body = await response.text();

  if (!body.trim()) {
    return {};
  }

  try {
    const data: unknown = JSON.parse(body);

    if (typeof data === 'object' && data !== null) {
      return data as ChatResponse;
    }
  } catch {
    // Report a stable API error below instead of exposing a JSON parser error.
  }

  throw new Error(
    `The API returned status ${response.status} with an invalid JSON response.`,
  );
}

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const messageList = messageListRef.current;

    if (messageList) {
      messageList.scrollTop = messageList.scrollHeight;
    }
  }, [isLoading, messages]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = draft.trim();

    if (!content || isLoading) {
      return;
    }

    const nextMessages: ChatMessage[] = [
      ...messages,
      { content, role: 'user' },
    ];

    setMessages(nextMessages);
    setDraft('');
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        body: JSON.stringify({ messages: nextMessages }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const data = await readChatResponse(response);

      if (!response.ok) {
        throw new Error(
          formatApiError(
            data.error ?? `The API returned status ${response.status}.`,
            data.details,
          ),
        );
      }

      const assistantContent = data.message?.content;

      if (!assistantContent) {
        throw new Error('The API returned an empty response.');
      }

      setMessages((currentMessages) => [
        ...currentMessages,
        { content: assistantContent, role: 'assistant' },
      ]);
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
          <span className="api-badge">Complete response</span>
        </header>

        <div
          className="chat-messages"
          aria-label="Conversation"
          aria-live="polite"
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

          {isLoading && (
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
              disabled={isLoading}
              id="chat-input"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message the assistant…"
              rows={1}
              value={draft}
            />
            <button
              disabled={isLoading || draft.trim().length === 0}
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
