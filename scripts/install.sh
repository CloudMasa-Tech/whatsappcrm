#!/usr/bin/env bash
# ============================================================
# wacrm installer — bring up the CRM, the QR gateway, and the
# automation cron on a fresh machine.
#
# Safe to re-run. Nothing here overwrites a secret that already has a
# value, and every generated file is backed up before it is touched.
#
# What it does NOT do, on purpose:
#   - It never invents Supabase credentials. Those come from your
#     project and are prompted for (or passed in the environment).
#   - It never applies migrations to a database it was not given a
#     connection string for. It prints the exact documented order
#     instead — see DEPLOYMENT.md §2.1.
#
# Usage:
#   scripts/install.sh                    # interactive, auto-detect
#   scripts/install.sh --mode docker      # force Docker Compose
#   scripts/install.sh --mode node        # force local Node processes
#   scripts/install.sh --non-interactive  # read every value from env
#   scripts/install.sh --with-cron        # also install the cron jobs
#   scripts/install.sh --dry-run          # print, change nothing
#   scripts/install.sh --help
#
# Environment (all optional; prompted when missing and interactive):
#   NEXT_PUBLIC_SUPABASE_URL  NEXT_PUBLIC_SUPABASE_ANON_KEY
#   SUPABASE_SERVICE_ROLE_KEY NEXT_PUBLIC_SITE_URL
#   META_APP_SECRET           SUPABASE_DB_URL
# ============================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="$REPO_ROOT/.env"
MODE=""
INTERACTIVE=1
WITH_CRON=0
DRY_RUN=0

# ------------------------------------------------------------
# Output
# ------------------------------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

step()  { printf '\n%s==> %s%s\n' "$BOLD$BLUE" "$*" "$RESET"; }
ok()    { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn()  { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
fail()  { printf '  %s✗%s %s\n' "$RED" "$RESET" "$*"; }
die()   { fail "$*"; exit 1; }
run()   {
  if [ "$DRY_RUN" = 1 ]; then
    printf '  %s[dry-run]%s %s\n' "$YELLOW" "$RESET" "$*"
  else
    "$@"
  fi
}

# Print the header comment block (line 2 up to the first non-comment
# line) so --help cannot drift out of sync with the file.
usage() {
  awk 'NR>1 && /^#/ {sub(/^# ?/, ""); print; next} NR>1 {exit}' "${BASH_SOURCE[0]}"
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --mode=*) MODE="${1#*=}"; shift ;;
    --non-interactive) INTERACTIVE=0; shift ;;
    --with-cron) WITH_CRON=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

case "${MODE:-}" in
  ""|docker|node) ;;
  *) die "--mode must be 'docker' or 'node'" ;;
esac

# ============================================================
# 1. Preflight
# ============================================================
step "Checking prerequisites"

have() { command -v "$1" >/dev/null 2>&1; }

for tool in git openssl curl; do
  have "$tool" || die "$tool is required but not installed."
done
ok "git, openssl, curl present"

# Node: package.json says >=20, but transitive deps declare
# ^20.19 || ^22.13 || >=24. Anything outside that only warns.
if have node; then
  NODE_RAW="$(node -v)"; NODE_MAJOR="${NODE_RAW#v}"; NODE_MAJOR="${NODE_MAJOR%%.*}"
  if [ "$NODE_MAJOR" -lt 20 ]; then
    die "Node $NODE_RAW is too old. Install Node 22.13+ or 24 LTS."
  elif [ "$NODE_MAJOR" = 21 ] || [ "$NODE_MAJOR" = 23 ]; then
    warn "Node $NODE_RAW is an odd/EOL major — expect EBADENGINE warnings. 22.13+ or 24 LTS is smoother."
  else
    ok "Node $NODE_RAW"
  fi
else
  NODE_MAJOR=0
  warn "Node not found (fine for --mode docker; required for --mode node)"
fi

DOCKER_OK=0
if have docker && docker compose version >/dev/null 2>&1; then
  DOCKER_OK=1
  ok "docker compose present"
else
  warn "docker compose not available"
fi

if [ -z "$MODE" ]; then
  if [ "$DOCKER_OK" = 1 ]; then MODE=docker; else MODE=node; fi
fi
if [ "$MODE" = docker ] && [ "$DOCKER_OK" != 1 ]; then
  die "--mode docker needs Docker with the compose plugin."
fi
if [ "$MODE" = node ] && [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  die "--mode node needs Node 20+."
fi
ok "Install mode: $MODE"

have psql      && ok "psql present (schema can be applied here)"      || warn "psql absent — schema steps will be printed, not run"
have supabase  && ok "supabase CLI present"                            || true

# ============================================================
# 2. Environment file
# ============================================================
step "Building $ENV_FILE"

# Read a key's current value from .env, empty if absent.
env_value() {
  [ -f "$ENV_FILE" ] || { printf ''; return; }
  sed -n "s/^$1=//p" "$ENV_FILE" | head -1
}

# Set (or leave) a key. Never clobbers a non-empty existing value.
set_env() {
  local key="$1" value="$2" current
  current="$(env_value "$key")"
  if [ -n "$current" ]; then
    ok "$key already set — keeping it"
    return
  fi
  if [ "$DRY_RUN" = 1 ]; then
    printf '  %s[dry-run]%s would set %s\n' "$YELLOW" "$RESET" "$key"
    return
  fi
  if grep -q "^$key=" "$ENV_FILE" 2>/dev/null; then
    # Present but empty — fill it in place. A temp file keeps this
    # portable; in-place sed differs between GNU and BSD.
    awk -v k="$key" -v v="$value" \
      'BEGIN{FS=OFS="="} $1==k && NF>=1 {print k "=" v; next} {print}' \
      "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
  ok "$key set"
}

if [ ! -f "$ENV_FILE" ]; then
  [ -f "$REPO_ROOT/.env.example" ] || die ".env.example missing — is this a wacrm checkout?"
  run cp "$REPO_ROOT/.env.example" "$ENV_FILE"
  ok "created .env from .env.example"

  # .env.example ships placeholder Supabase values that LOOK real.
  # Blank them so a fresh install cannot silently point at someone
  # else's project.
  if [ "$DRY_RUN" != 1 ]; then
    awk 'BEGIN{FS=OFS="="}
      /^NEXT_PUBLIC_SUPABASE_URL=/      {print "NEXT_PUBLIC_SUPABASE_URL="; next}
      /^NEXT_PUBLIC_SUPABASE_ANON_KEY=/ {print "NEXT_PUBLIC_SUPABASE_ANON_KEY="; next}
      /^SUPABASE_SERVICE_ROLE_KEY=/     {print "SUPABASE_SERVICE_ROLE_KEY="; next}
      {print}' "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
    warn "cleared the example Supabase values — they are placeholders, not yours"
  fi
else
  run cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"
  ok "existing .env backed up"
fi

# ---- Secrets we can generate ourselves ----------------------
# ENCRYPTION_KEY must be 64 hex chars and must MATCH between the web app
# and the gateway: both read the same encrypted rows. Changing it later
# orphans every stored token and forces a re-scan of every QR number.
set_env ENCRYPTION_KEY           "$(openssl rand -hex 32)"
set_env GATEWAY_API_TOKEN        "$(openssl rand -hex 32)"
set_env GATEWAY_SIGNING_SECRET   "$(openssl rand -hex 32)"
set_env GATEWAY_WEBHOOK_SECRET   "$(openssl rand -hex 32)"
# Not in .env.example, and both cron endpoints answer 503 without it.
set_env AUTOMATION_CRON_SECRET   "$(openssl rand -hex 32)"

# ---- Values only you have -----------------------------------
ask() {
  local key="$1" prompt="$2" current from_env
  current="$(env_value "$key")"
  from_env="${!key:-}"

  if [ -n "$current" ]; then ok "$key already set"; return; fi
  if [ -n "$from_env" ]; then set_env "$key" "$from_env"; return; fi
  if [ "$INTERACTIVE" != 1 ]; then
    warn "$key is empty (non-interactive) — fill it in $ENV_FILE before starting"
    return
  fi

  printf '  %s: ' "$prompt"
  local answer; read -r answer
  [ -n "$answer" ] && set_env "$key" "$answer" \
    || warn "$key left empty — fill it in $ENV_FILE before starting"
}

printf '\n  %sSupabase → Project Settings → API%s\n' "$BOLD" "$RESET"
ask NEXT_PUBLIC_SUPABASE_URL      "Project URL (https://xxx.supabase.co)"
ask NEXT_PUBLIC_SUPABASE_ANON_KEY "anon key"
ask SUPABASE_SERVICE_ROLE_KEY     "service_role key (secret, bypasses RLS)"
printf '\n  %sApp%s\n' "$BOLD" "$RESET"
ask NEXT_PUBLIC_SITE_URL          "Public site URL (https://crm.example.com)"
printf '\n  %sMeta Cloud API — leave empty for QR-only%s\n' "$BOLD" "$RESET"
ask META_APP_SECRET               "Meta app secret"

if [ "$MODE" = node ]; then
  # Compose injects these under different names; a bare Node run needs
  # them spelled out on the web side.
  set_env WHATSAPP_GATEWAY_URL             "http://127.0.0.1:8088"
  set_env WHATSAPP_GATEWAY_TOKEN           "$(env_value GATEWAY_API_TOKEN)"
  set_env WHATSAPP_GATEWAY_SIGNING_SECRET  "$(env_value GATEWAY_SIGNING_SECRET)"
  set_env WHATSAPP_GATEWAY_WEBHOOK_SECRET  "$(env_value GATEWAY_WEBHOOK_SECRET)"
fi

if [ "$DRY_RUN" != 1 ]; then
  chmod 600 "$ENV_FILE"
  ok "chmod 600 $ENV_FILE"
fi

# ============================================================
# 3. Database schema
# ============================================================
step "Database schema"

SCHEMA_ORDER="combined_migrations.sql (flattened through 036), then supabase/migrations/037…050 in numeric order"

apply_with_psql() {
  local db="$1"
  run psql "$db" -v ON_ERROR_STOP=1 -f "$REPO_ROOT/combined_migrations.sql"
  local f
  for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
    case "$(basename "$f")" in
      00*|01*|02*|03[0-6]*) continue ;;   # covered by the flattened file
    esac
    printf '  → %s\n' "$(basename "$f")"
    run psql "$db" -v ON_ERROR_STOP=1 -f "$f"
  done
}

DB_URL="${SUPABASE_DB_URL:-}"
if [ -z "$DB_URL" ] && [ "$INTERACTIVE" = 1 ]; then
  printf '  Postgres connection string to apply the schema now (blank to skip): '
  read -r DB_URL
fi

if [ -n "$DB_URL" ] && have psql; then
  apply_with_psql "$DB_URL"
  ok "schema applied"
  warn "Also enable the 'vector' extension (Database → Extensions) for ai_knowledge_chunks"
else
  warn "Skipping schema. Apply it yourself, in this order:"
  printf '      %s\n' "$SCHEMA_ORDER"
  printf '      or: supabase link --project-ref <ref> && supabase db push\n'
  printf '      Upgrading a pre-projects instance? supabase/preflight_041_045.sql\n'
  printf '      reports blockers; supabase/apply_041_045.sql applies 041-045.\n'
  printf '      Full detail: DEPLOYMENT.md §2.1\n'
fi

# ============================================================
# 4. Build / install
# ============================================================
if [ "$MODE" = docker ]; then
  step "Building images (docker compose)"
  # NEXT_PUBLIC_* are compiled into the browser bundle at BUILD time,
  # so compose passes them as build args. Editing them later means
  # rebuilding, not restarting.
  run docker compose build
  ok "images built"
  step "Starting services"
  run docker compose up -d
  ok "web on :3000, gateway internal-only on :8088"
else
  step "Installing dependencies"
  run npm ci
  ok "app dependencies"
  ( cd "$REPO_ROOT/gateway" && run npm ci )
  ok "gateway dependencies"
  step "Building"
  run npm run build
  ok "app built (npm start to run it)"
  warn "gateway: 'npm run build' currently fails on Baileys typings drift — run it with 'npm run dev' (tsx) for now"
fi

# ============================================================
# 5. Cron — the step everyone misses
# ============================================================
step "Automation cron"

CRON_SECRET="$(env_value AUTOMATION_CRON_SECRET)"
BASE_URL="$(env_value NEXT_PUBLIC_SITE_URL)"
[ -n "$BASE_URL" ] || BASE_URL="http://127.0.0.1:3000"

CRON_LINE_1="* * * * * curl -fsS -m 55 -H 'x-cron-secret: $CRON_SECRET' '$BASE_URL/api/automations/cron' >> /tmp/wacrm-cron.log 2>&1"
CRON_LINE_2="*/5 * * * * curl -fsS -m 55 -H 'x-cron-secret: $CRON_SECRET' '$BASE_URL/api/flows/cron' >> /tmp/wacrm-cron.log 2>&1"

# Why both, and why this cadence:
#   /api/automations/cron drains due Wait steps and processes at most 50
#   rows per call — hence every minute.
#   /api/flows/cron marks abandoned runs timed_out. Skip it and a stale
#   'active' run holds the one-active-run-per-contact index forever, so
#   that contact silently stops triggering any flow.
if [ "$WITH_CRON" = 1 ]; then
  if have crontab; then
    if crontab -l 2>/dev/null | grep -q "api/automations/cron"; then
      ok "cron entries already present — leaving them alone"
    elif [ "$DRY_RUN" = 1 ]; then
      printf '  %s[dry-run]%s would add 2 crontab entries\n' "$YELLOW" "$RESET"
    else
      { crontab -l 2>/dev/null || true; printf '%s\n%s\n' "$CRON_LINE_1" "$CRON_LINE_2"; } | crontab -
      ok "installed 2 crontab entries (log: /tmp/wacrm-cron.log)"
    fi
  else
    warn "no crontab on this machine — add these to your scheduler:"
    printf '      %s\n      %s\n' "$CRON_LINE_1" "$CRON_LINE_2"
  fi
else
  warn "not installed (pass --with-cron). Without these, every Wait step stalls forever:"
  printf '      %s\n      %s\n' "$CRON_LINE_1" "$CRON_LINE_2"
fi

# ============================================================
# 6. Verify
# ============================================================
step "Verifying"

check_url() {
  local label="$1" url="$2" expect="$3" code
  code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$url" 2>/dev/null || echo 000)"
  if [ "$code" = "$expect" ]; then ok "$label → $code"; else warn "$label → $code (expected $expect)"; fi
}

if [ "$DRY_RUN" = 1 ]; then
  warn "skipped (dry run)"
else
  # Give the services a moment when we just started them.
  [ "$MODE" = docker ] && sleep 5

  check_url "app"                 "$BASE_URL/api/whatsapp/qr"      401
  # 200 with the right secret proves the endpoint AND the secret wiring.
  code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' \
    -H "x-cron-secret: $CRON_SECRET" "$BASE_URL/api/automations/cron" 2>/dev/null || echo 000)"
  case "$code" in
    200) ok "automations cron → 200" ;;
    503) fail "automations cron → 503: AUTOMATION_CRON_SECRET is not in the RUNNING process. Restart it." ;;
    401) fail "automations cron → 401: secret mismatch between .env and the running process." ;;
    *)   warn "automations cron → $code (is the app up at $BASE_URL?)" ;;
  esac

  if [ "$MODE" = docker ]; then
    docker compose ps --status running 2>/dev/null | grep -q gateway \
      && ok "gateway container running" \
      || warn "gateway container not running — docker compose logs gateway"
  fi
fi

# ============================================================
# Done
# ============================================================
cat <<EOF

$BOLD$GREEN wacrm install finished ($MODE mode)$RESET

 Next:
   1. Confirm $ENV_FILE — anything reported empty above blocks startup.

   2. Create the first user in Supabase → Authentication → Users
      (public signup is disabled), then PROMOTE them. Required on every
      fresh install: handle_new_user() does not set platform_role, and
      migrations 047/050 only promote profiles that already existed, so
      your first user is a 'customer' and the admin area — Projects,
      Customers — plus /pipelines /automations /flows /agents /inbox
      /notifications are all invisible. Nothing errors.

        update profiles
        set    platform_role = 'super_admin'
        where  account_role = 'owner'
          and  platform_role = 'customer';

   3. Sign in, then connect a number:
        Cloud API — Settings → WhatsApp, then set the Meta callback to
                    $BASE_URL/api/whatsapp/webhook and subscribe the
                    'messages' field.
        QR        — Settings → WhatsApp → QR, scan with the handset.
   4. If the QR screen never updates live, check Realtime:
        select * from pg_publication_tables
        where pubname = 'supabase_realtime' and tablename = 'whatsapp_sessions';
      No rows → add it under Database → Replication. Migration 044
      downgrades that failure to a warning, so it can be silently absent.
   5. Test automations end to end: docs/automation-setup.md §8.

 Secrets live in $ENV_FILE (chmod 600). Back up ENCRYPTION_KEY somewhere
 other than the database — without it every stored WhatsApp credential
 is unrecoverable and every QR number must be re-paired.
EOF
