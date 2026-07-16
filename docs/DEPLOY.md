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
# edit .env with production values as later phases add config
```

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

## Redeploying

```bash
git pull
docker compose up -d --build
```

## What's not covered yet

Uptime monitoring wired to `GET /healthz` and the passcode rotation
procedure land in phase A5 (decommission & runbook), once the rest of the
API surface exists.
