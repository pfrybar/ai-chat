# OpenAI Chat Playground

A TypeScript frontend/backend project for experimenting with OpenAI chat APIs and their options.

The main page provides a chat interface backed by OpenAI's Chat Completions and Responses APIs. Both APIs stream into the conversation by default, with complete JSON responses available as a playground option. Each request includes the conversation history, and the options panel can switch APIs, models, or reasoning effort on any turn. API, model, reasoning, and delivery selections are stored in the page query parameters so they survive reloads and can be shared.

The project includes:

- a React and Vite frontend;
- an Express backend;
- npm workspaces and shared development tooling; and
- strict TypeScript, ESLint, and Prettier configuration.

## Requirements

- Node.js 24 or newer
- npm 11 or newer

## Getting started

```bash
npm install
cp .env.example backend/.env
# Add your OPENAI_API_KEY to backend/.env
npm run dev
```

The frontend runs at <http://localhost:5173> and proxies `/api` requests to the backend at <http://localhost:3001>.

Set `OPENAI_MODELS` to a comma-separated list of available models. The first model is selected by default; when unset, the application uses `gpt-4o-mini`. Set `OPENAI_BASE_URL` to use a compatible provider endpoint.

## Reasoning models

Reasoning effort is currently tested with `gpt-5.6` models, which are reasoning models. It will not work with models that do not support reasoning; choose **Default** for those models so no reasoning effort is sent.

The available efforts differ by API:

- Chat Completions: `none`, `low`, `medium`, `high`, and `xhigh`.
- Responses: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.

### Web search

Enable **Web search** while using the Responses API to give the model access to current web information. The playground sends the Responses API `web_search` tool without additional configuration; advanced web-search parameters can be added later.

### Reasoning summaries

The Responses API can optionally return a reasoning summary in `auto`, `concise`, or `detailed` mode. This playground streams those summaries into a collapsible response card and includes them with complete responses. The summary option is Responses-only: OpenAI's [reasoning guide](https://developers.openai.com/api/docs/guides/reasoning#reasoning-summaries) documents it as `reasoning.summary` on Responses API requests, while the Chat Completions reference has no corresponding summary parameter. Summaries are not raw reasoning tokens.

### Raw provider responses

Each completed assistant bubble includes a code icon that opens the raw provider payload. When a provider response includes usage data, a token-usage icon opens a normalized table of **Input tokens**, **Input cached**, **Input cache write**, **Output tokens**, and **Output reasoning**. Complete requests retain the full OpenAI response object; streamed requests retain the provider stream events. Raw payloads are held only in the current browser conversation and are not sent back as chat history on later turns.

## Commands

```bash
npm run dev          # run the frontend and backend in watch mode
npm run build        # build all workspaces
npm run typecheck    # type-check all workspaces
npm run lint         # lint the repository
npm run test         # run all workspace tests
npm run format:check # check formatting
```

## Repository layout

- `frontend/` — React, Vite, and TypeScript client
- `backend/` — Express and TypeScript API
