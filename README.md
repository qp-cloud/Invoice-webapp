# Inventory Management System (single-owner)

Production-grade inventory system for one owner. See **`PROJECT_SPEC.md`** — the single
source of truth. Design docs: `ARCHITECTURE.md`, `DATABASE.md`, `API.md`, `TESTING.md`,
`IMPORT_FORMAT.md`, `BACKUP_RECOVERY.md`. Progress: `PROGRESS.md`. Work list: `TASKS.md`.

## Stack

React + Vite + TypeScript · Fastify + Node · PostgreSQL 16 (production) / PGlite (dev &
test) · Drizzle ORM (typed queries) · integer-satang money.

## Layout

```
packages/shared   types, zod schemas, cleanData, money, replayLedger, formatters
packages/server   Fastify API, DB, migrations, services
packages/web      React SPA
```

## Develop

```bash
npm install
npm run migrate        # apply SQL migrations to the local PGlite database
npm run dev            # server on :4000, web on :5173
```

## Verify

```bash
npm run typecheck
npm run lint
npm test               # shared + server + web unit/integration
```
