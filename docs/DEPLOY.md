# VPS Deploy Guide

The API runs as a single Docker container on the VPS, sitting behind a
reverse proxy that terminates TLS. This mirrors the target architecture in
[PRD-v2](https://github.com/gatherloop/game-master-bell/blob/main/docs/PRD-v2.md):
Web Push and the GitHub Pages-hosted callers both require HTTPS, so the
proxy — not the Node process — holds the certificate.

## Prerequisites

- A VPS with Docker Engine and the Docker Compose plugin installed.
- A domain/subdomain pointed at the VPS (e.g. `bell-api.gatherloop.id`).
- A reverse proxy already running on the VPS (Caddy or nginx). Caddy is
  recommended for its automatic Let's Encrypt issuance/renewal.

## 1. Get the code onto the VPS

```bash
git clone https://github.com/gatherloop/game-master-bell-api.git
cd game-master-bell-api
cp .env.example .env
```

Fill in `.env` with production values:

- `STAFF_PASSCODE` — a shared secret staff enter in the receiver PWA
  (e.g. `openssl rand -hex 16`). Required — subscription endpoints reject
  everything with 401 until this is set.
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — generate a pair with
  `pnpm install && pnpm run vapid:generate` and paste both values in.
  `VAPID_PUBLIC_KEY` is served at `GET /vapid-key`; `VAPID_PRIVATE_KEY` signs
  every outgoing Web Push message and must stay secret.
- `VAPID_SUBJECT` — a `mailto:` address or `https:` URL push services may use
  to contact us about this key pair, per the VAPID spec.

`TABLES_CACHE_PATH` and `SUBSCRIPTIONS_DB_PATH` default to `./data/tables-cache.json`
and `./data/subscriptions.db`; `docker-compose.yml` mounts a named volume at
`/app/data` so the on-disk tables cache and the subscriptions database
survive container restarts and redeploys.

## 2. Run the API container

The container binds to `127.0.0.1:3000` only — it is never exposed directly
to the internet, the reverse proxy is the only public entry point.

```bash
docker compose up -d --build
```

Confirm it's up locally on the VPS:

```bash
curl http://127.0.0.1:3000/healthz
# {"status":"ok"}
```

`restart: always` in `docker-compose.yml` keeps the process supervised
across crashes and VPS reboots (NFR-2).

## 3. Reverse proxy with TLS

### Option A: Caddy

Add a site block to `Caddyfile`:

```
bell-api.gatherloop.id {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy obtains and renews the Let's Encrypt certificate automatically on
reload (`caddy reload`).

### Option B: nginx + certbot

```nginx
server {
    listen 443 ssl;
    server_name bell-api.gatherloop.id;

    ssl_certificate     /etc/letsencrypt/live/bell-api.gatherloop.id/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bell-api.gatherloop.id/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name bell-api.gatherloop.id;
    return 301 https://$host$request_uri;
}
```

Issue the certificate with `certbot --nginx -d bell-api.gatherloop.id`.

## 4. Verify end to end

```bash
curl https://bell-api.gatherloop.id/healthz
# {"status":"ok"}
```

This is the demoable outcome for phase A1.

Phase A3's demoable outcome — a subscription posted with `curl` lands in the
database, and a wrong passcode is rejected:

```bash
curl -i https://bell-api.gatherloop.id/subscriptions \
  -X POST -H "Content-Type: application/json" \
  -d '{"subscription":{"endpoint":"https://example/test","keys":{"p256dh":"x","auth":"y"}},"passcode":"wrong"}'
# HTTP/1.1 401 Unauthorized

curl -i https://bell-api.gatherloop.id/subscriptions \
  -X POST -H "Content-Type: application/json" \
  -d '{"subscription":{"endpoint":"https://example/test","keys":{"p256dh":"x","auth":"y"}},"passcode":"<your STAFF_PASSCODE>"}'
# HTTP/1.1 200 OK  {"ok":true}
```

Phase A4's demoable outcome — `curl /call` rings a real browser subscribed
by hand via devtools (no receiver PWA needed yet):

1. On a phone or desktop browser, open any HTTPS page and run in devtools:

   ```js
   const swSource = `
     self.addEventListener("push", (event) => {
       const { title, body } = event.data.json();
       event.waitUntil(self.registration.showNotification(title, { body }));
     });
   `;
   const swUrl = URL.createObjectURL(new Blob([swSource], { type: "text/javascript" }));
   const registration = await navigator.serviceWorker.register(swUrl);
   const subscription = await registration.pushManager.subscribe({
     userVisibleOnly: true,
     applicationServerKey: "<VAPID_PUBLIC_KEY>",
   });
   console.log(JSON.stringify(subscription.toJSON()));
   ```

2. Register that subscription with the API:

   ```bash
   curl -i https://bell-api.gatherloop.id/subscriptions \
     -X POST -H "Content-Type: application/json" \
     -d '{"subscription": <output of sub.toJSON()>, "passcode": "<your STAFF_PASSCODE>"}'
   # HTTP/1.1 200 OK  {"ok":true}
   ```

3. Trigger a call for a real table code and watch the notification appear:

   ```bash
   curl -i https://bell-api.gatherloop.id/call \
     -X POST -H "Content-Type: application/json" \
     -d '{"tableCode":"2-05"}'
   # HTTP/1.1 200 OK  {"ok":true}
   ```

Check the container logs (`docker compose logs -f`) for the per-subscription
`push.send_result` line, and `push.pruned` if a stale subscription gets
cleaned up.

## Redeploying

```bash
git pull
docker compose up -d --build
```

## Lightweight VPS? Skip Docker

If the VPS is too small for Docker's daemon overhead to be worth it (e.g.
512MB RAM or less) run the API directly with Node + systemd instead — see
[docs/DEPLOY_NATIVE.md](DEPLOY_NATIVE.md). Same reverse proxy config
either way, since the app always listens on `127.0.0.1:3000`.
`.github/workflows/deploy.yml` automates the native path.

## Next steps

Once the API is deployed and verified end to end, see
[RUNBOOK.md](RUNBOOK.md) for the phase A5 operational work: the Firebase
project decommission checklist, wiring up uptime monitoring for
`GET /healthz`, and the staff passcode rotation procedure.
