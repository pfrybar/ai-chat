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

type ChatApi = 'chat' | 'responses';
type ReasoningSummary = 'auto' | 'concise' | 'detailed';
type ChatTool = 'web_search';
type WebSearchContextSize = 'low' | 'medium' | 'high';
type WebSearchReturnTokenBudget = 'unlimited';
type WebSearchStatus = 'in_progress' | 'searching' | 'completed' | 'failed';

interface WebSearchSource {
  title?: string;
  url: string;
}

type WebSearchAction =
  | {
      type: 'search';
      queries?: string[];
      query?: string;
      sources?: WebSearchSource[];
    }
  | { type: 'open_page'; url?: string | null }
  | { type: 'find_in_page'; pattern: string; url: string };

interface WebSearchUpdate {
  action?: WebSearchAction;
  itemId: string;
  status: WebSearchStatus;
}

type ReasoningEffort =
  'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const reasoningEfforts = new Set<ReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);
const chatReasoningEfforts = new Set<ReasoningEffort>([
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
]);

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  rawResponse?: unknown;
}

interface ChatReasoningSummary {
  role: 'reasoning-summary';
  content: string;
}

interface ChatWebSearch {
  role: 'web-search';
  updates: WebSearchUpdate[];
}

type ChatItem = ChatMessage | ChatReasoningSummary | ChatWebSearch;
type ChatTraceItem = ChatReasoningSummary | ChatWebSearch;

interface ChatTraceGroup {
  role: 'trace';
  items: ChatTraceItem[];
  startIndex: number;
}

type RenderChatItem = ChatMessage | ChatTraceGroup;

interface ApiErrorResponse {
  error?: string;
  details?: string;
}

interface ChatResponse extends ApiErrorResponse {
  message?: {
    content?: string;
  };
  rawResponse?: unknown;
  reasoningSummary?: string;
  webSearchUpdates?: unknown;
}

interface ChatOptionsResponse extends ApiErrorResponse {
  defaultModel?: unknown;
  models?: unknown;
}

type ChatStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'reasoning_summary'; content: string }
  | { type: 'web_search'; update: unknown }
  | { type: 'done'; rawResponse?: unknown }
  | { type: 'error'; error: string };

function formatApiError(error: string, details?: string) {
  return [error, details].filter(Boolean).join('\n\n');
}

function formatRawResponse(rawResponse: unknown) {
  try {
    return JSON.stringify(rawResponse, null, 2);
  } catch {
    return String(rawResponse);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isWebSearchSource(value: unknown): value is WebSearchSource {
  return (
    isRecord(value) &&
    typeof value.url === 'string' &&
    (value.title === undefined || typeof value.title === 'string')
  );
}

function isWebSearchAction(value: unknown): value is WebSearchAction {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }

  if (value.type === 'search') {
    return (
      (value.queries === undefined ||
        (Array.isArray(value.queries) &&
          value.queries.every((query) => typeof query === 'string'))) &&
      (value.query === undefined || typeof value.query === 'string') &&
      (value.sources === undefined ||
        (Array.isArray(value.sources) &&
          value.sources.every(isWebSearchSource)))
    );
  }

  if (value.type === 'open_page') {
    return (
      value.url === undefined ||
      value.url === null ||
      typeof value.url === 'string'
    );
  }

  return (
    value.type === 'find_in_page' &&
    typeof value.pattern === 'string' &&
    typeof value.url === 'string'
  );
}

function isWebSearchUpdate(value: unknown): value is WebSearchUpdate {
  return (
    isRecord(value) &&
    typeof value.itemId === 'string' &&
    (value.status === 'in_progress' ||
      value.status === 'searching' ||
      value.status === 'completed' ||
      value.status === 'failed') &&
    (value.action === undefined || isWebSearchAction(value.action))
  );
}

function getWebSearchUpdates(value: unknown): WebSearchUpdate[] {
  return Array.isArray(value) ? value.filter(isWebSearchUpdate) : [];
}

function getWebSearchStatusLabel(status: WebSearchStatus) {
  switch (status) {
    case 'in_progress':
      return 'Starting';
    case 'searching':
      return 'Searching';
    case 'completed':
      return 'Complete';
    case 'failed':
      return 'Failed';
  }
}

function getWebSearchOverallStatus(updates: WebSearchUpdate[]) {
  if (updates.some(({ status }) => status === 'searching')) {
    return 'Searching…';
  }

  if (updates.some(({ status }) => status === 'in_progress')) {
    return 'Starting…';
  }

  if (updates.some(({ status }) => status === 'failed')) {
    return 'Search failed';
  }

  return 'Complete';
}

function isChatTraceItem(item: ChatItem | undefined): item is ChatTraceItem {
  return item?.role === 'reasoning-summary' || item?.role === 'web-search';
}

function groupChatItems(items: ChatItem[]): RenderChatItem[] {
  const groupedItems: RenderChatItem[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];

    if (!isChatTraceItem(item)) {
      groupedItems.push(item);
      continue;
    }

    const traceItems: ChatTraceItem[] = [item];
    let nextIndex = index + 1;

    while (nextIndex < items.length) {
      const nextItem = items[nextIndex];

      if (!isChatTraceItem(nextItem)) {
        break;
      }

      traceItems.push(nextItem);
      nextIndex += 1;
    }

    groupedItems.push({
      items: traceItems,
      role: 'trace',
      startIndex: index,
    });
    index = nextIndex - 1;
  }

  return groupedItems;
}

function getTraceSummary(items: ChatTraceItem[]) {
  const searchCount = items.filter((item) => item.role === 'web-search').length;
  const stepLabel = `${items.length} ${items.length === 1 ? 'step' : 'steps'}`;
  const searchLabel = `${searchCount} ${searchCount === 1 ? 'search' : 'searches'}`;

  return searchCount > 0 ? `${stepLabel} · ${searchLabel}` : stepLabel;
}

function getTraceOverallStatus(items: ChatTraceItem[]) {
  const updates = items.flatMap((item) =>
    item.role === 'web-search' ? item.updates : [],
  );

  return updates.length > 0 ? getWebSearchOverallStatus(updates) : 'Complete';
}

function getLastUserIndex(items: ChatItem[]) {
  return items.reduce(
    (lastIndex, item, index) => (item.role === 'user' ? index : lastIndex),
    -1,
  );
}

function getWebSearchActionDescription(action?: WebSearchAction) {
  if (!action) {
    return 'Working with the web…';
  }

  if (action.type === 'search') {
    const queries = action.queries?.length
      ? action.queries
      : action.query
        ? [action.query]
        : [];

    return queries.length > 0
      ? `Searched for ${queries.map((query) => `“${query}”`).join(', ')}`
      : 'Searched the web';
  }

  if (action.type === 'open_page') {
    return action.url ? `Opened ${action.url}` : 'Opened a search result';
  }

  return `Looked for “${action.pattern}” in ${action.url}`;
}

function getWebSearchSourceLabel(source: WebSearchSource) {
  if (source.title) {
    return source.title;
  }

  try {
    return new URL(source.url).hostname.replace(/^www\\./, '');
  } catch {
    return source.url;
  }
}

interface TokenUsage {
  inputTokens: number;
  inputCachedTokens: number;
  inputCacheWriteTokens: number;
  outputTokens: number;
  outputReasoningTokens: number;
}

function getUsageRecord(rawResponse: unknown): Record<string, unknown> | null {
  if (Array.isArray(rawResponse)) {
    for (let index = rawResponse.length - 1; index >= 0; index -= 1) {
      const event = rawResponse[index];

      if (
        isRecord(event) &&
        event.type === 'response.completed' &&
        isRecord(event.response) &&
        isRecord(event.response.usage)
      ) {
        return event.response.usage;
      }

      if (isRecord(event) && isRecord(event.usage)) {
        return event.usage;
      }
    }

    return null;
  }

  if (isRecord(rawResponse) && isRecord(rawResponse.usage)) {
    return rawResponse.usage;
  }

  return null;
}

function getTokenUsage(rawResponse: unknown): TokenUsage | null {
  const usage = getUsageRecord(rawResponse);
  const inputTokens = usage?.input_tokens ?? usage?.prompt_tokens;
  const outputTokens = usage?.output_tokens ?? usage?.completion_tokens;
  const inputDetails = isRecord(usage?.input_tokens_details)
    ? usage.input_tokens_details
    : isRecord(usage?.prompt_tokens_details)
      ? usage.prompt_tokens_details
      : null;
  const outputDetails = isRecord(usage?.output_tokens_details)
    ? usage.output_tokens_details
    : isRecord(usage?.completion_tokens_details)
      ? usage.completion_tokens_details
      : null;
  const inputCachedTokens = inputDetails?.cached_tokens ?? usage?.cached_tokens;
  const inputCacheWriteTokens =
    inputDetails?.cache_write_tokens ?? usage?.cache_write_tokens;
  const outputReasoningTokens =
    outputDetails?.reasoning_tokens ?? usage?.reasoning_tokens;

  return typeof inputTokens === 'number' && typeof outputTokens === 'number'
    ? {
        inputTokens,
        inputCachedTokens:
          typeof inputCachedTokens === 'number' ? inputCachedTokens : 0,
        inputCacheWriteTokens:
          typeof inputCacheWriteTokens === 'number' ? inputCacheWriteTokens : 0,
        outputTokens,
        outputReasoningTokens:
          typeof outputReasoningTokens === 'number' ? outputReasoningTokens : 0,
      }
    : null;
}

function isChatMessage(item: ChatItem): item is ChatMessage {
  return item.role === 'user' || item.role === 'assistant';
}

function TraceItemView({ item }: { item: ChatTraceItem }) {
  if (item.role === 'reasoning-summary') {
    return (
      <details className="chat-reasoning-summary" open>
        <summary>Reasoning summary</summary>
        <div className="chat-reasoning-summary-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {item.content}
          </ReactMarkdown>
        </div>
      </details>
    );
  }

  return (
    <details aria-label="Web search activity" className="chat-web-search" open>
      <summary className="chat-web-search-summary">
        <span className="chat-web-search-title">Web search</span>
        <span className="chat-web-search-overall-status">
          {getWebSearchOverallStatus(item.updates)}
        </span>
      </summary>
      <ul className="chat-web-search-events">
        {item.updates.map((update) => {
          const sources =
            update.action?.type === 'search'
              ? (update.action.sources ?? [])
              : [];

          return (
            <li key={update.itemId}>
              <div className="chat-web-search-event-header">
                <span className={`chat-web-search-status ${update.status}`}>
                  {getWebSearchStatusLabel(update.status)}
                </span>
                <span>{getWebSearchActionDescription(update.action)}</span>
              </div>
              {sources.length > 0 && (
                <ul className="chat-web-search-sources">
                  {sources.map((source) => (
                    <li key={source.url}>
                      <a href={source.url} rel="noreferrer" target="_blank">
                        {getWebSearchSourceLabel(source)}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function getInitialApiOption(): ChatApi {
  return new URLSearchParams(window.location.search).get('api') === 'responses'
    ? 'responses'
    : 'chat';
}

function getInitialReasoningEffort(): ReasoningEffort | null {
  const reasoningEffort = new URLSearchParams(window.location.search).get(
    'reasoning',
  );

  if (!reasoningEfforts.has(reasoningEffort as ReasoningEffort)) {
    return null;
  }

  const selectedEffort = reasoningEffort as ReasoningEffort;

  return getInitialApiOption() === 'responses' ||
    chatReasoningEfforts.has(selectedEffort)
    ? selectedEffort
    : null;
}

function getInitialReasoningSummary(): ReasoningSummary | null {
  const summary = new URLSearchParams(window.location.search).get('summary');

  return getInitialApiOption() === 'responses' &&
    (summary === 'auto' || summary === 'concise' || summary === 'detailed')
    ? summary
    : null;
}

function getInitialWebSearchOption() {
  const parameters = new URLSearchParams(window.location.search);

  return (
    getInitialApiOption() === 'responses' &&
    parameters.get('web_search') === 'true'
  );
}

function getInitialWebSearchContextSize(): WebSearchContextSize | null {
  const value = new URLSearchParams(window.location.search).get(
    'search_context_size',
  );

  return value === 'low' || value === 'medium' || value === 'high'
    ? value
    : null;
}

function getInitialWebSearchReturnTokenBudget(): WebSearchReturnTokenBudget | null {
  return new URLSearchParams(window.location.search).get(
    'return_token_budget',
  ) === 'unlimited'
    ? 'unlimited'
    : null;
}

function getInitialStreamingOption() {
  return (
    new URLSearchParams(window.location.search).get('delivery') !== 'complete'
  );
}

function setOptionQueryParameter(
  name:
    | 'api'
    | 'delivery'
    | 'model'
    | 'reasoning'
    | 'return_token_budget'
    | 'search_context_size'
    | 'summary'
    | 'web_search',
  value: string | null,
) {
  const url = new URL(window.location.href);

  if (value === null) {
    url.searchParams.delete(name);
  } else {
    url.searchParams.set(name, value);
  }
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
  onReasoningSummary: (content: string) => void,
  onWebSearch: (update: WebSearchUpdate) => void,
  onComplete: (rawResponse: unknown | undefined) => void,
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
    } else if (
      event.type === 'reasoning_summary' &&
      typeof event.content === 'string'
    ) {
      onReasoningSummary(event.content);
    } else if (event.type === 'web_search' && isWebSearchUpdate(event.update)) {
      onWebSearch(event.update);
    } else if (event.type === 'error' && typeof event.error === 'string') {
      throw new Error(event.error);
    } else if (event.type === 'done') {
      onComplete(event.rawResponse);
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
  const [api, setApi] = useState<ChatApi>(getInitialApiOption);
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffort | null>(getInitialReasoningEffort);
  const [reasoningSummary, setReasoningSummary] =
    useState<ReasoningSummary | null>(getInitialReasoningSummary);
  const [selectedTools, setSelectedTools] = useState<ChatTool[]>(() =>
    getInitialWebSearchOption() ? ['web_search'] : [],
  );
  const [webSearchContextSize, setWebSearchContextSize] =
    useState<WebSearchContextSize | null>(getInitialWebSearchContextSize);
  const [webSearchReturnTokenBudget, setWebSearchReturnTokenBudget] =
    useState<WebSearchReturnTokenBudget | null>(
      getInitialWebSearchReturnTokenBudget,
    );
  const [streaming, setStreaming] = useState(getInitialStreamingOption);
  const [error, setError] = useState<string | null>(null);
  const [rawResponseModal, setRawResponseModal] = useState<{
    content: unknown;
  } | null>(null);
  const [tokenUsageModal, setTokenUsageModal] = useState<{
    usage: TokenUsage;
  } | null>(null);
  const [expandedTraces, setExpandedTraces] = useState<Record<string, boolean>>(
    {},
  );
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

  useEffect(() => {
    if (!rawResponseModal && !tokenUsageModal) {
      return;
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setRawResponseModal(null);
        setTokenUsageModal(null);
      }
    }

    window.addEventListener('keydown', closeOnEscape);

    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [rawResponseModal, tokenUsageModal]);

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

    const userMessage: ChatMessage = { content, role: 'user' };
    const nextMessages: ChatMessage[] = [
      ...messages
        .filter(isChatMessage)
        .map(({ content: messageContent, role }) => ({
          content: messageContent,
          role,
        })),
      userMessage,
    ];

    shouldAutoScrollRef.current = true;
    setMessages((currentMessages) => [...currentMessages, userMessage]);
    setDraft('');
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        body: JSON.stringify({
          api,
          messages: nextMessages,
          model: selectedModel,
          ...(reasoningEffort ? { reasoningEffort } : {}),
          ...(api === 'responses' && reasoningSummary
            ? { reasoningSummary }
            : {}),
          ...(api === 'responses' && selectedTools.length > 0
            ? { tools: selectedTools }
            : {}),
          ...(api === 'responses' && selectedTools.includes('web_search')
            ? {
                ...(webSearchContextSize
                  ? { searchContextSize: webSearchContextSize }
                  : {}),
                ...(webSearchReturnTokenBudget
                  ? { returnTokenBudget: webSearchReturnTokenBudget }
                  : {}),
              }
            : {}),
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
        await consumeChatStream(
          response,
          appendAssistantDelta,
          appendReasoningSummary,
          appendWebSearchUpdate,
          attachRawResponse,
        );
      } else {
        const data = await readApiResponse<ChatResponse>(response);
        const assistantContent = data.message?.content;

        if (!assistantContent) {
          throw new Error('The API returned an empty response.');
        }

        const webSearchUpdates = getWebSearchUpdates(data.webSearchUpdates);

        setMessages((currentMessages) => [
          ...currentMessages,
          ...(webSearchUpdates.length > 0
            ? [{ role: 'web-search' as const, updates: webSearchUpdates }]
            : []),
          ...(data.reasoningSummary
            ? [
                {
                  content: data.reasoningSummary,
                  role: 'reasoning-summary' as const,
                },
              ]
            : []),
          {
            content: assistantContent,
            ...(data.rawResponse !== undefined
              ? { rawResponse: data.rawResponse }
              : {}),
            role: 'assistant',
          },
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

  function appendWebSearchUpdate(update: WebSearchUpdate) {
    setMessages((currentMessages) => {
      let lastUserIndex = -1;

      for (let index = currentMessages.length - 1; index >= 0; index -= 1) {
        if (currentMessages[index].role === 'user') {
          lastUserIndex = index;
          break;
        }
      }

      const webSearchIndex = currentMessages.length - 1;
      const webSearchMessage = currentMessages[webSearchIndex];

      if (
        webSearchIndex <= lastUserIndex ||
        webSearchMessage?.role !== 'web-search'
      ) {
        return [...currentMessages, { role: 'web-search', updates: [update] }];
      }

      const updateIndex = webSearchMessage.updates.findIndex(
        ({ itemId }) => itemId === update.itemId,
      );
      const updates = [...webSearchMessage.updates];

      if (updateIndex === -1) {
        updates.push(update);
      } else {
        updates[updateIndex] = {
          ...updates[updateIndex],
          status: update.status,
          ...(update.action ? { action: update.action } : {}),
        };
      }

      return [
        ...currentMessages.slice(0, webSearchIndex),
        { ...webSearchMessage, updates },
        ...currentMessages.slice(webSearchIndex + 1),
      ];
    });
  }

  function attachRawResponse(rawResponse: unknown | undefined) {
    if (rawResponse === undefined) {
      return;
    }

    setMessages((currentMessages) => {
      let assistantIndex = -1;

      for (let index = currentMessages.length - 1; index >= 0; index -= 1) {
        if (currentMessages[index].role === 'assistant') {
          assistantIndex = index;
          break;
        }
      }

      if (assistantIndex === -1) {
        return currentMessages;
      }

      const assistantMessage = currentMessages[assistantIndex];

      return [
        ...currentMessages.slice(0, assistantIndex),
        { ...assistantMessage, rawResponse },
        ...currentMessages.slice(assistantIndex + 1),
      ];
    });
  }

  function appendReasoningSummary(content: string) {
    setMessages((currentMessages) => {
      const lastMessage = currentMessages[currentMessages.length - 1];

      if (lastMessage?.role === 'reasoning-summary') {
        return [
          ...currentMessages.slice(0, -1),
          { ...lastMessage, content: lastMessage.content + content },
        ];
      }

      return [...currentMessages, { content, role: 'reasoning-summary' }];
    });
  }

  function handleApiChange(nextApi: ChatApi) {
    setApi(nextApi);
    setOptionQueryParameter('api', nextApi);

    if (nextApi === 'chat') {
      if (
        reasoningEffort !== null &&
        !chatReasoningEfforts.has(reasoningEffort)
      ) {
        handleReasoningEffortChange(null);
      }

      if (reasoningSummary !== null) {
        handleReasoningSummaryChange(null);
      }

      handleWebSearchChange(false);
    }
  }

  function handleModelChange(model: string) {
    setSelectedModel(model);
    setOptionQueryParameter('model', model);
  }

  function handleReasoningEffortChange(
    nextReasoningEffort: ReasoningEffort | null,
  ) {
    setReasoningEffort(nextReasoningEffort);
    setOptionQueryParameter('reasoning', nextReasoningEffort);
  }

  function handleReasoningSummaryChange(nextSummary: ReasoningSummary | null) {
    setReasoningSummary(nextSummary);
    setOptionQueryParameter('summary', nextSummary);
  }

  function handleWebSearchChange(enabled: boolean) {
    setSelectedTools(enabled ? ['web_search'] : []);
    setOptionQueryParameter('web_search', enabled ? 'true' : null);

    if (!enabled) {
      handleWebSearchContextSizeChange(null);
      handleWebSearchReturnTokenBudgetChange(null);
    }
  }

  function handleWebSearchContextSizeChange(
    nextSize: WebSearchContextSize | null,
  ) {
    setWebSearchContextSize(nextSize);
    setOptionQueryParameter('search_context_size', nextSize);
  }

  function handleWebSearchReturnTokenBudgetChange(
    nextBudget: WebSearchReturnTokenBudget | null,
  ) {
    setWebSearchReturnTokenBudget(nextBudget);
    setOptionQueryParameter('return_token_budget', nextBudget);
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

  const renderedChatItems = groupChatItems(messages);
  const lastUserIndex = getLastUserIndex(messages);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    const activeTrace = groupChatItems(messages).find(
      (item) =>
        item.role === 'trace' && item.startIndex > getLastUserIndex(messages),
    );

    if (!activeTrace || activeTrace.role !== 'trace') {
      return;
    }

    const traceId = `trace-${activeTrace.startIndex}`;

    setExpandedTraces((currentTraces) => {
      if (currentTraces[traceId] === false) {
        return currentTraces;
      }

      return { ...currentTraces, [traceId]: false };
    });
  }, [isLoading, messages]);

  return (
    <main className="app-shell">
      <section className="chat-card" aria-labelledby="chat-title">
        <header className="chat-header">
          <p className="eyebrow" id="chat-title">
            OPENAI CHAT PLAYGROUND
          </p>
        </header>

        <div className="chat-layout">
          <aside className="chat-sidebar" aria-labelledby="options-title">
            <div className="chat-options-heading">
              <h2 id="options-title">Options</h2>
              <p>Changes apply to the next response.</p>
            </div>
            <section className="chat-options">
              <label className="chat-option" htmlFor="chat-model">
                <span>Model</span>
                <select
                  disabled={
                    isLoading || isOptionsLoading || models.length === 0
                  }
                  id="chat-model"
                  onChange={(event) => handleModelChange(event.target.value)}
                  value={selectedModel}
                >
                  {isOptionsLoading && (
                    <option value="">Loading models…</option>
                  )}
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
              <label className="chat-option" htmlFor="chat-api">
                <span>API</span>
                <select
                  disabled={isLoading}
                  id="chat-api"
                  onChange={(event) =>
                    handleApiChange(event.target.value as ChatApi)
                  }
                  value={api}
                >
                  <option value="chat">Chat Completions</option>
                  <option value="responses">Responses</option>
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
              <label className="chat-option" htmlFor="reasoning-effort">
                <span>Reasoning effort</span>
                <select
                  disabled={isLoading}
                  id="reasoning-effort"
                  onChange={(event) =>
                    handleReasoningEffortChange(
                      event.target.value
                        ? (event.target.value as ReasoningEffort)
                        : null,
                    )
                  }
                  value={reasoningEffort ?? ''}
                >
                  <option value="">Default</option>
                  <option value="none">None</option>
                  {api === 'responses' && (
                    <option value="minimal">Minimal</option>
                  )}
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="xhigh">Xhigh</option>
                  {api === 'responses' && <option value="max">Max</option>}
                </select>
              </label>
              {api === 'responses' && (
                <label className="chat-option" htmlFor="reasoning-summary">
                  <span>Reasoning summary</span>
                  <select
                    disabled={isLoading}
                    id="reasoning-summary"
                    onChange={(event) =>
                      handleReasoningSummaryChange(
                        event.target.value
                          ? (event.target.value as ReasoningSummary)
                          : null,
                      )
                    }
                    value={reasoningSummary ?? ''}
                  >
                    <option value="">Default</option>
                    <option value="auto">Auto</option>
                    <option value="concise">Concise</option>
                    <option value="detailed">Detailed</option>
                  </select>
                </label>
              )}
              {optionsError && (
                <p className="options-error" role="alert">
                  {optionsError}
                </p>
              )}
            </section>

            <fieldset className="chat-tools">
              <legend>Tools</legend>
              <label
                className={`chat-tool${api === 'chat' ? ' disabled' : ''}`}
              >
                <input
                  aria-label="Web search"
                  checked={
                    api === 'responses' && selectedTools.includes('web_search')
                  }
                  disabled={isLoading || api === 'chat'}
                  onChange={(event) =>
                    handleWebSearchChange(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>
                  <strong>Web search</strong>
                  <small>
                    {api === 'chat'
                      ? 'Unavailable with Chat Completions. Switch to Responses to enable.'
                      : 'Give the model access to current information from the web.'}
                  </small>
                </span>
              </label>
              {api === 'responses' && selectedTools.includes('web_search') && (
                <div className="chat-web-search-options">
                  <label className="chat-option" htmlFor="search-context-size">
                    <span>Search context size</span>
                    <select
                      aria-label="Search context size"
                      disabled={isLoading}
                      id="search-context-size"
                      onChange={(event) =>
                        handleWebSearchContextSizeChange(
                          event.target.value
                            ? (event.target.value as WebSearchContextSize)
                            : null,
                        )
                      }
                      value={webSearchContextSize ?? ''}
                    >
                      <option value="">Default (medium)</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                    <small>
                      Low for simple lookups, medium for a balanced default, or
                      high for answers needing more search detail.
                    </small>
                  </label>
                  <label className="chat-option" htmlFor="return-token-budget">
                    <span>Return token budget</span>
                    <select
                      aria-label="Return token budget"
                      disabled={isLoading}
                      id="return-token-budget"
                      onChange={(event) =>
                        handleWebSearchReturnTokenBudgetChange(
                          event.target.value
                            ? (event.target.value as WebSearchReturnTokenBudget)
                            : null,
                        )
                      }
                      value={webSearchReturnTokenBudget ?? ''}
                    >
                      <option value="">Default</option>
                      <option value="unlimited">Unlimited</option>
                    </select>
                    <small>
                      Use Unlimited only for high-effort research or evaluation
                      runs on GPT-5+ reasoning models.
                    </small>
                  </label>
                </div>
              )}
            </fieldset>
          </aside>

          <section className="chat-main" aria-label="Chat">
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

              {renderedChatItems.map((message, index) =>
                message.role === 'trace' ? (
                  <details
                    aria-label="Reasoning and web search trace"
                    className="chat-trace"
                    key={`trace-${message.startIndex}`}
                    onToggle={(event) => {
                      const traceId = `trace-${message.startIndex}`;
                      const isOpen = event.currentTarget.open;

                      setExpandedTraces((currentTraces) => ({
                        ...currentTraces,
                        [traceId]: isOpen,
                      }));
                    }}
                    open={
                      expandedTraces[`trace-${message.startIndex}`] ??
                      (isLoading && message.startIndex > lastUserIndex)
                    }
                  >
                    <summary className="chat-trace-summary">
                      <span className="chat-trace-title">
                        Reasoning &amp; web search
                      </span>
                      <span className="chat-trace-metadata">
                        {getTraceSummary(message.items)}
                      </span>
                      <span className="chat-trace-status">
                        {getTraceOverallStatus(message.items)}
                      </span>
                    </summary>
                    <div className="chat-trace-content">
                      {message.items.map((traceItem, traceIndex) => (
                        <TraceItemView
                          item={traceItem}
                          key={`trace-item-${message.startIndex}-${traceIndex}`}
                        />
                      ))}
                    </div>
                  </details>
                ) : (
                  <article
                    className={`chat-message ${message.role}`}
                    key={`${message.role}-${index}`}
                  >
                    <div className="message-header">
                      <span className="message-role">
                        {message.role === 'user' ? 'You' : 'Assistant'}
                      </span>
                      {message.role === 'assistant' &&
                        message.rawResponse !== undefined && (
                          <div className="message-actions">
                            {getTokenUsage(message.rawResponse) && (
                              <button
                                aria-label="View token usage"
                                className="token-usage-button"
                                onClick={() => {
                                  const usage = getTokenUsage(
                                    message.rawResponse,
                                  );

                                  if (usage) {
                                    setTokenUsageModal({ usage });
                                  }
                                }}
                                title="View token usage"
                                type="button"
                              >
                                <svg
                                  aria-hidden="true"
                                  viewBox="0 0 24 24"
                                  xmlns="http://www.w3.org/2000/svg"
                                >
                                  <path d="M4 19V9m8 10V5m8 14v-7" />
                                </svg>
                              </button>
                            )}
                            <button
                              aria-label="View raw response"
                              className="raw-response-button"
                              onClick={() =>
                                setRawResponseModal({
                                  content: message.rawResponse,
                                })
                              }
                              title="View raw response"
                              type="button"
                            >
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <path d="M8 9 5 12l3 3m8-6 3 3-3 3M14 5l-4 14" />
                              </svg>
                            </button>
                          </div>
                        )}
                    </div>
                    {message.role === 'assistant' ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {message.content}
                      </ReactMarkdown>
                    ) : (
                      <p>{message.content}</p>
                    )}
                  </article>
                ),
              )}

              {isLoading &&
                !isChatTraceItem(messages[messages.length - 1]) &&
                messages[messages.length - 1]?.role !== 'assistant' && (
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
        </div>
      </section>

      {tokenUsageModal && (
        <div
          className="raw-response-modal-backdrop"
          onMouseDown={() => setTokenUsageModal(null)}
        >
          <section
            aria-labelledby="token-usage-title"
            aria-modal="true"
            className="raw-response-modal token-usage-modal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header>
              <h2 id="token-usage-title">Token usage</h2>
              <button
                aria-label="Close token usage"
                onClick={() => setTokenUsageModal(null)}
                type="button"
              >
                ×
              </button>
            </header>
            <div className="token-usage-table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Input tokens</th>
                    <th scope="col">Input cached</th>
                    <th scope="col">Input cache write</th>
                    <th scope="col">Output tokens</th>
                    <th scope="col">Output reasoning</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      {tokenUsageModal.usage.inputTokens.toLocaleString()}
                    </td>
                    <td>
                      {tokenUsageModal.usage.inputCachedTokens.toLocaleString()}
                    </td>
                    <td>
                      {tokenUsageModal.usage.inputCacheWriteTokens.toLocaleString()}
                    </td>
                    <td>
                      {tokenUsageModal.usage.outputTokens.toLocaleString()}
                    </td>
                    <td>
                      {tokenUsageModal.usage.outputReasoningTokens.toLocaleString()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {rawResponseModal && (
        <div
          className="raw-response-modal-backdrop"
          onMouseDown={() => setRawResponseModal(null)}
        >
          <section
            aria-labelledby="raw-response-title"
            aria-modal="true"
            className="raw-response-modal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header>
              <h2 id="raw-response-title">Raw response</h2>
              <button
                aria-label="Close raw response"
                onClick={() => setRawResponseModal(null)}
                type="button"
              >
                ×
              </button>
            </header>
            <pre>{formatRawResponse(rawResponseModal.content)}</pre>
          </section>
        </div>
      )}
    </main>
  );
}
