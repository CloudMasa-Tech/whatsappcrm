-- Cross-tenant isolation test for migrations 041-044.
-- Fails loudly (RAISE EXCEPTION) on the first violated assertion.

\set ON_ERROR_STOP on

-- ---------- fixtures ----------
-- Accounts first: accounts.owner_user_id is ON DELETE RESTRICT, so
-- clearing auth.users on its own fails on a re-run. Deleting accounts
-- cascades through projects and every domain row.
DELETE FROM accounts;
DELETE FROM auth.users;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner-a@example.com', '{"full_name":"Owner A"}'),
  ('22222222-2222-2222-2222-222222222222', 'agent-a@example.com', '{"full_name":"Agent A"}'),
  ('33333333-3333-3333-3333-333333333333', 'owner-b@example.com', '{"full_name":"Owner B"}');

DO $$
DECLARE
  acct_a UUID; acct_b UUID; p1 UUID; p2 UUID; p3 UUID;
  c1 UUID; c2 UUID; c3 UUID;
  conv1 UUID; conv2 UUID;
BEGIN
  SELECT account_id INTO acct_a FROM profiles WHERE user_id = '11111111-1111-1111-1111-111111111111';
  SELECT account_id INTO acct_b FROM profiles WHERE user_id = '33333333-3333-3333-3333-333333333333';
  IF acct_a IS NULL OR acct_b IS NULL THEN
    RAISE EXCEPTION 'handle_new_user did not bootstrap accounts (a=%, b=%)', acct_a, acct_b;
  END IF;

  -- Agent A joins org A as an 'agent' (invitation flow does this in the app).
  UPDATE profiles SET account_id = acct_a, account_role = 'agent'
   WHERE user_id = '22222222-2222-2222-2222-222222222222';
  -- Their auto-created personal account is irrelevant to the test.

  SELECT id INTO p1 FROM projects WHERE account_id = acct_a AND slug = 'default';
  INSERT INTO projects (account_id, name, slug, channel_type)
       VALUES (acct_a, 'Second', 'second', 'qr') RETURNING id INTO p2;
  SELECT id INTO p3 FROM projects WHERE account_id = acct_b AND slug = 'default';

  -- Agent A is assigned to P1 only.
  INSERT INTO project_members (project_id, user_id)
       VALUES (p1, '22222222-2222-2222-2222-222222222222');

  INSERT INTO contacts (account_id, project_id, user_id, phone, name)
    VALUES (acct_a, p1, '11111111-1111-1111-1111-111111111111', '+10000000001', 'P1 contact')
    RETURNING id INTO c1;
  INSERT INTO contacts (account_id, project_id, user_id, phone, name)
    VALUES (acct_a, p2, '11111111-1111-1111-1111-111111111111', '+10000000002', 'P2 contact')
    RETURNING id INTO c2;
  INSERT INTO contacts (account_id, project_id, user_id, phone, name)
    VALUES (acct_b, p3, '33333333-3333-3333-3333-333333333333', '+10000000003', 'P3 contact')
    RETURNING id INTO c3;

  INSERT INTO conversations (account_id, project_id, user_id, contact_id)
    VALUES (acct_a, p1, '11111111-1111-1111-1111-111111111111', c1) RETURNING id INTO conv1;
  INSERT INTO conversations (account_id, project_id, user_id, contact_id)
    VALUES (acct_a, p2, '11111111-1111-1111-1111-111111111111', c2) RETURNING id INTO conv2;

  INSERT INTO messages (conversation_id, project_id, sender_type, content_text)
    VALUES (conv1, p1, 'customer', 'hello from P1');
  INSERT INTO messages (conversation_id, project_id, sender_type, content_text)
    VALUES (conv2, p2, 'customer', 'hello from P2');

  INSERT INTO whatsapp_sessions (project_id, account_id, status)
    VALUES (p2, acct_a, 'qr_pending');
  INSERT INTO whatsapp_session_keys (project_id, key_type, key_id, payload)
    VALUES (p2, 'creds', 'creds', 'ciphertext');

  RAISE NOTICE 'fixtures: acctA=% p1=% p2=% acctB=% p3=%', acct_a, p1, p2, acct_b, p3;
END $$;

-- ---------- assertion helper ----------
CREATE OR REPLACE FUNCTION assert_eq(label TEXT, got BIGINT, want BIGINT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL % — got %, want %', label, got, want;
  END IF;
  RAISE NOTICE 'pass: % (%)', label, got;
END $$;

-- ============================================================
-- Agent A: member of P1 only
-- ============================================================
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';

SELECT assert_eq('agentA sees 1 project', (SELECT count(*) FROM projects), 1);
SELECT assert_eq('agentA sees only P1 contacts', (SELECT count(*) FROM contacts), 1);
SELECT assert_eq('agentA contact is the P1 one',
  (SELECT count(*) FROM contacts WHERE name = 'P1 contact'), 1);
SELECT assert_eq('agentA sees only P1 conversations', (SELECT count(*) FROM conversations), 1);
SELECT assert_eq('agentA sees only P1 messages', (SELECT count(*) FROM messages), 1);
SELECT assert_eq('agentA sees no sibling-project session',
  (SELECT count(*) FROM whatsapp_sessions), 0);
COMMIT;

-- Session credentials must be unreachable for every non-service role:
-- the REVOKE denies them at the privilege layer, one step before RLS.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
DO $$
DECLARE n BIGINT;
BEGIN
  SELECT count(*) INTO n FROM whatsapp_session_keys;
  RAISE EXCEPTION 'FAIL authenticated could query whatsapp_session_keys (% rows)', n;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'pass: whatsapp_session_keys denied to authenticated';
END $$;
ROLLBACK;

-- Writing into a project they do not belong to must fail.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
DO $$
DECLARE p2 UUID; acct_a UUID;
BEGIN
  SET LOCAL ROLE postgres;
  SELECT id, account_id INTO p2, acct_a FROM projects WHERE slug = 'second';
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO contacts (account_id, project_id, user_id, phone, name)
    VALUES (acct_a, p2, '22222222-2222-2222-2222-222222222222', '+19999999999', 'sneaky');
    RAISE EXCEPTION 'FAIL agentA inserted into P2 — RLS did not block it';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'pass: agentA INSERT into P2 blocked';
  END;
END $$;
ROLLBACK;

-- ============================================================
-- Owner A: admin of org A → both its projects, neither of org B's
-- ============================================================
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

SELECT assert_eq('ownerA sees 2 projects', (SELECT count(*) FROM projects), 2);
SELECT assert_eq('ownerA sees 2 contacts', (SELECT count(*) FROM contacts), 2);
SELECT assert_eq('ownerA sees no org-B contact',
  (SELECT count(*) FROM contacts WHERE name = 'P3 contact'), 0);
SELECT assert_eq('ownerA sees own session', (SELECT count(*) FROM whatsapp_sessions), 1);
COMMIT;

-- Even the organisation owner cannot read the raw Baileys credentials.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
DO $$
BEGIN
  PERFORM count(*) FROM whatsapp_session_keys;
  RAISE EXCEPTION 'FAIL owner could query whatsapp_session_keys';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'pass: whatsapp_session_keys denied even to the org owner';
END $$;
ROLLBACK;

-- ============================================================
-- Owner B: a different organisation entirely
-- ============================================================
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';

SELECT assert_eq('ownerB sees 1 project', (SELECT count(*) FROM projects), 1);
SELECT assert_eq('ownerB sees 1 contact', (SELECT count(*) FROM contacts), 1);
SELECT assert_eq('ownerB sees no org-A contacts',
  (SELECT count(*) FROM contacts WHERE name LIKE 'P1%' OR name LIKE 'P2%'), 0);
SELECT assert_eq('ownerB sees no org-A conversations', (SELECT count(*) FROM conversations), 0);
SELECT assert_eq('ownerB sees no org-A messages', (SELECT count(*) FROM messages), 0);
SELECT assert_eq('ownerB sees no org-A session', (SELECT count(*) FROM whatsapp_sessions), 0);
COMMIT;

-- ============================================================
-- Structural guarantees
-- ============================================================

-- Composite FK: project_id from org A + account_id from org B.
DO $$
DECLARE p1 UUID; acct_b UUID;
BEGIN
  SELECT pr.id INTO p1 FROM projects pr
    JOIN accounts a ON a.id = pr.account_id
   WHERE pr.slug = 'default' AND a.owner_user_id = '11111111-1111-1111-1111-111111111111';
  SELECT id INTO acct_b FROM accounts WHERE owner_user_id = '33333333-3333-3333-3333-333333333333';
  BEGIN
    INSERT INTO contacts (account_id, project_id, user_id, phone, name)
    VALUES (acct_b, p1, '33333333-3333-3333-3333-333333333333', '+18888888888', 'mismatched');
    RAISE EXCEPTION 'FAIL composite FK allowed a project/account mismatch';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'pass: composite FK rejects project/account mismatch';
  END;
END $$;

-- messages.project_id must agree with its conversation.
DO $$
DECLARE conv1 UUID; p2 UUID;
BEGIN
  SELECT c.id INTO conv1 FROM conversations c
    JOIN projects pr ON pr.id = c.project_id WHERE pr.slug = 'default' LIMIT 1;
  SELECT id INTO p2 FROM projects WHERE slug = 'second';
  BEGIN
    INSERT INTO messages (conversation_id, project_id, sender_type, content_text)
    VALUES (conv1, p2, 'agent', 'wrong project');
    RAISE EXCEPTION 'FAIL messages composite FK allowed a cross-project message';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'pass: messages composite FK rejects cross-project rows';
  END;
END $$;

-- Archived projects: readable, not writable.
DO $$
DECLARE p2 UUID; acct_a UUID; visible BIGINT;
BEGIN
  SELECT id, account_id INTO p2, acct_a FROM projects WHERE slug = 'second';
  UPDATE projects SET archived_at = NOW() WHERE id = p2;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

  SELECT count(*) INTO visible FROM contacts WHERE project_id = p2;
  IF visible <> 1 THEN
    RAISE EXCEPTION 'FAIL archived project should stay readable, saw % rows', visible;
  END IF;
  RAISE NOTICE 'pass: archived project still readable';

  BEGIN
    INSERT INTO contacts (account_id, project_id, user_id, phone, name)
    VALUES (acct_a, p2, '11111111-1111-1111-1111-111111111111', '+17777777777', 'after archive');
    RAISE EXCEPTION 'FAIL archived project accepted a write';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'pass: archived project rejects writes';
  END;

  RESET ROLE;
  UPDATE projects SET archived_at = NULL WHERE id = p2;
END $$;

-- Uniqueness is per-project, not per-account: the same phone number
-- must be insertable into two projects of one organisation.
DO $$
DECLARE p1 UUID; p2 UUID; acct_a UUID;
BEGIN
  SELECT id, account_id INTO p1, acct_a FROM projects WHERE slug = 'default'
    AND account_id = (SELECT account_id FROM profiles WHERE user_id = '11111111-1111-1111-1111-111111111111');
  SELECT id INTO p2 FROM projects WHERE slug = 'second';
  INSERT INTO contacts (account_id, project_id, user_id, phone, name)
    VALUES (acct_a, p1, '11111111-1111-1111-1111-111111111111', '+15551234567', 'shared A');
  INSERT INTO contacts (account_id, project_id, user_id, phone, name)
    VALUES (acct_a, p2, '11111111-1111-1111-1111-111111111111', '+15551234567', 'shared B');
  RAISE NOTICE 'pass: same phone number coexists in two projects';
END $$;

-- ============================================================
-- 045 backstop: legacy INSERTs that omit project_id
-- ============================================================

-- Single-project account → filled in silently, so pre-projects call
-- sites keep working unchanged.
DO $$
DECLARE acct_b UUID; got UUID; expected UUID;
BEGIN
  SELECT id INTO acct_b FROM accounts WHERE owner_user_id = '33333333-3333-3333-3333-333333333333';
  SELECT id INTO expected FROM projects WHERE account_id = acct_b;

  INSERT INTO contacts (account_id, user_id, phone, name)
  VALUES (acct_b, '33333333-3333-3333-3333-333333333333', '+16665550000', 'legacy insert')
  RETURNING project_id INTO got;

  IF got IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL backstop filled project_id = %, expected %', got, expected;
  END IF;
  RAISE NOTICE 'pass: backstop fills project_id for a single-project account';
END $$;

-- Multi-project account → refused, loudly. Guessing here would file a
-- customer's data into the wrong project.
DO $$
DECLARE acct_a UUID;
BEGIN
  SELECT account_id INTO acct_a FROM profiles WHERE user_id = '11111111-1111-1111-1111-111111111111';
  BEGIN
    INSERT INTO contacts (account_id, user_id, phone, name)
    VALUES (acct_a, '11111111-1111-1111-1111-111111111111', '+16665551111', 'ambiguous');
    RAISE EXCEPTION 'FAIL backstop guessed a project for a multi-project account';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    RAISE NOTICE 'pass: backstop refuses to guess when an account has several projects';
  END;
END $$;

SELECT 'ALL ISOLATION ASSERTIONS PASSED' AS result;
