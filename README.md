# Soliventa Learn API

The independent backend for Soliventa Learn. It will serve the public school websites, authenticated school portals, and the platform control plane through a versioned HTTP API.

The canonical product scope, release sequence, requirements and launch criteria are defined in
[`docs/product-requirements.md`](docs/product-requirements.md).

## Technology baseline

- Node.js 22.12+
- pnpm 10
- TypeScript in strict mode
- Hono on Cloudflare Workers
- Zod and OpenAPI
- Supabase PostgreSQL and Auth
- Vitest

## Local setup

1. Install the Node version from `.nvmrc`.
2. Run `corepack enable` if pnpm is unavailable.
3. Run `pnpm install`.
4. Copy `.env.example` to `.dev.vars` and add development-only values.
5. Run `pnpm dev`.

Never place production credentials in local files or source control.

## Database baseline

The database is a greenfield design and does not reuse the former product database. Start Docker, then run:

```bash
pnpm db:start
pnpm db:reset
pnpm db:lint
pnpm db:test
```

See `docs/greenfield-data-model.md` and `docs/forward-migrations.md` before changing the schema.

The former application's database is not used. “Supabase” in this repository means the new,
empty, independently migrated Soliventa Learn project described by those documents.

## Backend foundation

All responses use a stable `data`/`meta.requestId` or `error` envelope. Tenant routes resolve a
school exclusively from the normalized request URL hostname; client-supplied school IDs and
forwarded-host headers are not trusted. At the edge, route each custom school domain's `/api/*`
traffic to this Worker while preserving the original host.

Middleware, authorization, caching, health behavior, and elevated-operation boundaries are
documented in `docs/backend-foundation.md`.

## Required checks

```bash
pnpm check
```

## Environments

Development, staging, and production use completely separate Cloudflare, Supabase, payment, email, storage, and AI credentials. See `docs/engineering-standards.md`.
