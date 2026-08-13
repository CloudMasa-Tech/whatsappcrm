# QR sessions + org/project multi-tenancy — design & migration plan

Status: **proposal, awaiting approval**. No code written yet.
Target repo state: `master` @ `885114b`, wacrm 0.8.0, Next 16.2.12, Supabase.

---

## 1. Decisions locked

| Decision | Choice |
| --- | --- |
| Organisation | The existing `accounts` table **is** the organisation. No new table above it. |
| Project | **New level beneath the organisation.** Each project owns its own WhatsApp session *and* its own contacts, conversations, pipelines, flows, broadcasts, automations. Sibling projects cannot see each other. |
| Channels | **Both.** Cloud API and QR coexist; a project declares which one it uses. |
| QR runtime | Standalone Node gateway service using Baileys (see §5 for the hosting constraint). |
| This document | Design + migration plan only. Implementation follows approval. |

Isolation requirement, restated precisely: a user belonging to organisation **A** must not be able to read or write any row belonging to organisation **B**, *and* a user scoped to project **P1** must not read or write rows belonging to project **P2** even when P1 and P2 are in the same organisation.

---

## 2. Where the code stands today

Facts established by reading the repo, not assumptions.

**Tenancy is single-level.** Migration `017_account_sharing.sql` introduced `accounts` and rewrote every policy to `is_account_member(account_id, min_role)` with the role ladder `owner > admin > agent > viewer`. `accounts` carries a unique index on `owner_user_id` — one account per owner. Membership lives on `profiles.account_id` + `profiles.account_role`; there is no memberships table.

**15 tables carry `account_id` from 017** (contacts, tags, custom_fields, contact_notes, conversations, whatsapp_config, message_templates, pipelines, deals, broadcasts, automations, automation_logs, automation_pending_executions, flows, flow_runs), and migrations 026–035 added more account-scoped tables (api_keys, webhook_endpoints, notifications, ai_configs, ai_knowledge_documents, ai_knowledge_chunks, ai_usage_log, quick_replies).

**Child tables inherit scope through a parent `EXISTS` check** rather than carrying `account_id`: `messages`, `contact_tags`, `contact_custom_values`, `pipeline_stages`, `broadcast_recipients`, `automation_steps`, `flow_nodes`, `flow_run_events`, `message_reactions`.

**One WhatsApp number per tenant is a hard constraint today.** 017 swapped `whatsapp_config.UNIQUE(user_id)` for `UNIQUE(account_id)`. `src/app/api/whatsapp/config/route.ts` additionally uses a service-role query to reject a `phone_number_id` already claimed by another account.

**The transport is Meta Cloud API, end to end.** Outbound flows through `src/lib/whatsapp/meta-api.ts` (Graph API + `phone_number_id` + encrypted access token) via `src/lib/whatsapp/send-message.ts`. Inbound arrives at `src/app/api/whatsapp/webhook/route.ts`, which is also where the whole post-ingest pipeline fires: automations engine, flows engine, AI auto-reply, outbound webhooks, template status updates.

**Scale of the change:** `account_id` / `accountId` appears **589 times across 111 files** in `src/`. About **30 files use the service-role client**, which bypasses RLS entirely — those are the ones where project scoping must be enforced by hand.

Three isolation-relevant details that will matter later:

1. `src/hooks/use-realtime.ts` subscribes to `postgres_changes` on `messages` and `conversations` **with no filter at all** — it relies purely on RLS. Once two projects share an organisation, every member would receive change events for both projects.
2. Storage paths are account-scoped only: `chat-media/account-<account_id>/<file>` and the matching `storage.objects` policies in migration 020 key off `(storage.foldername(name))[1]`.
3. Dedup uniqueness is account-keyed: `idx_contacts_account_phone_normalized` (022) and `idx_conversations_account_contact` (036).

**Note on `AGENTS.md`:** the repo instructs reading `node_modules/next/dist/docs/` before writing code, and `node_modules` is not installed in this checkout, so I could not consult it. This is a real blocker for the implementation phase — this Next build already diverges visibly (middleware lives in `src/proxy.ts` exporting `proxy()`, not `middleware.ts`). Phase 0 installs deps and reads those docs before any app code is written.

---

## 3. Target architecture

```
                    ORGANISATION  (= accounts row)
                            │
            ┌───────────────┼───────────────┐
       PROJECT P1       PROJECT P2      PROJECT P3
      channel: qr      channel: qr    channel: cloud_api
            │               │               │
   ┌────────┴────┐  ┌───────┴─────┐   ┌─────┴──────┐
   │ own contacts│  │ own contacts│   │own contacts│
   │ own convos  │  │ own convos  │   │own convos  │
   │ own flows   │  │ own flows   │   │own flows   │
   └────────┬────┘  └───────┬─────┘   └─────┬──────┘
            │               │               │
   ══════════════ RLS boundary: is_project_member() ══════════════
            │               │               │
   ┌────────┴───────────────┴────┐    ┌─────┴─────────┐
   │   QR GATEWAY (Node, always- │    │  Meta Graph   │
   │   on). One Baileys socket   │    │  Cloud API    │
   │   per project, keyed by     │    └───────────────┘
   │   project_id. Creds in      │
   │   Supabase, AES-GCM.        │
   └─────────────────────────────┘
```

Two data paths worth naming up front:

- **QR delivery to the browser goes through Supabase, not the gateway.** The gateway writes the QR string into `whatsapp_sessions` with the service role; the UI reads it over Supabase Realtime filtered on `project_id`. The browser never talks to the gateway, so the gateway needs no CORS, no public browser-facing auth, and can sit behind a private network if you want.
- **Inbound messages from both channels converge on one function.** The processing half of the Meta webhook route gets extracted into `src/lib/inbound/ingest.ts`, so automations / flows / AI reply / webhooks behave identically regardless of channel.

---

## 4. Part A — data model and isolation

### 4.1 New tables (migration `041_projects.sql`)

```sql
CREATE TABLE IF NOT EXISTS projects (
  id           UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  channel_type TEXT NOT NULL DEFAULT 'qr'
               CHECK (channel_type IN ('qr', 'cloud_api')),
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, slug)
);

-- Composite target so child rows can *prove* their project and account
-- agree. Without this, a bug could write project_id=P2 / account_id=A1
-- and the row would be invisible to one check and visible to the other.
CREATE UNIQUE INDEX IF NOT EXISTS projects_id_account_id_key
  ON projects (id, account_id);

-- Who may see which project. Empty roster = admin+ only.
CREATE TABLE IF NOT EXISTS project_members (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, user_id)
);
```

Access rule (proposed default, flag if you want it different): **owner/admin see every project in their organisation; agent/viewer see only projects they are explicitly assigned to.** That gives you customer-facing isolation for free and intra-org isolation as an opt-in.

### 4.2 The membership helper

```sql
CREATE OR REPLACE FUNCTION role_rank(r account_role_enum) RETURNS INT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE r WHEN 'owner' THEN 4 WHEN 'admin' THEN 3
                WHEN 'agent' THEN 2 WHEN 'viewer' THEN 1 END;
$$;

CREATE OR REPLACE FUNCTION is_project_member(
  target_project_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM projects pr
    JOIN profiles p ON p.account_id = pr.account_id
    WHERE pr.id       = target_project_id
      AND p.user_id   = auth.uid()
      AND pr.archived_at IS NULL
      AND role_rank(p.account_role) >= role_rank(min_role)
      AND (
        role_rank(p.account_role) >= role_rank('admin')
        OR EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id = pr.id AND pm.user_id = p.user_id
        )
      )
  );
$$;

ALTER FUNCTION is_project_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_project_member(UUID, account_role_enum)
  TO authenticated, service_role;
```

The org check is implicit: the `projects → profiles` join on `account_id` means a project in another organisation can never match. Cross-org isolation therefore holds even if the project-membership roster is misconfigured.

### 4.3 Adding `project_id` (migration `042_project_scoping.sql`)

Every table that carries `account_id` today gets `project_id`, plus `messages` (denormalised — needed for Realtime filtering, which can only filter on the row's own columns):

```sql
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS project_id UUID;
-- …repeat for the ~22 project-scoped tables…

-- Backfill: one Default project per existing account.
INSERT INTO projects (account_id, name, slug, channel_type)
SELECT a.id, 'Default', 'default', 'cloud_api' FROM accounts a
ON CONFLICT (account_id, slug) DO NOTHING;

UPDATE contacts c SET project_id = pr.id
  FROM projects pr
 WHERE pr.account_id = c.account_id AND pr.slug = 'default'
   AND c.project_id IS NULL;
-- …repeat per table; messages backfill joins through conversations…

ALTER TABLE contacts ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_project_account_fk
  FOREIGN KEY (project_id, account_id)
  REFERENCES projects (id, account_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_contacts_project ON contacts (project_id);
```

Then re-key the constraints that assume one tenant = one number = one contact namespace:

| Existing | Becomes |
| --- | --- |
| `whatsapp_config UNIQUE(account_id)` | `UNIQUE(project_id)` |
| `idx_contacts_account_phone_normalized` (022) | keyed on `(project_id, phone_normalized)` |
| `idx_conversations_account_contact` (036) | keyed on `(project_id, contact_id)` |
| `flow_runs` one-active-run index `(account_id, contact_id)` | `(project_id, contact_id)` |

Consequence to accept consciously: **the same phone number in two projects becomes two contact rows with two conversation threads.** That is what full isolation means; the alternative (org-wide contact identity) leaks the existence of a contact across projects.

### 4.4 Policy rewrite (migration `043_project_rls.sql`)

Mechanical swap, following 017's existing shape — operational data at `agent`, settings-class at `admin`:

```sql
DROP POLICY IF EXISTS contacts_select ON contacts;
CREATE POLICY contacts_select ON contacts
  FOR SELECT USING (is_project_member(project_id));
CREATE POLICY contacts_insert ON contacts
  FOR INSERT WITH CHECK (is_project_member(project_id, 'agent'));
-- …update / delete likewise; ~22 tables × 4 policies…
```

Child tables keep the parent-`EXISTS` pattern, retargeted:

```sql
CREATE POLICY pipeline_stages_select ON pipeline_stages FOR SELECT USING (
  EXISTS (SELECT 1 FROM pipelines p
           WHERE p.id = pipeline_stages.pipeline_id
             AND is_project_member(p.project_id))
);
```

Untouched (organisation-level by nature): `accounts`, `profiles`, `account_invitations`, `member_presence`, `notifications`.

### 4.5 Session tables (migration `044_qr_sessions.sql`)

```sql
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id            UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  project_id    UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  account_id    UUID NOT NULL,
  status        TEXT NOT NULL DEFAULT 'disconnected'
                CHECK (status IN ('disconnected','qr_pending','connecting',
                                  'connected','logged_out','banned','error')),
  qr_code       TEXT,          -- transient; cleared the moment we connect
  qr_expires_at TIMESTAMPTZ,
  phone_number  TEXT,          -- E.164 of the linked device
  wa_jid        TEXT,
  last_connected_at    TIMESTAMPTZ,
  last_disconnected_at TIMESTAMPTZ,
  last_error    TEXT,
  gateway_instance TEXT,       -- which gateway node owns this socket
  heartbeat_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (project_id, account_id)
    REFERENCES projects (id, account_id) ON DELETE CASCADE
);

ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_sessions_select ON whatsapp_sessions
  FOR SELECT USING (is_project_member(project_id));
-- No INSERT/UPDATE/DELETE policy: only the gateway (service role) writes.
-- Users act through API routes, never by writing this table directly.
```

Baileys auth state — the actual credential material — lives in a table **no client role can reach**:

```sql
CREATE TABLE IF NOT EXISTS whatsapp_session_keys (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key_type   TEXT NOT NULL,   -- 'creds' | 'pre-key' | 'session' | 'app-state-sync-key' | …
  key_id     TEXT NOT NULL,
  payload    TEXT NOT NULL,   -- AES-256-GCM via src/lib/whatsapp/encryption.ts
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, key_type, key_id)
);

ALTER TABLE whatsapp_session_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON whatsapp_session_keys FROM anon, authenticated;
-- RLS enabled with ZERO policies = deny-all for anon/authenticated.
-- service_role bypasses RLS, so only the gateway can read or write it.
```

Reuse of the existing `ENCRYPTION_KEY` and `encrypt()/decrypt()` helpers means a database dump alone does not yield usable WhatsApp sessions. Worth stating the blast radius plainly: these credentials let the holder send as your customer's number. They deserve the same handling as the Meta access tokens already in `whatsapp_config`.

---

## 5. Part B — the QR gateway service

### 5.1 Why this cannot be shared hosting or Supabase

A QR login is not a request/response API call. It is a WebSocket to WhatsApp's servers that stays open continuously for the life of the pairing (weeks to months), replying to keepalives and receiving pushes. If the socket dies, the session survives in the credentials but the number goes offline until a process reopens it; if the credentials are lost or the phone unlinks, the customer must re-scan.

That rules out three things:

- **Shared / cPanel-style hosting** — long-running processes are killed on idle, memory and process limits are tight, and outbound persistent connections are typically not permitted.
- **Supabase as the runtime** — Edge Functions are short-lived request handlers with an execution ceiling. Supabase is the right place for the credentials and the data; it cannot hold the socket.
- **Vercel / any serverless target for the gateway** — same reason. The Next.js app is perfectly happy on serverless; the gateway is not.

You need exactly one always-on Node process. That is the whole requirement — it is not large.

| Host | Verdict |
| --- | --- |
| **Hostinger VPS (KVM 2 or above), Docker Compose** | **Recommended.** Runs the Next app and gateway side by side; matches the Hostinger deploy path already in `.github/assets/`. |
| Fly.io / Railway / Render (worker or machine, not serverless) | Works well; easiest scaling story. |
| Hetzner / DigitalOcean droplet | Works; cheapest at volume. |
| Hostinger shared hosting, Vercel, Netlify, Supabase Edge | Not viable for the gateway. Fine for the Next app (except the gateway part). |

Sizing to plan against: roughly 150–250 MB base plus ~60–100 MB per active session, so budget ~2 GB RAM for 15–20 concurrent sessions and measure early — Baileys memory varies with message volume and group membership. No persistent disk is needed, since credentials round-trip through Supabase.

Scaling past one instance: shard by `project_id`, record the owning node in `whatsapp_sessions.gateway_instance`, and have the CRM route calls to that node. Two instances must never open a socket for the same project — WhatsApp will see conflicting device sessions. Single instance until you outgrow it is the honest recommendation.

### 5.2 Structure

New top-level `gateway/` directory, its own `package.json` and `Dockerfile`, deployed as a second container:

```
gateway/
  src/
    index.ts            # HTTP server (Hono or Fastify), health endpoint
    session-manager.ts  # Map<projectId, Session>; connect/disconnect/reap
    auth-state.ts       # Baileys AuthenticationState backed by Supabase
    handlers/
      inbound.ts        # socket events → normalised payload → CRM
      status.ts         # QR / connection state → whatsapp_sessions
      outbound.ts       # send text / media / reaction / read receipt
    security.ts         # HMAC verify, replay window, token check
    supabase.ts         # service-role client (gateway only)
  Dockerfile
```

`auth-state.ts` is the interesting piece: it implements Baileys' `AuthenticationState` interface against `whatsapp_session_keys` instead of the default `useMultiFileAuthState` on local disk. Credentials then survive redeploys and container replacement, and no session state lives on the filesystem.

### 5.3 API contract

CRM → gateway. Server-to-server only; never called from a browser.

```
POST   /v1/sessions/:projectId/connect     → { status, qr? }
DELETE /v1/sessions/:projectId             → logout + wipe credentials
GET    /v1/sessions/:projectId             → { status, phoneNumber, lastError }
POST   /v1/sessions/:projectId/messages    → { to, type, text|mediaUrl, caption }
                                           → { externalId }
GET    /health                             → { ok, sessions: n }
```

Every request carries `Authorization: Bearer <GATEWAY_API_TOKEN>` plus `X-Wacrm-Timestamp` and `X-Wacrm-Signature` (HMAC-SHA256 over timestamp + raw body), with a ±5 minute replay window.

Gateway → CRM: `POST /api/channels/qr/events`, signed the same way with a separate secret, carrying `{ projectId, type: 'message' | 'status' | 'receipt', payload }`. The CRM verifies the signature before touching the body. This mirrors the discipline already applied to Meta deliveries in `src/lib/whatsapp/webhook-signature.ts`.

### 5.4 Isolation inside the gateway

The gateway holds service-role credentials, so RLS does not protect it. Isolation is code-enforced:

1. Sessions live in a `Map` keyed by `project_id`; there is no API surface that returns or iterates another project's session.
2. `projectId` in the URL must equal the `projectId` inside the signed body — a mismatch is a 400, not a "trust the URL".
3. **The CRM never forwards a client-supplied `projectId`.** It resolves the active project server-side from the session cookie and re-checks `is_project_member` before calling the gateway. A browser that tampers with a project id gets a 403 at the CRM, and the gateway never sees it.
4. Every Supabase write from the gateway carries an explicit `project_id`; no query runs unscoped.
5. Media downloaded from WhatsApp uploads to `chat-media/account-<a>/project-<p>/…`, matching the new storage prefix in §6.

---

## 6. Part C — channel abstraction in the CRM

**Outbound.** A thin adapter interface, with `src/lib/whatsapp/send-message.ts` dispatching on `projects.channel_type`:

```ts
// src/lib/channels/types.ts
export interface ChannelAdapter {
  sendText(p: SendTextParams): Promise<{ externalId: string }>;
  sendMedia(p: SendMediaParams): Promise<{ externalId: string }>;
  sendTemplate?(p: SendTemplateParams): Promise<{ externalId: string }>;
  sendInteractive?(p: SendInteractiveParams): Promise<{ externalId: string }>;
}
```

`cloud-api.ts` wraps the existing `meta-api.ts` unchanged. `qr.ts` calls the gateway. The optional methods are the honest part of the design: **QR sessions have no approved templates and no Cloud-API interactive messages.** Calling them on a QR project raises a typed `SendMessageError('unsupported_on_channel')` that the UI surfaces as a disabled control with an explanation, rather than a runtime failure at send time.

**Inbound.** Extract the body of `src/app/api/whatsapp/webhook/route.ts` — contact resolution, dedup, conversation upsert, media handling, then the automations/flows/AI-reply/webhook fan-out — into `src/lib/inbound/ingest.ts` taking a normalised `InboundMessage` plus `projectId`. Both the Meta webhook (which resolves project via `whatsapp_config.phone_number_id → project_id`) and `/api/channels/qr/events` call it. One pipeline, two entry points; the engines need no channel awareness.

**Project context in the app.** New `src/lib/auth/project.ts` mirroring `src/lib/auth/account.ts`:

```ts
export async function getCurrentProject(): Promise<ProjectContext>;
export async function requireProjectRole(min: AccountRole): Promise<ProjectContext>;
```

The active project comes from a `wacrm_project` cookie, **always re-validated server-side** against `is_project_member` — a cookie is a hint, never an authorisation. Falls back to the user's first accessible project. Then every one of the ~589 `account_id` call sites gets audited: most become `project_id`, a few (member management, invitations, billing) stay org-level.

**UI:** project switcher in `src/app/(dashboard)/dashboard-shell.tsx`; `/settings/projects` for create / rename / archive / assign members; `/settings/channels` for the QR pairing flow (modal with live QR, countdown, connected state, disconnect, re-pair).

**Realtime:** `src/hooks/use-realtime.ts` gains `filter: 'project_id=eq.<id>'` on both subscriptions and a channel name scoped per project. This is why `messages` needs the denormalised `project_id`. Without this change, RLS still protects cross-org data, but an admin sitting in project P1 receives change events for P2 — a real leak within an organisation.

**Storage:** path becomes `account-<account_id>/project-<project_id>/<ts>-<name>.<ext>`; `buildMediaPath()` in `src/lib/storage/upload-media.ts` and the `storage.objects` policies from migration 020 both update to check the second path segment against project membership.

**Public API and MCP:** `api_keys` gains a `NOT NULL project_id` — a key authorises exactly one project, never a whole organisation. `src/lib/auth/api-context.ts` returns project context; `mcp-server/` inherits the scoping through the key with no change to its own logic.

---

## 7. Isolation verification — what "proven" means here

RLS policies are easy to write and easy to get subtly wrong, and ~30 files bypass them via the service role. The plan therefore includes an explicit verification pass, not just an implementation pass.

1. **Cross-tenant integration test suite.** Fixtures: org A with projects P1/P2, org B with project P3. For every project-scoped table, assert that a P1-scoped user reading and writing gets zero rows and a denial for P2 and P3. This is table-driven — one matrix, ~22 tables, both directions.
2. **Service-role audit.** Every file in the service-role list gets an explicit `.eq('project_id', …)`. The high-risk ones: `webhook/route.ts`, `flows/engine.ts`, `automations/engine.ts`, `ai/auto-reply.ts`, `send-message.ts`, `api-keys/store.ts`, `auth/api-context.ts`. Recommend a lint rule or a wrapper client that requires a project scope argument, so a future unscoped query fails at authoring time rather than in production.
3. **Realtime leak test.** Two browser sessions in one org, different projects; assert no cross-delivery.
4. **Storage test.** A P1 member cannot write to or delete under the P2 prefix.
5. **Gateway tests.** Signature required; replay rejected; URL/body `projectId` mismatch rejected; a session map lookup for an unknown project does not fall back to any other session.
6. **API key test.** A P1 key cannot read P2 data through any `/api/v1/*` route or MCP tool.

---

## 8. Phased delivery

Estimates assume one developer working focused days.

| Phase | Work | Est. |
| --- | --- | --- |
| **0. Prep** | Install deps; read `node_modules/next/dist/docs/` per `AGENTS.md`; pin a Baileys version; spike a single-session QR connect against a throwaway number to confirm the protocol works from your host. | 1–2 d |
| **1. Schema** | Migrations 041–044: projects, members, `project_id` + backfill + composite FKs, RLS rewrite, session tables. Test on a database copy first. | 3–5 d |
| **2. App scoping** | `getCurrentProject`, project switcher, audit of ~589 call sites, `/settings/projects`. | 3–5 d |
| **3. Channel layer** | Adapter interface, `ingest.ts` extraction, Cloud API adapter behind the new interface (no behaviour change). | 2–3 d |
| **4. Gateway** | Service, Supabase-backed auth state, session manager, REST + HMAC, reconnect/backoff, Dockerfile. | 4–6 d |
| **5. QR UX** | Pairing modal, live status via Realtime, disconnect / re-pair, QR adapter wired to send. | 2–3 d |
| **6. Verification** | The §7 suite plus the service-role audit. | 2–3 d |
| **7. Deploy** | VPS, Compose, secrets, health checks, session-drop alerting, runbook. | 1–2 d |

**Roughly 3–5 weeks.** Phase 1 is the riskiest and the hardest to reverse once production data exists — that is the one to review carefully before it runs.

Phases 1–2 deliver value on their own (multi-project Cloud API) and can ship before the gateway exists. Phase 0's spike should happen first regardless: if QR pairing does not work reliably from your chosen host, that changes the plan before you have spent three weeks on it.

---

## 9. Risks and limits of the QR channel

These are properties of the approach, not of the implementation. Worth deciding on before Phase 4.

- **Account ban risk.** WhatsApp's Business Terms prohibit unofficial clients. Numbers connected this way can be blocked, and bulk sending is the fastest way to trigger it. Mitigations to build in: per-session send rate limits with jitter, a warm-up ramp for new sessions, and either disabling broadcasts on QR projects initially or throttling them hard. Your customers should be told plainly that this channel carries that risk.
- **Protocol churn.** Baileys tracks a moving target; expect periodic dependency bumps and occasional breakage. Pin the version, and treat gateway upgrades as a maintenance line item.
- **Session mortality.** Sessions die on phone logout, extended phone offline, or the 4-linked-device limit being hit. The re-pair flow is not an edge case — it is routine, and needs to alert the customer rather than silently going quiet. `heartbeat_at` plus an alert on stale sessions covers this.
- **No templates.** Approved message templates and the 24-hour-window mechanics are Cloud API concepts. Broadcast features that depend on templates are Cloud-API-only; the UI must reflect that per project rather than failing at send.
- **No history backfill.** A freshly paired session receives new messages only. Prior conversation history does not import.
- **Media handling.** Baileys returns media as buffers in-process — stream to Supabase Storage with a hard size cap, or a few large videos will exhaust the gateway's memory.

---

## 10. Open questions

1. **Intra-org project access** — is the §4.1 default right (admin+ sees all projects, agent/viewer only assigned ones), or should every member be explicitly assigned including admins?
2. **Contact identity** — confirmed that the same phone in two projects should be two independent contacts? This is implied by full isolation but has real UX consequences.
3. **Broadcasts on QR** — disable entirely at first, or enable with an enforced throttle? My recommendation is to disable until you have observed a session's stability for a few weeks.
4. **Existing production data** — how many accounts and how many rows in the largest tables? Phase 1's backfill plan (and whether it needs batching or a maintenance window) depends on it.
5. **Project limits** — a cap on projects per organisation, and per-project session limits, for cost and abuse control?
