# wacrm QR gateway

Holds one WhatsApp Web socket per **project** so a customer can connect a
number by scanning a QR code, instead of going through Meta's Cloud API.

## Why this is a separate service

A QR login is not a request/response API call. It is a WebSocket to
WhatsApp's servers that must stay open for the life of the pairing —
weeks or months — answering keepalives and receiving pushes. If nothing
holds the socket, the number goes offline.

That rules out the obvious places to put it:

| Host | Works? | Why |
| --- | --- | --- |
| **VPS with Docker** (Hostinger KVM 2+, Hetzner, DigitalOcean) | **Yes — recommended** | An always-on process is exactly what it needs. |
| Fly.io / Railway / Render (machine or worker, *not* serverless) | Yes | Same, with easier scaling. |
| Shared / cPanel hosting | No | Idle processes are killed; persistent outbound sockets are usually disallowed. |
| Vercel / Netlify / any serverless | No | Function invocations are short-lived by design. |
| Supabase Edge Functions | No | Short-lived request handlers. Supabase is the right place for the *data*, not the socket. |

The Next.js app itself is perfectly happy on serverless. Only this
service needs a long-lived process.

**Sizing:** roughly 150–250 MB base plus 60–100 MB per active session.
Budget ~2 GB RAM for 15–20 concurrent sessions and measure — usage
varies with message volume. No persistent disk is required: session
credentials round-trip through Supabase.

## How it fits together

```
  Browser ──── Supabase Realtime ────┐   (QR + status, read-only)
     │                               │
     │ HTTPS                    whatsapp_sessions
     ▼                               ▲
  Next.js app ── signed HTTP ──► GATEWAY ──── WebSocket ──► WhatsApp
     ▲                               │
     └──── signed HTTP (inbound) ────┘
```

Two things worth noting:

- **The browser never talks to this service.** The gateway writes QR
  codes and connection state into `whatsapp_sessions`; the pairing UI
  reads that over Supabase Realtime. So there is no CORS surface, no
  browser-facing auth, and the gateway can live on a private network.
- **Inbound messages go back through the CRM**, not straight into the
  database. `POST /api/channels/qr/events` runs the same ingest
  pipeline the Meta webhook uses — contact dedup, conversation upsert,
  automations, flows, AI auto-reply, outbound webhooks. Writing rows
  from here would mean a second copy of that pipeline, silently
  diverging.

## Security model

This process holds the Supabase **service-role key** and credentials
that can send messages as a customer's own WhatsApp number. Treat it
accordingly.

- **Inbound auth is two-layered**: a bearer token, plus an HMAC-SHA256
  signature over the raw body with the timestamp inside the signed
  message (so a captured request cannot be replayed).
- **Tenancy is code-enforced**, because the service role bypasses RLS.
  Sessions live in a `Map` keyed by `project_id`; every Supabase query
  names its `project_id`; media uploads go to that project's own
  storage prefix. The `projectId` in the URL must match the one inside
  the signed body, so a tampered path is rejected.
- **The CRM never forwards a client-supplied project id** — it resolves
  the project from the user's session and re-checks membership first.
- **Session credentials are encrypted at rest** (AES-256-GCM) in
  `whatsapp_session_keys`, a table with RLS on and *zero* policies:
  `anon` and `authenticated` cannot read it at all, only `service_role`.

## Running it

```bash
cp .env.example .env     # then fill it in
npm install
npm run dev              # or: npm run build && npm start
```

Both scripts load `.env` via Node's `--env-file-if-exists`, which needs
Node 20.12+ (hence `engines`). There is no dotenv dependency: under
Docker the file is absent and compose supplies the environment
directly, and `--env-file-if-exists` skips a missing file rather than
failing. Real environment variables always win over the file.

`GATEWAY_INSTANCE_ID` must be **unique per running process**. Two
gateways sharing an id both try to own the same session rows on boot,
and WhatsApp treats two sockets on one number as conflicting devices
and drops both. When running a local copy alongside a deployed one,
give the local process its own id — do not leave the `gateway-1` from
`.env.example`.

With Docker, from the repo root:

```bash
docker compose up -d --build
```

`ENCRYPTION_KEY` **must** be byte-identical to the Next app's. Both
sides read and write the same encrypted credentials; a mismatch makes
every stored session unreadable and forces every customer to re-scan.

Set these in the Next app to point it at the gateway:

```
WHATSAPP_GATEWAY_URL=http://gateway:8088
WHATSAPP_GATEWAY_TOKEN=<same as GATEWAY_API_TOKEN>
WHATSAPP_GATEWAY_SIGNING_SECRET=<same as GATEWAY_SIGNING_SECRET>
WHATSAPP_GATEWAY_WEBHOOK_SECRET=<same as GATEWAY_WEBHOOK_SECRET>
```

## API

Server-to-server only. Every route needs both the bearer token and a
valid signature.

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness. The only unauthenticated route; exposes a session count and nothing else. |
| `POST /v1/sessions/:projectId/connect` | Begin (or restart) pairing. The QR arrives via `whatsapp_sessions`, not in the response. |
| `GET /v1/sessions/:projectId` | Current in-memory status. |
| `DELETE /v1/sessions/:projectId` | Log out and destroy stored credentials. |
| `POST /v1/sessions/:projectId/messages` | Send text or media. |

## Operating notes

- **Run one instance** until you outgrow it. Two instances must never
  open a socket for the same project — WhatsApp reads that as
  conflicting devices and can drop both. `whatsapp_sessions.gateway_instance`
  records the owner; sharding by `project_id` is the path to more.
- **Restarts are cheap.** Credentials live in Supabase, so a redeploy
  costs a reconnect, not a re-scan. `restoreSessions()` reopens
  whatever was live on boot.
- **Watch `heartbeat_at`.** A session whose status says `connected` but
  whose heartbeat is stale is actually down. Alert on that rather than
  on `status`.
- **`logged_out` needs a human.** The phone unlinked us; credentials
  are destroyed and the customer must scan again. Surface it — a
  silently dead number is worse than an error.

## Limits of the QR channel

These are properties of WhatsApp Web, not of this implementation:

- **Ban risk.** WhatsApp's Business Terms prohibit unofficial clients.
  Numbers connected this way can be blocked, and bulk sending is the
  fastest way to trigger it. Rate-limit, warm new sessions up slowly,
  and think hard before enabling broadcasts on this channel.
- **No approved templates**, and no Cloud-API interactive messages. The
  CRM disables those controls for QR projects rather than failing at
  send time.
- **No history backfill.** A freshly paired session receives new
  messages only.
- **The phone must stay reachable** for the link to survive; an extended
  offline period ends the session.
- **Protocol churn.** Baileys tracks a moving target. Pin the version
  and expect periodic maintenance.
