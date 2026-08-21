# OpenAI Chat Playground

A TypeScript frontend/backend project for experimenting with OpenAI chat APIs and their options.

This initial scaffold provides:

- a React and Vite frontend;
- an Express backend;
- npm workspaces and shared development tooling; and
- strict TypeScript, ESLint, and Prettier configuration.

The chat prototype will be created incrementally.

## Requirements

- Node.js 24 or newer
- npm 11 or newer

## Getting started

```bash
npm install
cp .env.example backend/.env
npm run dev
```

The frontend runs at <http://localhost:5173> and proxies `/api` requests to the backend at <http://localhost:3001>.

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
