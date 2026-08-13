# Tenant isolation tests

Proves that migrations 041–045 actually hold the boundary they claim:
no organisation can reach another's data, and no project can reach a
sibling project's data inside the same organisation.

RLS policies are easy to write and easy to get subtly wrong, and ~30
files in this app use the service-role client, which bypasses RLS
entirely. So the guarantee is worth asserting rather than assuming.

## Running

Needs Docker and `psql`. Nothing here touches your real Supabase
project — it builds a throwaway database from scratch.

```bash
# 1. A Postgres with pgvector (ai_knowledge_chunks needs the extension)
docker run -d --name wacrm-pgtest \
  -e POSTGRES_PASSWORD=pw -p 55433:5432 pgvector/pgvector:pg16

export PGPASSWORD=pw
PSQL="psql -h localhost -p 55433 -U postgres -v ON_ERROR_STOP=1 -q"

# 2. Supabase-shaped scaffolding: roles, auth/storage schemas, auth.uid()
$PSQL -f supabase/tests/00_scaffold.sql

# 3. The schema. combined_migrations.sql covers 001–036.
$PSQL -f combined_migrations.sql
for f in 037 038 039 040 041 042 043 044 045; do
  $PSQL -f supabase/migrations/${f}_*.sql
done

# 4. The assertions
psql -h localhost -p 55433 -U postgres -f supabase/tests/01_isolation.sql
```

The last command prints one `pass:` line per assertion and
`ALL ISOLATION ASSERTIONS PASSED` at the end. Any violated assertion
raises and aborts — there is no way for a failure to look like a pass.

Re-running `01_isolation.sql` is safe; it rebuilds its own fixtures.

## What it covers

Fixtures: organisation A with projects P1 and P2, organisation B with
P3. Owner A, Agent A (assigned to P1 only), Owner B.

**Cross-project, same organisation**
- an agent assigned to P1 sees only P1's projects, contacts,
  conversations and messages
- that agent cannot INSERT into P2
- an org admin sees both P1 and P2 (admins administer the whole org)

**Cross-organisation**
- Owner A sees nothing of organisation B, and vice versa
- neither sees the other's WhatsApp session

**Session credentials**
- `whatsapp_session_keys` is denied to `authenticated` outright — at
  the privilege layer, before RLS — including for the org owner

**Structural guarantees** (these hold even if a policy is wrong)
- the composite FK rejects a row whose project and account disagree
- `messages` cannot name a conversation from another project
- an archived project stays readable but rejects writes
- the same phone number can exist in two projects of one organisation

**The 045 backstop**
- fills `project_id` for a single-project account (pre-projects call
  sites keep working)
- refuses, loudly, when an account has several projects and the INSERT
  did not say which one

## Cleaning up

```bash
docker rm -f wacrm-pgtest
```
