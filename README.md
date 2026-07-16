# game-master-bell-api

Self-hosted call API for [Game Master Bell](https://github.com/gatherloop/game-master-bell),
per [PRD-v2](https://github.com/gatherloop/game-master-bell/blob/main/docs/PRD-v2.md).
It replaces the v1 Firebase Cloud Function: validates bell calls from the
bell web app and fans them out as Web Push notifications to game master
devices, with no Google/Firebase dependency.

Status: **Phase A1** (scaffold) — `GET /healthz` only. Table validation,
`POST /call`, and subscription management land in later phases (A2-A4).

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

| Endpoint       | Auth | Purpose        |
| -------------- | ---- | -------------- |
| `GET /healthz` | None | Liveness check |

## Deploying

See [docs/DEPLOY.md](docs/DEPLOY.md) for running the API on the VPS via
Docker Compose behind a TLS-terminating reverse proxy.
