# game-master-bell-api

Self-hosted call API for [Game Master Bell](https://github.com/gatherloop/game-master-bell),
per [PRD-v2](https://github.com/gatherloop/game-master-bell/blob/main/docs/PRD-v2.md).
It replaces the v1 Firebase Cloud Function: validates bell calls from the
bell web app and fans them out as Web Push notifications to game master
devices, with no Google/Firebase dependency.

Status: **Phase A3** (subscription store + endpoints) — table codes are
validated against the bell repo's `tables.json`, synced at startup and
refreshed hourly; a valid call is still logged as a stub (no real push yet).
Game master devices can now register/unregister a Web Push subscription
(SQLite-backed, passcode-gated), and the API's VAPID public key is served
for the receiver PWA to use. Web Push fan-out lands in phase A4.

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
| `pnpm vapid:generate`               | Print a new VAPID key pair                 |

## Endpoints

| Endpoint                | Auth           | Purpose                                                                                                                                  |
| ----------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /healthz`          | None           | Liveness check                                                                                                                           |
| `GET /vapid-key`        | None           | Returns `{ publicKey }`, the API's VAPID public key. 500 if not configured.                                                              |
| `POST /call`            | None           | Validate `{ tableCode }` against synced table data. 400 malformed, 404 unknown/inactive, 200 (push send stubbed as a log line until A4). |
| `POST /subscriptions`   | Staff passcode | Upsert `{ subscription, passcode }` (a `PushSubscription`), keyed by endpoint — idempotent. 400 malformed, 401 bad passcode, 200 stored. |
| `DELETE /subscriptions` | Staff passcode | Remove `{ endpoint, passcode }`. Idempotent (200 even if the endpoint was never stored). 400 malformed, 401 bad passcode.                |

## Configuration

| Env var                      | Default                                                                                | Purpose                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `TABLES_URL`                 | raw URL to `gatherloop/game-master-bell`'s `packages/shared/src/tables.json` on `main` | Source of truth for table codes                                     |
| `TABLES_CACHE_PATH`          | `./data/tables-cache.json`                                                             | On-disk fallback used if a fetch fails                              |
| `TABLES_REFRESH_INTERVAL_MS` | `3600000` (1 hour)                                                                     | How often to re-fetch `TABLES_URL`                                  |
| `SUBSCRIPTIONS_DB_PATH`      | `./data/subscriptions.db`                                                              | SQLite file backing the subscriptions store                         |
| `STAFF_PASSCODE`             | _(required)_                                                                           | Shared secret gating `POST`/`DELETE /subscriptions`                 |
| `VAPID_PUBLIC_KEY`           | _(required)_                                                                           | Served at `GET /vapid-key`; generate with `pnpm run vapid:generate` |
| `VAPID_PRIVATE_KEY`          | _(unused until A4)_                                                                    | Generated alongside the public key; wired up in phase A4            |

The API refuses to start if it has never loaded any copy of the tables data
(neither a live fetch nor a disk cache), or if `STAFF_PASSCODE`/
`VAPID_PUBLIC_KEY` are unset; a failed tables refresh after startup just
keeps the last good copy.

## Deploying

See [docs/DEPLOY.md](docs/DEPLOY.md) for running the API on the VPS via
Docker Compose behind a TLS-terminating reverse proxy.
