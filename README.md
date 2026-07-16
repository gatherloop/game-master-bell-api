# game-master-bell-api

Self-hosted call API for [Game Master Bell](https://github.com/gatherloop/game-master-bell),
per [PRD-v2](https://github.com/gatherloop/game-master-bell/blob/main/docs/PRD-v2.md).
It replaces the v1 Firebase Cloud Function: validates bell calls from the
bell web app and fans them out as Web Push notifications to game master
devices, with no Google/Firebase dependency.

Status: **Phase A2** (table sync + `POST /call` validation) — table codes are
validated against the bell repo's `tables.json`, synced at startup and
refreshed hourly; a valid call is logged as a stub (no real push yet).
Subscription management and Web Push fan-out land in later phases (A3-A4).

## Stack

Node.js 22 + TypeScript + [Fastify](https://fastify.dev/).

## Development

```bash
pnpm install
pnpm dev          # start the dev server with reload (http://localhost:3000)
```

## Scripts

| Script                              | Purpose                                    |
| ----------------------------------- | ------------------------------------------ |
| `pnpm dev`                          | Run the API with hot reload                |
| `pnpm build`                        | Compile TypeScript to `dist/`              |
| `pnpm start`                        | Run the compiled server (`dist/server.js`) |
| `pnpm lint` / `pnpm lint:fix`       | ESLint                                     |
| `pnpm format` / `pnpm format:check` | Prettier                                   |
| `pnpm typecheck`                    | `tsc --noEmit`                             |
| `pnpm test`                         | Vitest                                     |

## Endpoints

| Endpoint       | Auth | Purpose                                                                                                                                  |
| -------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /healthz` | None | Liveness check                                                                                                                           |
| `POST /call`   | None | Validate `{ tableCode }` against synced table data. 400 malformed, 404 unknown/inactive, 200 (push send stubbed as a log line until A4). |

## Configuration

| Env var                      | Default                                                                                | Purpose                                |
| ---------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------- |
| `TABLES_URL`                 | raw URL to `gatherloop/game-master-bell`'s `packages/shared/src/tables.json` on `main` | Source of truth for table codes        |
| `TABLES_CACHE_PATH`          | `./data/tables-cache.json`                                                             | On-disk fallback used if a fetch fails |
| `TABLES_REFRESH_INTERVAL_MS` | `3600000` (1 hour)                                                                     | How often to re-fetch `TABLES_URL`     |

The API refuses to start only if it has never loaded any copy of the tables
data (neither a live fetch nor a disk cache); a failed refresh after startup
just keeps the last good copy.

## Deploying

See [docs/DEPLOY.md](docs/DEPLOY.md) for running the API on the VPS via
Docker Compose behind a TLS-terminating reverse proxy.
