# Deploying MaSa CRM

Two processes make up a deployment:

| Service | What it is | Where it can run |
| --- | --- | --- |
| **web** | The Next.js CRM | Anywhere — VPS, Vercel, any Node host |
| **gateway** | Holds one WhatsApp Web socket per QR project | **Only** a host that keeps a process alive: VPS, Fly.io, Railway, Render worker |

Plus a **Supabase** project for Postgres, Auth, Realtime and Storage.

The gateway is only needed if you use QR-code projects. On Cloud API
only, skip it entirely — the app runs without it and the QR screen
reports the gateway as unconfigured.

> **Why the gateway can't go on shared hosting or Supabase.** A QR login
> is a WebSocket to WhatsApp that must stay open for the life of the
> pairing — weeks. Shared/cPanel hosting kills idle processes; Supabase
> Edge Functions are short-lived request handlers; serverless platforms
> bill and terminate per invocation. Supabase is the right place for the
> session *credentials*, not the socket. See `gateway/README.md`.

---

## 1. Prerequisites

- **Node 20+** (or Docker, for the container path)
- A **Supabase** project — free tier is fine to start
- For QR: a host that runs an always-on process, ~2 GB RAM for 15–20
  concurrent sessions
- For Cloud API: a Meta app, a WhatsApp Business Account, and a phone
  number ID

---

## 2. Set up the database

### 2.1 Apply the schema

In the Supabase dashboard → **SQL Editor**, run these **in order**:

1. `combined_migrations.sql` — the flattened schema through migration 036
2. Then each file from `supabase/migrations/` from `037` upward, in
   numeric order:

```
037_fix_table_permissions.sql
038_fix_table_permissions.sql
039_fix_table_permissions.sql
040_fix_table_permissions.sql
041_projects.sql            ← projects + is_project_member()
042_project_scoping.sql     ← project_id on every table + backfill
043_project_rls.sql         ← RLS moves onto the project boundary
044_qr_sessions.sql         ← QR session + credential tables
045_project_id_backstop.sql ← transitional guard, see §7
```

Every migration is **idempotent** — safe to re-run. Order matters:
042 depends on 041, 043 on 042.

**Upgrading an instance that already runs 001–040** (it has `accounts`
but no `projects`) — everything from 041 on, concatenated in dependency
order, ready to paste into the SQL Editor:

```
supabase/apply_041_045.sql
```

Idempotent, and non-destructive to existing data: 042 creates one
"Default" project per account and moves every existing row into it, so
nothing changes behaviourally until you create a second project.

**If a run appears to do nothing:** the SQL Editor executes a whole
script in ONE transaction, so a single error anywhere rolls back all
five migrations and the database looks untouched. Scroll up in the
Editor output for the *first* error. `supabase/preflight_041_045.sql`
is read-only and reports what would block — orphan rows the backfill
cannot place, duplicates the new unique indexes would reject, and
whether your role may alter the realtime publication and
`storage.objects`.

Check what you are missing before running anything:

```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('accounts','projects','whatsapp_sessions');
```

`accounts` present but `projects` absent → run `apply_041_045.sql`.

With the Supabase CLI instead:

```bash
supabase link --project-ref <your-ref>
supabase db push
```

### 2.2 Enable the vector extension

`ai_knowledge_chunks` needs pgvector. Supabase → **Database** →
**Extensions** → enable `vector`. (Usually on by default.)

### 2.3 Verify tenant isolation

Optional but recommended before you put customer data in — it proves
the RLS boundary rather than assuming it. Runs against a throwaway
local Postgres, never your real project:

```bash
docker run -d --name MaSa CRM-pgtest \
  -e POSTGRES_PASSWORD=pw -p 55433:5432 pgvector/pgvector:pg16
sleep 8   # let it finish starting, or the first psql silently no-ops

export PGPASSWORD=pw
PSQL="psql -h localhost -p 55433 -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -f supabase/tests/00_scaffold.sql
$PSQL -f combined_migrations.sql
for f in 037 038 039 040 041 042 043 044 045; do
  $PSQL -f supabase/migrations/${f}_*.sql
done
psql -h localhost -p 55433 -U postgres -f supabase/tests/01_isolation.sql
```

Expect 26 `pass:` lines and `ALL ISOLATION ASSERTIONS PASSED`. Clean up
with `docker rm -f MaSa CRM-pgtest`. Details in `supabase/tests/README.md`.

---

## 3. Generate secrets

```bash
# 64 hex chars. Encrypts WhatsApp tokens AND QR session credentials.
openssl rand -hex 32          # → ENCRYPTION_KEY

# Gateway auth — three independent secrets.
openssl rand -hex 32          # → GATEWAY_API_TOKEN
openssl rand -hex 32          # → GATEWAY_SIGNING_SECRET
openssl rand -hex 32          # → GATEWAY_WEBHOOK_SECRET
```

**`ENCRYPTION_KEY` is the one to never lose or change.** Both the web
app and the gateway encrypt with it. Rotate it and every stored Meta
token becomes undecryptable and every paired WhatsApp number must be
re-scanned. Back it up somewhere you would not lose your database.

---

## 4. Configure environment

Create `.env` at the repo root (compose reads it automatically):

```bash
# ---- Supabase (Project Settings → API) ----
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...        # secret — bypasses RLS

# ---- App ----
NEXT_PUBLIC_SITE_URL=https://crm.example.com
ENCRYPTION_KEY=<64 hex chars>

# ---- Meta Cloud API (only for cloud_api projects) ----
META_APP_SECRET=<from Meta → App Settings → Basic>

# ---- QR gateway (only for qr projects) ----
GATEWAY_API_TOKEN=<hex>
GATEWAY_SIGNING_SECRET=<hex>
GATEWAY_WEBHOOK_SECRET=<hex>
```

Two things worth knowing:

- **`NEXT_PUBLIC_*` are compiled into the browser bundle at build
  time.** Change one and you must **rebuild** the image, not just
  restart it. The Dockerfile fails fast if the Supabase ones are
  missing, so you get an error at build rather than a broken app.
- The web container derives its own `WHATSAPP_GATEWAY_*` values from
  the `GATEWAY_*` ones via `docker-compose.yml`. Running the two
  services separately (not via compose)? Set on the web side:
  `WHATSAPP_GATEWAY_URL`, `WHATSAPP_GATEWAY_TOKEN`,
  `WHATSAPP_GATEWAY_SIGNING_SECRET`, `WHATSAPP_GATEWAY_WEBHOOK_SECRET`
  — matching the gateway's `GATEWAY_*` names.

---

## 5. Deploy

### Option A — one VPS, Docker Compose (recommended)

The shape most self-hosters want: both services on one box, the gateway
reachable only over the internal network.

```bash
git clone <your-fork> MaSa CRM && cd MaSa CRM
cp .env.example .env    # or create .env as in §4
nano .env

docker compose build    # ~3-5 min the first time
docker compose up -d

docker compose ps
curl -s localhost:3000 -o /dev/null -w '%{http_code}\n'   # → 200
docker compose exec gateway wget -qO- http://localhost:8088/health
```

The gateway has **no published port** — only `web` reaches it, over the
compose network. That is deliberate: its API is server-to-server and
has no business being exposed.

**Hostinger VPS specifically:** pick a KVM plan (not shared hosting),
Ubuntu 22.04+, then:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out and back in
```

Then the steps above.

### Option B — web on Vercel, gateway on a VPS

Fine, and a common split. On Vercel set every variable from §4 plus the
four `WHATSAPP_GATEWAY_*` values, with `WHATSAPP_GATEWAY_URL` pointing
at your gateway's public HTTPS URL. The gateway then **is** internet-
facing, so put it behind TLS (§6) and keep the bearer token secret —
its HMAC check is what stands between it and the open internet.

### Option C — no Docker

```bash
npm ci && npm run build && npm start            # web, port 3000
cd gateway && npm install && npm run build && npm start   # gateway, 8088
```

Use `systemd`, `pm2` or similar so both survive a reboot. `npm start`
alone does not.

---

## 6. TLS and reverse proxy

WhatsApp requires HTTPS for webhooks, and Supabase auth cookies need a
secure origin. Caddy is the shortest path:

```caddy
# /etc/caddy/Caddyfile
crm.example.com {
    reverse_proxy localhost:3000
}
```

`sudo systemctl reload caddy` — certificates are automatic.

nginx equivalent, if you prefer:

```nginx
server {
    server_name crm.example.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Then `sudo certbot --nginx -d crm.example.com`.

---

## 7. First run

1. **Create the first user.** Public signup is disabled by design
   (`src/proxy.ts` bounces `/signup`). Create the account in Supabase →
   **Authentication** → **Users** → *Add user*. The `handle_new_user`
   trigger creates their account, a Default project, and an owner
   profile automatically.

2. **Promote that user to `super_admin`. Required on every fresh
   install.** `handle_new_user()` does not set `platform_role`, so the
   profile takes the column default `'customer'` — and migrations 047
   and 050 only promote profiles that *already existed* when they ran,
   which on a new database is none. Leave this out and the owner of the
   instance cannot see the admin area at all: no **Projects**, no
   Customers, and `/pipelines`, `/automations`, `/flows`, `/agents`,
   `/inbox` and `/notifications` all redirect to `/dashboard`. Nothing
   errors — the app just looks half-built.

   ```sql
   update profiles
   set    platform_role = 'super_admin'
   where  account_role = 'owner'
     and  platform_role = 'customer';

   -- confirm
   select email, account_role, platform_role from profiles order by created_at;
   ```

   This is migration 050's step 1 re-run; it is idempotent. There is no
   UI or API path for it — `/api/admin/*` already requires `super_admin`,
   so the first promotion has to be SQL.

3. **Sign in** at `https://crm.example.com/login`.

4. **Connect WhatsApp** — Settings → Projects (admin area; visible only
   after step 2):
   - **QR project:** click *Connect WhatsApp*, then scan the code from
     the phone (WhatsApp → Settings → Linked devices → Link a device).
     The code refreshes every ~20s until scanned.
   - **Cloud API project:** Settings → WhatsApp, enter the phone number
     ID, WABA ID and access token.

5. **Meta webhook** (Cloud API only). In the Meta app dashboard set the
   callback URL to `https://crm.example.com/api/whatsapp/webhook`, use
   the verify token you saved in the config form, and subscribe to
   `messages`.

### A note on migration 045

`045_project_id_backstop.sql` is a **transitional** trigger. It fills
`project_id` when an INSERT omits it and the account has exactly one
project, and raises a clear error when the account has several. Every
application call site now sets `project_id` explicitly, so nothing
depends on it — it stays as a safety net for third-party scripts and
direct SQL. Removing it is safe once you are confident nothing else
writes to these tables; the file documents how.

---

## 8. Operating

**Health checks**

```bash
curl -fsS https://crm.example.com/ -o /dev/null && echo web ok
docker compose exec gateway wget -qO- http://localhost:8088/health
```

**Watch session liveness.** A QR session whose `status` says
`connected` but whose `heartbeat_at` is stale is actually down. Alert on
the heartbeat, not the status:

```sql
select project_id, status, heartbeat_at
from whatsapp_sessions
where status = 'connected'
  and heartbeat_at < now() - interval '5 minutes';
```

`status = 'logged_out'` needs a human — the phone unlinked the device
and only a re-scan fixes it.

**Upgrades**

```bash
git pull
# Apply any new supabase/migrations/*.sql in the SQL editor first.
docker compose build && docker compose up -d
```

Restarts are cheap for the gateway: credentials live in Supabase, so a
redeploy costs a reconnect, not a re-scan.

**Backups.** Supabase handles Postgres backups on paid plans. Separately
back up `ENCRYPTION_KEY` — without it, a database backup is useless for
WhatsApp tokens and sessions.

**Scaling the gateway.** Run **one** instance until you outgrow it. Two
instances must never open a socket for the same project — WhatsApp
reads that as conflicting devices and can drop both.
`whatsapp_sessions.gateway_instance` records the owner; sharding by
`project_id` is the path beyond one box.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Client-side queries fail; Supabase URL is `undefined` in the browser | `NEXT_PUBLIC_*` missing at image build | Rebuild with the build args — `docker compose build`, not just `up` |
| `Your profile is not linked to an account` | The signup trigger didn't run (user pre-dates it, or was inserted by hand) | Re-run `042`, which recreates `handle_new_user`; create the user through Supabase Auth |
| `No active project` | An agent/viewer with no project assignment | Settings → Projects → assign them |
| Login redirects in a loop | `NEXT_PUBLIC_SITE_URL` doesn't match the real origin, or cookies aren't `Secure` over plain HTTP | Fix the URL and terminate TLS |
| QR never appears | Gateway unreachable, or its env is incomplete | `docker compose logs gateway`; the process refuses to start on a missing var |
| `The stored access token cannot be decrypted` | `ENCRYPTION_KEY` changed between environments | Restore the original key, or reset the config and re-enter credentials |
| Session flips to `logged_out` repeatedly | Two gateway instances fighting over one project | Run one instance; check `gateway_instance` |
| `Ambiguous project_id for <table>` | A direct SQL/script INSERT omitted `project_id` on a multi-project account | Add `project_id` to that write (see §7) |
| `Could not find the table 'public.<name>' in the schema cache` (PGRST205) | The migration hasn't been applied, or PostgREST's cache is stale | Apply the missing migration (§2.1). If the table exists but the error persists, refresh the cache: Supabase → API Docs → *Reload schema*, or `NOTIFY pgrst, 'reload schema';` |
| Inbound Cloud API messages don't arrive | Webhook URL, verify token, or `messages` subscription wrong | Re-check the Meta dashboard; `docker compose logs web` |

**Logs**

```bash
docker compose logs -f web
docker compose logs -f gateway
```

The gateway redacts credentials from its output — never paste
`whatsapp_session_keys` contents into an issue.

---

## 10. If credentials have been committed

`.env.local` was tracked in git in this repository's history (commits
`885114b`, `0b60693`, `9748e17`) before being untracked. **Removing a
file from the working tree does not remove it from history** — anyone
with access to the repo can still read those commits.

If that applies to you, rotate in this order:

1. **`SUPABASE_SERVICE_ROLE_KEY`** — Supabase → Project Settings → API →
   *Reset*. Highest priority: this key bypasses RLS entirely and grants
   read/write over every tenant's data. Update the value everywhere
   (web env, gateway env) immediately after resetting.

2. **`META_APP_SECRET`** — Meta → App Settings → Basic → *Reset*. Then
   update the env; inbound webhook verification fails closed until you
   do, so do it in a maintenance window.

3. **`ENCRYPTION_KEY`** — think before rotating. It decrypts every
   stored Meta token and every QR session credential, so changing it
   *destroys access to both*. The recovery path is: rotate the key,
   then have each project re-enter its Cloud API credentials and
   re-scan its QR code. If the repo is private and access is limited to
   people who would legitimately hold this key anyway, keeping it may
   be the lesser risk — that is a judgement call about who could read
   those commits.

Purging the values from history (`git filter-repo`, or BFG) additionally
requires a force-push and coordination with everyone who has a clone.
Rotation is what actually revokes access; history rewriting only tidies
up afterwards.

## 11. Security checklist

- [ ] `SUPABASE_SERVICE_ROLE_KEY` is set **only** on the server and the
      gateway — never in a `NEXT_PUBLIC_*` variable
- [ ] `ENCRYPTION_KEY` backed up separately from the database
- [ ] The three `GATEWAY_*` secrets are distinct random values, not
      copies of each other
- [ ] The gateway port is not published to the internet (Option A), or
      is behind TLS with the bearer token secret (Option B)
- [ ] TLS terminates in front of the web app
- [ ] `.env` is not committed — confirm with `git check-ignore .env`
      (should print `.env`; if it prints nothing, the ignore rule is
      missing and you are one `git add .` away from leaking secrets)
- [ ] Any credential that reached git history has been rotated (§10)
- [ ] Tenant isolation verified (§2.3) before real customer data lands
- [ ] Customers on QR projects have been told that WhatsApp's Business
      Terms prohibit unofficial clients and their number can be banned
