# Runbook — Decommission & Operations

Operational reference for phase **A5** (decommission & runbook), the final
step of the API track in
[PRD-v2](https://github.com/gatherloop/game-master-bell/blob/main/docs/PRD-v2.md).
By this point [phase B3](https://github.com/gatherloop/game-master-bell/blob/main/docs/RUNBOOK.md)
has removed the old Firebase Cloud Function and native Android receiver from
the bell repo, and the production call path has been running on this API
(deployed per [docs/DEPLOY.md](DEPLOY.md)) since phase B2. Nothing references
the v1 Firebase project anymore, so it's safe to tear down.

This document covers the three things phase A5 is scoped to: closing out
Firebase, wiring up uptime monitoring for `GET /healthz`, and the staff
passcode rotation procedure. See [DEPLOY.md](DEPLOY.md) for the initial VPS
setup and [README.md](../README.md) for endpoints and configuration.

---

## 1. Firebase decommission

**Precondition:** confirm phase B3 is merged and deployed (the bell app's
`VITE_CALL_API_URL` points at this API, not a Cloud Function URL) and that
this API has been serving production calls without issue for at least a few
days. Once that's true, nothing reads from or writes to the Firebase project
— it's a pure cost/liability with no product value.

1. **Confirm no live traffic.** In the Firebase console, open
   **Functions** and check the invocation graph for the old `notify`/`call`
   function over the last 7 days — it should be flat at zero. If it isn't,
   stop: something is still pointed at the old path (check the bell app's
   deployed env var and any stale browser tabs/caches before proceeding).
2. **Export anything worth keeping.** v1 kept no durable data of its own
   (no call history, per PRD §6) beyond the FCM topic subscription managed
   by the Android app, so there's nothing to export. If your project
   accumulated Cloud Function logs you want for the record, download them
   (**Functions → Logs → Export**) before deleting.
3. **Delete the Cloud Function.** Console → **Functions** → select the
   `notify`/`call` function → **Delete**. This stops billing for invocations
   immediately.
4. **Remove the Firebase Cloud Messaging setup.** Console → **Project
   settings → Cloud Messaging** — no action needed to "delete" FCM itself,
   but note the server key/sender ID are dead once the project is deleted in
   the next step.
5. **Delete the Firebase project.** Console → **Project settings → General**
   → scroll to **Delete project** → follow the confirmation flow (requires
   typing the project ID). This is the point of no return — Firebase gives
   a ~30 day grace window before the project ID is released, but the project
   itself stops serving traffic and stops billing immediately.
6. **Close the Blaze billing account** (if this project was its only user).
   [Google Cloud Console → Billing](https://console.cloud.google.com/billing)
   → select the billing account → **Account management** → **Close billing
   account**. Confirm no other projects are attached to it first (**Billing
   → My projects**) — closing it disables billing for everything linked, so
   double-check before confirming.
7. **Revoke lingering access.** Console → **Project settings → Users and
   permissions** (or Cloud IAM, if the project isn't fully deleted yet) —
   remove any service accounts, CI credentials, or personal accounts that
   only existed for this project. Rotate/delete any `google-services.json`
   or service account JSON keys that were floating around in CI secrets or
   local machines for the old Android app / Cloud Function deploy.
8. **Verify.** Firebase console → project list no longer shows this project
   (or shows it as pending deletion); Cloud Billing shows no active charges
   from it going forward. This is the demoable outcome for phase A5's
   Firebase side: **Firebase console empty.**

---

## 2. Uptime monitoring for `GET /healthz`

`GET /healthz` returns `{"status":"ok"}` with a 200 when the process is up
(see [README.md](../README.md#endpoints)). NFR-2 asks for this wired to
"simple uptime monitoring" — pick one of the two options below depending on
whether you'd rather lean on a free external service or keep monitoring
entirely self-hosted alongside the API.

### Option A: external uptime monitor (recommended — zero infra to run)

Any HTTP uptime checker works since `/healthz` is a plain unauthenticated
GET. [UptimeRobot](https://uptimerobot.com) and
[healthchecks.io](https://healthchecks.io)-style "push" monitors are both
free at this scale; UptimeRobot's approach (it polls you) needs no changes
on the VPS:

1. Create a new **HTTP(s)** monitor pointed at
   `https://bell-api.gatherloop.id/healthz`.
2. Interval: 5 minutes is plenty for a single-VPS internal tool (NFR-1's ~5s
   latency budget is about call delivery, not about how fast we notice an
   outage).
3. Alert condition: non-2xx response, or a request timeout (10s is a
   reasonable threshold — the endpoint does no I/O, so a healthy process
   responds in milliseconds).
4. Point the alert contact at whatever the team already watches (email,
   Slack webhook, etc.) — the specific channel is a team choice, not part of
   this spec.

### Option B: self-hosted cron check (no third-party dependency)

If avoiding another external account is a priority, a small cron job on the
same VPS (or a second one) covers it:

```bash
# /etc/cron.d/bell-api-healthcheck — runs every 5 minutes
*/5 * * * * root curl -fsS --max-time 10 https://bell-api.gatherloop.id/healthz \
  || curl -fsS -X POST https://ntfy.sh/<your-private-topic> -d "bell-api healthz check failed"
```

`curl -f` treats non-2xx as a failure, so both a downed process and a proxy
misconfiguration trip the alert. Swap the `ntfy.sh` line for whatever
notification channel the team uses (a webhook, `mail`, etc.) — the shape is
"on failure, push a message somewhere a human will see it."

### Verifying the alert path

Before calling monitoring "live," force one failure end to end: stop the
container (`docker compose stop`) on a maintenance window, confirm the
alert fires within one check interval, then start it back up
(`docker compose start`) and confirm the alert clears. This is the
demoable outcome for phase A5's monitoring side: **monitoring live** — not
just configured, but proven to notify on a real failure.

---

## 3. Staff passcode rotation

`STAFF_PASSCODE` gates `POST`/`DELETE /subscriptions` only (per FR-A5) — it
is **not** checked when sending calls or pushes, so rotating it never
disrupts devices that are already subscribed. Existing rows in the
subscriptions database keep receiving pushes through a rotation with zero
downtime. The passcode only matters the next time a device needs to
subscribe or unsubscribe (a new staff phone, a reinstalled receiver PWA, or
an explicit unsubscribe).

Rotate it periodically (e.g. when staff turnover happens, or on a routine
schedule the team sets) as follows:

1. Generate a new passcode:
   ```bash
   openssl rand -hex 16
   ```
2. Update `STAFF_PASSCODE` in the VPS's `.env` file to the new value.
3. Restart the API container to pick it up:
   ```bash
   docker compose up -d
   ```
   (Compose only recreates the container if the config changed; `--force-recreate`
   guarantees it if you want to be explicit.)
4. Confirm the old passcode is rejected and the new one works:
   ```bash
   curl -i https://bell-api.gatherloop.id/subscriptions \
     -X POST -H "Content-Type: application/json" \
     -d '{"subscription":{"endpoint":"https://example/test","keys":{"p256dh":"x","auth":"y"}},"passcode":"<old passcode>"}'
   # HTTP/1.1 401 Unauthorized
   ```
5. Distribute the new passcode to staff through whatever out-of-band channel
   the team already trusts (it's a shared secret, not per-device — same
   assumption as v1's install ceremony, per PRD §3.2). Devices already
   subscribed don't need to do anything; only someone (re)subscribing or
   unsubscribing from now on needs the new value.

No code or schema change is needed for rotation — the passcode is a single
env var compared at request time (`src/subscriptions/auth.ts`), never
persisted.
