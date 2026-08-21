# Installing wacrm and wiring up automations

A start-to-finish setup guide for getting wacrm running on **any
machine** (Linux, macOS, Windows, container, or a PaaS box) with
automations that actually fire.

Automations have three moving parts, and all three must be in place:

| Part | What it does | If it's missing |
| --- | --- | --- |
| **The app** | Hosts the engine and the automation builder UI | Nothing works |
| **The inbound webhook** | Meta → `POST /api/whatsapp/webhook` — this is what *dispatches* message-driven triggers | Automations exist but never fire |
| **The cron drain** | Scheduled `GET /api/automations/cron` + `GET /api/flows/cron` | Automations fire but **stall forever at the first Wait step**, and abandoned flow runs block the contact from re-triggering |

Most "my automation didn't run" reports are a missing part 2 or part 3.

---

## 1. Prerequisites

- **Node.js 22.13+ or 24 LTS.** `package.json` sets
  `engines.node >= 20`, but several transitive deps declare
  `^20.19.0 || ^22.13.0 || >=24`. Node 23.x installs and runs, but npm
  prints `EBADENGINE` warnings.
- **npm 10+** (ships with the Node versions above).
- **Git.**
- **A Supabase project** — cloud (free tier is fine) or self-hosted.
  You need the project URL, the anon key, and the service-role key.
- **A Meta WhatsApp Business app** — phone number ID, WABA ID, a
  permanent access token, and the app secret.
- **A public HTTPS URL** for the machine. Meta will not deliver
  webhooks to `http://localhost`. For local development use a tunnel
  (`cloudflared tunnel --url http://localhost:3000`, ngrok, tailscale
  funnel, …).

---

## 2. Install the app

```bash
git clone https://github.com/CloudMasa-Tech/whatsappcrm.git
cd whatsappcrm
npm ci          # reproducible; use `npm install` only when changing deps
```

`npm ci` requires `package-lock.json` and wipes `node_modules` first —
that is what you want on a fresh machine.

### Or run the installer

`scripts/install.sh` does sections 2 through 8 of this guide in one
pass: prerequisite checks, `.env` with freshly generated secrets,
dependencies, build (or `docker compose up`), the cron jobs, and a
verification pass that distinguishes a 503 (secret missing from the
running process) from a 401 (secret mismatch).

```bash
./scripts/install.sh --dry-run       # see the plan, change nothing
./scripts/install.sh                 # interactive
./scripts/install.sh --mode docker --with-cron
```

It is re-runnable: an existing secret is never regenerated, `.env` is
backed up before every write, and it refuses to guess your Supabase
credentials. Read the rest of this document anyway — the installer
automates the steps, not the understanding of what breaks when one is
skipped.

---

## 3. Create the database schema

`supabase/migrations/` holds the schema as **50 numbered migrations**.
`combined_migrations.sql` at the repo root is the flattened schema
**through 036 only** — it is the documented starting point, not the
whole story. On its own it leaves you without `projects` and without
`whatsapp_sessions`, so `037` upward must follow it.

`DEPLOYMENT.md` §2.1 is the authority here; this is the short version.

**Option A — Supabase CLI (simplest, applies everything in order).**

```bash
supabase link --project-ref <your-ref>
supabase db push          # applies supabase/migrations/*.sql in order
```

**Option B — psql, in order.**

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f combined_migrations.sql
for f in supabase/migrations/0[3-9]*.sql supabase/migrations/0[4-5]*.sql; do
  echo "→ $f"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done
```

**Option C — Supabase SQL editor.** `combined_migrations.sql` first,
then each file from `037` upward in numeric order. Migrations are
idempotent (`IF NOT EXISTS` on tables and indexes, `DROP POLICY IF
EXISTS` before each `CREATE POLICY`), so re-running one is safe.

Upgrading an instance that already has `accounts` but no `projects`?
`supabase/apply_041_045.sql` is 041–045 concatenated in dependency
order, and `supabase/preflight_041_045.sql` is a read-only report of
what would block it. Note both stop at 045 while the tree now goes to
050 — apply `046`–`050` after them.

The SQL Editor runs a whole script in ONE transaction, so one error
anywhere rolls back everything and the database looks untouched. Scroll
up for the *first* error rather than the last.

> Watch the notices when running 044 this way. It adds
> `whatsapp_sessions` to the Realtime publication and rewrites the
> storage policies inside blocks that **downgrade a privilege error to a
> WARNING** — deliberately, so an abort doesn't roll back five
> migrations. A `Could not add whatsapp_sessions to the
> supabase_realtime publication` warning means the QR pairing screen
> won't update live; add the table under **Database → Replication**.

Confirm afterwards that these automation tables exist:
`automations`, `automation_steps`, `automation_logs`,
`automation_pending_executions`, `flows`, `flow_runs`,
`flow_run_events`.

> If the app later fails with a PostgREST `PGRST200`
> ("could not find a relationship in the schema cache"), reload the
> schema cache from **Settings → API → Reload schema** — that's a
> stale-cache symptom, not a missing migration.

---

## 4. Configure the environment

```bash
cp .env.example .env.local     # .env.* is gitignored; .env.example is the template
```

`.env.example` covers the app and gateway keys but **does not include
`AUTOMATION_CRON_SECRET`** — you must add it yourself, or both cron
endpoints answer `503 {"error":"cron not configured"}` and every Wait
step stalls.

### Required

| Variable | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page |
| `SUPABASE_SERVICE_ROLE_KEY` | same page. Bypasses RLS — server-side only, never in client code |
| `ENCRYPTION_KEY` | 64 hex chars. Encrypts the stored WhatsApp access token and verify token |
| `META_APP_SECRET` | Meta for Developers → App Settings → Basic. Used to verify the `X-Hub-Signature-256` on inbound webhooks |
| `AUTOMATION_CRON_SECRET` | **You generate it.** Shared secret for both cron endpoints |

Generate the two secrets:

```bash
openssl rand -hex 32   # ENCRYPTION_KEY        (must be exactly 64 hex chars)
openssl rand -hex 32   # AUTOMATION_CRON_SECRET (any length; keep it long)
```

### Recommended

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Public origin, e.g. `https://crm.example.com`. Used to build invite links |
| `NEXT_PUBLIC_APP_LOCALE` | Default UI locale |

### Optional

| Variable | Purpose |
| --- | --- |
| `META_APP_ID` | Required only for **image-header** message templates (Meta Resumable Upload) |
| `WHATSAPP_TEMPLATES_DRY_RUN` | `true` skips real template submission to Meta. Useful on staging |
| `ALLOWED_DEV_ORIGINS` | Comma-separated extra dev origins for Turbopack. Dev-only; needed when reaching `npm run dev` through a tunnel |
| `ALLOWED_INVITE_HOSTS` | Comma-separated hostname allowlist for invitation links |
| `AI_REQUEST_TIMEOUT_MS`, `AI_CONTEXT_MESSAGE_LIMIT` | AI auto-reply tuning |

> **`NEXT_PUBLIC_*` values are inlined into the client bundle at build
> time.** They must be present when `npm run build` runs — setting them
> only at container start is too late.

---

## 5. Start the app

**Development**

```bash
npm run dev            # Turbopack, http://localhost:3000
npm run dev -- -p 3001 # if 3000 is taken
```

**Production**

```bash
npm run build
npm start              # honours PORT and HOSTNAME
```

**Docker** — the repo `Dockerfile` builds and runs the app on port 3000:

```bash
docker build -t wacrm .
docker run -d --name wacrm -p 3000:3000 --env-file .env.local wacrm
```

`.dockerignore` excludes `node_modules`, `.next`, and `.git` but **not**
`.env.local`, so `COPY . .` picks it up and `npm run build` sees the
`NEXT_PUBLIC_*` values. Keep that in mind before pushing the image
anywhere shared — the client bundle carries those public values, and
the image layer carries the file.

Put a reverse proxy (nginx / Caddy / Cloudflare) in front for TLS.
Meta requires HTTPS on the webhook callback.

---

## 6. Connect WhatsApp

This branch offers two transports per project, and automations work the
same on either:

- **Cloud API** — Meta's official Business API. Steps below.
- **QR pairing** — WhatsApp's linked-devices feature, held open by the
  separate long-running `gateway/` service. No Meta app, no templates.
  It needs its own env (`gateway/.env.example`), plus
  `WHATSAPP_GATEWAY_URL` / `WHATSAPP_GATEWAY_TOKEN` /
  `WHATSAPP_GATEWAY_SIGNING_SECRET` / `WHATSAPP_GATEWAY_WEBHOOK_SECRET`
  on the web side, and it cannot run on serverless — see
  `gateway/README.md`.

Steps 1–5 below are Cloud API. For QR, connect the number under
**Settings → WhatsApp → QR** and skip to section 7.

1. Sign in and open **Settings → WhatsApp**.
2. Enter **phone number ID**, **WABA ID**, the **permanent access
   token**, a **verify token** you invent, and the 6-digit **PIN** if
   you want the number registered through the Cloud API.
   The access token and verify token are encrypted with
   `ENCRYPTION_KEY` before they touch the database — rotating that key
   invalidates existing rows.
3. In **Meta for Developers → WhatsApp → Configuration**, set:
   - **Callback URL:** `https://<your-host>/api/whatsapp/webhook`
   - **Verify token:** exactly the string you saved in step 2.
4. Click **Verify and save**. Meta issues
   `GET /api/whatsapp/webhook?hub.mode=subscribe&…`; the route decrypts
   every stored verify token and echoes the challenge on a match. A 403
   means no stored token matched — or `ENCRYPTION_KEY` changed since
   the token was saved.
5. **Subscribe to the `messages` webhook field.** Without this
   subscription no inbound events arrive and no message-driven
   automation can ever fire.

The verify token is stored **per account** in the database, not in the
environment — several accounts can share one deployment and one
callback URL.

---

## 7. Wire up the cron drain

This is the step that gets skipped. Two independent endpoints, both
`GET`, both authenticated with the **`x-cron-secret`** header compared
against `AUTOMATION_CRON_SECRET` in constant time:

| Endpoint | Job | Suggested interval | Response |
| --- | --- | --- | --- |
| `/api/automations/cron` | Drains due `automation_pending_executions` rows — i.e. resumes automations parked at a **Wait** step. Claims each row by flipping it to `running`, so overlapping runs don't double-process. **Max 50 rows per call.** | **every minute** | `{"processed":N}` |
| `/api/flows/cron` | Marks abandoned active flow runs `timed_out` per each flow's `fallback_policy.on_timeout_hours` (default 24h) and writes a `flow_run_events` audit row | **every 5 minutes** (hourly is acceptable at low volume) | `{"swept":N}` |

Why `/api/flows/cron` is not optional: `flow_runs` has a partial unique
index allowing one *active* run per contact. A customer who walks away
mid-flow keeps that row forever, and every future trigger for them is
silently blocked until the sweep clears it.

Run the automations drain **every minute** — the 50-row cap means a
burst of due Wait steps needs several passes to clear.

Pick whichever scheduler your machine has:

### Linux / macOS — crontab

```bash
crontab -e
```

```cron
CRON_SECRET=<your AUTOMATION_CRON_SECRET>
BASE=https://crm.example.com

* * * * * curl -fsS -m 55 -H "x-cron-secret: $CRON_SECRET" "$BASE/api/automations/cron" >> /var/log/wacrm-cron.log 2>&1
*/5 * * * * curl -fsS -m 55 -H "x-cron-secret: $CRON_SECRET" "$BASE/api/flows/cron"      >> /var/log/wacrm-cron.log 2>&1
```

`-f` makes curl exit non-zero on 4xx/5xx, so a wrong secret shows up in
cron mail instead of failing silently. `-m 55` keeps a hung request from
overlapping the next minute's run.

On macOS, `cron` still works but needs Full Disk Access for the
`cron` binary under recent releases; `launchd` (below) avoids that.

### macOS — launchd

`~/Library/LaunchAgents/tech.wacrm.automations-cron.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>tech.wacrm.automations-cron</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/curl</string>
    <string>-fsS</string><string>-m</string><string>55</string>
    <string>-H</string><string>x-cron-secret: REPLACE_WITH_SECRET</string>
    <string>https://crm.example.com/api/automations/cron</string>
  </array>
  <key>StartInterval</key><integer>60</integer>
  <key>StandardErrorPath</key><string>/tmp/wacrm-cron.err</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/tech.wacrm.automations-cron.plist
```

Duplicate the file with `StartInterval` 300 for `/api/flows/cron`.

### Linux — systemd timer

`/etc/systemd/system/wacrm-automations-cron.service`:

```ini
[Unit]
Description=wacrm automations wait-step drain

[Service]
Type=oneshot
Environment=CRON_SECRET=REPLACE_WITH_SECRET
ExecStart=/usr/bin/curl -fsS -m 55 -H "x-cron-secret: ${CRON_SECRET}" https://crm.example.com/api/automations/cron
```

`/etc/systemd/system/wacrm-automations-cron.timer`:

```ini
[Unit]
Description=Run wacrm automations drain every minute

[Timer]
OnBootSec=60
OnUnitActiveSec=60
AccuracySec=10

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wacrm-automations-cron.timer
sudo systemctl list-timers wacrm-\*      # verify
```

Prefer a systemd drop-in with `EnvironmentFile=/etc/wacrm/cron.env`
(mode `0600`) over putting the secret in the unit file, since unit
files are world-readable.

### Windows — Task Scheduler

```powershell
$secret = 'REPLACE_WITH_SECRET'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -Command `"Invoke-RestMethod -Uri 'https://crm.example.com/api/automations/cron' -Headers @{'x-cron-secret'='$secret'} -TimeoutSec 55`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'wacrm-automations-cron' `
  -Action $action -Trigger $trigger -Description 'Drain wacrm automation wait steps'
```

Repeat with a 5-minute interval for `/api/flows/cron`.

### Docker Compose — sidecar

No host cron needed; a tiny loop container is enough:

```yaml
services:
  app:
    build: .
    env_file: .env.local
    ports: ['3000:3000']

  cron:
    image: curlimages/curl:latest
    depends_on: [app]
    environment:
      AUTOMATION_CRON_SECRET: ${AUTOMATION_CRON_SECRET}
    entrypoint: >
      sh -c 'i=0; while true; do
        curl -fsS -m 55 -H "x-cron-secret: $$AUTOMATION_CRON_SECRET" http://app:3000/api/automations/cron || true;
        i=$$((i+1));
        [ $$((i % 5)) -eq 0 ] && curl -fsS -m 55 -H "x-cron-secret: $$AUTOMATION_CRON_SECRET" http://app:3000/api/flows/cron || true;
        sleep 60;
      done'
```

The sidecar talks to `app:3000` over the compose network, so the cron
endpoints never need to be reachable from the internet.

### GitHub Actions (works for any host, including serverless)

`.github/workflows/wacrm-cron.yml`:

```yaml
name: wacrm cron
on:
  schedule:
    - cron: '*/5 * * * *'   # GitHub's floor is 5 minutes, and it can lag
  workflow_dispatch:
jobs:
  drain:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -m 55 -H "x-cron-secret: ${{ secrets.AUTOMATION_CRON_SECRET }}" \
            "${{ vars.WACRM_BASE_URL }}/api/automations/cron"
          curl -fsS -m 55 -H "x-cron-secret: ${{ secrets.AUTOMATION_CRON_SECRET }}" \
            "${{ vars.WACRM_BASE_URL }}/api/flows/cron"
```

GitHub's scheduler has a 5-minute minimum and is best-effort under
load, so Wait steps can resume several minutes late. Acceptable for
hour/day-scale waits; use a real cron host if you need minute accuracy.

### Vercel and other serverless hosts

Vercel Cron **cannot send a custom header** — it calls your endpoint
with its own `Authorization: Bearer $CRON_SECRET`. These routes read
`x-cron-secret` only, so a plain `vercel.json` cron entry will get a
`401`. Either drive the endpoints from an external pinger (a cron host,
GitHub Actions, cron-job.org, Upstash QStash — anything that can set an
arbitrary header), or add your own thin route that Vercel Cron may call
and that forwards to these two with the right header.

---

## 8. Verify the setup

**Cron endpoints reachable and authenticated.** Three checks, three
distinct expected answers:

```bash
BASE=https://crm.example.com
SECRET=<your AUTOMATION_CRON_SECRET>

# 1. correct secret → 200
curl -i -H "x-cron-secret: $SECRET" "$BASE/api/automations/cron"
#    → 200 {"processed":0}

# 2. wrong secret → 401
curl -i -H "x-cron-secret: nope" "$BASE/api/automations/cron"
#    → 401 {"error":"Unauthorized"}

# 3. flows sweep
curl -i -H "x-cron-secret: $SECRET" "$BASE/api/flows/cron"
#    → 200 {"swept":0}
```

A `503 {"error":"cron not configured"}` means `AUTOMATION_CRON_SECRET`
isn't set **in the running process** — after editing `.env.local` you
must restart the server (or redeploy / `docker compose up -d`).

**End-to-end automation test.**

1. **Automations → New**, trigger **Keyword Match**, keyword `ping`,
   match type `contains`.
2. Steps: `Send Message` ("pong") → `Wait` 1 minute →
   `Send Message` ("second"). The Wait step is the point — it is what
   proves the cron drain works.
3. Activate it, then WhatsApp `ping` to your business number.
4. "pong" should arrive within seconds (that's the inbound webhook
   path). "second" arrives on the next cron tick after the minute
   elapses (that's the drain).
5. Open **Automations → <your automation> → Logs** for the per-step
   result. Server logs prefix engine failures with `[automations]`.

If "pong" never arrives, the problem is the webhook (step 6). If "pong"
arrives but "second" never does, the problem is the cron (step 7).

---

## 9. Which triggers fire from what

Worth reading before you design an automation — not every trigger in
the builder is driven by a scheduler.

"Inbound" below means either transport: the Meta webhook
(`/api/whatsapp/webhook`) for a Cloud API project, or the QR gateway
posting to `/api/channels/qr/events`, which runs the same ingest
pipeline (`src/lib/inbound/ingest.ts`). Both dispatch automations, so a
QR-paired number fires the same triggers as a Cloud API one.

| Trigger | Fired by |
| --- | --- |
| `new_message_received` | Inbound message |
| `first_inbound_message` | Inbound — contact's first-ever customer-sent message (includes manually imported contacts) |
| `new_contact_created` | Inbound — only when ingest just auto-created the contact row |
| `keyword_match` | Inbound, matched against message text (`exact` / `contains`, optional case sensitivity) |
| `interactive_reply` | Inbound — exact match on the tapped button / list-row id. Skipped when a Flow consumed the reply |
| `tag_added` | Any tag add that goes through the tag-event path: the dashboard, `POST /api/contacts/{id}/tags`, the public API's contact tag sync, or a Flow's add-tag step. Chain depth is capped to stop tag loops |
| `conversation_assigned` | **Not dispatched by the app today.** The trigger type and its UI exist, but no code path fires it |
| `time_based` | **Has no scheduler.** The builder accepts and validates a cron expression, but nothing in the app reads it — see below |

`time_based` is the one to watch: activating such an automation
requires a `schedule` and looks correct in the UI, but no cron reads
that field. The cron endpoints in step 7 drain Wait steps and sweep
flow runs; neither dispatches `time_based`. To run one on a schedule
you have to call the dispatch endpoint yourself (next section).

---

## 10. Triggering automations from another machine

**`POST /api/automations/engine`** dispatches any trigger type on
demand:

```jsonc
{
  "trigger_type": "time_based",
  "contact_id": "<uuid, optional>",
  "context": { "message_text": "…" }   // optional; keyword/tag matching reads this
}
```

Two constraints to plan around:

- **Auth is session-cookie based** (`requireRole('agent')` → Supabase
  SSR cookies), and requires the `agent` role or higher. An API key
  will *not* authenticate this route, so an unattended scheduler can't
  call it without a browser session. Treat it as a manual test hook, or
  add your own secret-header route that calls
  `runAutomationsForTrigger` directly.
- `contact_id` is verified to belong to the caller's account before any
  step runs; a foreign id is refused silently.

**The API-key-friendly path is `tag_added`.** A key with
`contacts:write` can add a tag, and that dispatch runs through the same
tag-event code the dashboard uses:

```bash
curl -X PATCH "$BASE/api/v1/contacts/$CONTACT_ID" \
  -H "Authorization: Bearer wacrm_live_…" \
  -H 'Content-Type: application/json' \
  -d '{"tags":["vip","onboarding"]}'
```

`tags` **replaces** the contact's tag set; each newly added tag fires
`tag_added`. So the durable pattern for "trigger a wacrm automation
from my own system" is: one automation per integration, triggered by a
dedicated tag, and your script adds that tag. Create the key under
**Settings → API keys** (admin/owner only; the full key is shown once).
See [`docs/public-api.md`](./public-api.md) for the rest of the API.

---

## 11. Troubleshooting

| Symptom | Cause |
| --- | --- |
| **Projects / Automations / Inbox missing from the sidebar after a fresh deploy** | The first user is `platform_role='customer'`. `handle_new_user()` never sets it, and migrations 047/050 only promote pre-existing profiles — none exist on a new database. Run the promotion in DEPLOYMENT.md §7 step 2 |
| `503 {"error":"cron not configured"}` | `AUTOMATION_CRON_SECRET` not set in the running process — set it and restart |
| `401 {"error":"Unauthorized"}` from a cron endpoint | Header name must be exactly `x-cron-secret`; value must match byte-for-byte (length included) |
| Meta webhook verification returns 403 | No stored verify token decrypts to the submitted value — re-save it in Settings → WhatsApp, or `ENCRYPTION_KEY` changed after it was saved |
| Automation logs show a run with **zero steps** | Historically a fire-and-forget dispatch being frozen mid-run; make sure you're on current `master` |
| Automation stops at the Wait step, forever | The cron drain isn't running, or `/api/automations/cron` returns non-200. Check `curl -f` exit status in your cron log |
| A contact stopped triggering flows entirely | A stale `active` flow run holds the one-active-run-per-contact index. `/api/flows/cron` clears it |
| Wait steps resume minutes late | Expected on GitHub Actions (5-minute floor, best-effort). Use host cron or a systemd timer for minute accuracy |
| Time-based automation never fires | By design today — no dispatcher exists. See sections 9 and 10 |
| `EBADENGINE` warnings on `npm ci` | Node version outside some deps' declared range. Move to Node 22.13+ or 24 LTS |
| Dev server unreachable through a tunnel | Add the tunnel hostname to `ALLOWED_DEV_ORIGINS` |

---

## Checklist

```
[ ] Node 22.13+ / 24, repo cloned, `npm ci` clean
[ ] supabase/migrations/*.sql applied in order (NOT combined_migrations.sql)
[ ] automation_*, flow_*, projects and whatsapp_sessions tables present
[ ] .env.local has all 6 required vars — including AUTOMATION_CRON_SECRET
[ ] App reachable over public HTTPS
[ ] A channel connected: Cloud API credentials saved, or a QR number paired
[ ] Cloud API only: Meta callback URL verified AND `messages` field subscribed
[ ] /api/automations/cron scheduled every minute — 200 {"processed":N}
[ ] /api/flows/cron scheduled every 5 minutes — 200 {"swept":N}
[ ] Keyword + Wait automation tested end to end, both messages received
```
