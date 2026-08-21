# AGENTS.md

## Project overview

This repository is a TypeScript monorepo for an OpenAI chat API playground. It contains a React/Vite frontend and an Express backend. The main page sends complete Chat Completions requests through `POST /api/chat`.

## Repository layout

- `frontend/` — React client and browser-facing tests.
- `backend/` — Express API and server-side tests.
- `.env.example` — documented local environment variables.
- `eslint.config.mjs` — shared ESLint flat configuration.

## Development commands

Run commands from the repository root:

```bash
npm install
npm run dev
npm run build
npm run typecheck
npm run lint
npm run test
npm run format:check
```

Use `npm run test:watch --workspace frontend` or `npm run test:watch --workspace backend` to run one workspace's tests interactively.

## Conventions

- Use Node.js 24 or newer and npm 11 or newer.
- Keep frontend and backend concerns in their respective workspaces.
- Keep TypeScript strict; do not weaken compiler settings to bypass errors.
- Export the Express application separately from the listening server so handlers can be tested without opening a port.
- Add or update tests when behavior changes.
- Run build, type-checking, linting, tests, and formatting checks before committing.
- Never commit API keys, `.env` files, generated output, or dependencies.

## Local development

Vite proxies `/api` to `http://localhost:3001`. The backend reads `PORT` from the environment and otherwise uses port 3001. Copy `.env.example` to `backend/.env` and configure `OPENAI_API_KEY` before chatting. `OPENAI_MODEL` defaults to `gpt-4o-mini`, and `OPENAI_BASE_URL` can target a compatible provider. Never expose provider credentials to the frontend.
