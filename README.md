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
