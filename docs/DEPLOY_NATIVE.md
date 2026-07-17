# Native (non-Docker) VPS Deploy Guide

An alternative to [DEPLOY.md](DEPLOY.md) for VPS instances too small for
Docker's daemon overhead to be worth it for a single lightweight Node
service (e.g. 512MB RAM or less). The API runs directly under a systemd
user service instead of a container, sitting behind the same
TLS-terminating reverse proxy — the app always listens on
`127.0.0.1:3000` regardless of how it's run, so the proxy setup is
identical either way.

## Prerequisites

- Node.js 22.x on the VPS, e.g. via NodeSource:

  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
  sudo corepack enable
  ```

- A domain/subdomain pointed at the VPS.
- A reverse proxy already running (Caddy or nginx) — see
  [DEPLOY.md's "Reverse proxy with TLS"](DEPLOY.md#3-reverse-proxy-with-tls)
  section; it's unchanged by this guide.
- `loginctl enable-linger <user>` for whichever user will run the service,
  so its systemd user manager (and the API) keeps running without an
  active SSH session, and starts again on reboot.

## 1. Get the code and configure

```bash
git clone https://github.com/gatherloop/game-master-bell-api.git
cd game-master-bell-api
cp .env.example .env
mkdir -p data
```

Fill in `.env` with the same production values described in
[DEPLOY.md step 1](DEPLOY.md#1-get-the-code-onto-the-vps):
`STAFF_PASSCODE`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
`TABLES_CACHE_PATH`/`SUBSCRIPTIONS_DB_PATH` default to `./data/...`,
relative to this directory — the `mkdir -p data` above creates it.

## 2. Build

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm prune --prod
```

`pnpm prune --prod` drops `devDependencies` (TypeScript, etc.) once
`dist/` is built, keeping `node_modules` down to what's needed at runtime.

## 3. Run as a systemd user service

```bash
mkdir -p ~/.config/systemd/user
cp deploy/game-master-bell-api.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now game-master-bell-api
```

The unit uses `%h` for the working directory/env file path, so it assumes
the repo was cloned directly into the service user's home directory
(`~/game-master-bell-api`); edit `WorkingDirectory`/`EnvironmentFile` in
the unit file if you cloned it elsewhere.

Check it's up:

```bash
systemctl --user status game-master-bell-api
curl http://127.0.0.1:3000/healthz
# {"status":"ok"}
journalctl --user -u game-master-bell-api -f   # tail logs
```

`Restart=always` in the unit keeps the process supervised across crashes
and reboots (NFR-2), same guarantee as `restart: always` in the Docker
compose file.

## 4. Reverse proxy with TLS, and verifying end to end

Identical to the Docker guide — see DEPLOY.md's
["Reverse proxy with TLS"](DEPLOY.md#3-reverse-proxy-with-tls) and
["Verify end to end"](DEPLOY.md#4-verify-end-to-end) sections. Swap
`docker compose logs -f` for `journalctl --user -u game-master-bell-api -f`
when checking for the per-subscription `push.send_result`/`push.pruned`
log lines.

## Redeploying manually

```bash
git pull
pnpm install --frozen-lockfile
pnpm build
pnpm prune --prod
systemctl --user restart game-master-bell-api
```

## Automated deploys via GitHub Actions

`.github/workflows/deploy.yml` runs lint/typecheck/test/build on every
push, then on `main` SSHes into the VPS and runs the same redeploy steps
as above, plus (re)writes the VPS's `.env` from GitHub secrets on every
deploy — rotating a secret and re-running the workflow is enough to roll
it out. It also (re)installs `deploy/game-master-bell-api.service` into
`~/.config/systemd/user/` and runs `daemon-reload` on every deploy, so
edits to the unit file in the repo take effect on the next push to `main`
without any manual step on the VPS.

### One-time VPS prep

1. Complete steps 1–2 above once by hand (clone the repo, configure
   `.env`) so there's a working checkout for the workflow to update. The
   workflow itself installs the systemd unit and starts the service on
   its first run.
2. Make sure lingering is enabled for the deploy user
   (`loginctl enable-linger <user>`) — without it, `systemctl --user`
   commands over a non-interactive SSH session have nothing to talk to.
3. Generate a dedicated SSH key pair for GitHub Actions and add the
   **public** key to that user's `~/.ssh/authorized_keys` on the VPS:

   ```bash
   ssh-keygen -t ed25519 -f deploy_key -C "github-actions" -N ""
   ```

4. Keep the **private** key (`deploy_key`) for the `VPS_SSH_KEY` secret
   below — never commit it.

### Repo secrets

Add these under the repo's **Settings → Secrets and variables → Actions**
(create a `production` environment first if you want the extra approval
gate that `environment: production` in the workflow enables):

| Secret              | Value                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------- |
| `VPS_HOST`          | VPS IP or hostname                                                                    |
| `VPS_PORT`          | SSH port (usually `22`)                                                               |
| `VPS_USERNAME`      | The deploy user created above                                                         |
| `VPS_SSH_KEY`       | The **private** key from step 3 (paste the whole file contents)                       |
| `VPS_DEPLOY_PATH`   | Absolute path to the repo clone on the VPS, e.g. `/home/deploy/game-master-bell-api` |
| `STAFF_PASSCODE`    | Same value described in step 1                                                        |
| `VAPID_PUBLIC_KEY`  | Same value described in step 1                                                        |
| `VAPID_PRIVATE_KEY` | Same value described in step 1                                                        |
| `VAPID_SUBJECT`     | Same value described in step 1                                                        |

Only these four env vars need to be secrets; everything else keeps the
default already baked into `.env.example`. To override another default
too (e.g. a non-default `TABLES_URL`), add it as another secret and an
extra line in the `cat > .env` heredoc in `.github/workflows/deploy.yml`.

Once the secrets are set, push to `main` (or run the workflow manually
from the **Actions** tab) to trigger a deploy.

## Next steps

Once the API is deployed and verified end to end, see
[RUNBOOK.md](RUNBOOK.md) for the phase A5 operational work: the Firebase
project decommission checklist, wiring up uptime monitoring for
`GET /healthz`, and the staff passcode rotation procedure.
