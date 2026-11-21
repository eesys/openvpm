-- Row-level security is the second guard behind the app's practiceId filters.
-- Policies read `app.current_practice_id`, which the app sets inside the same
-- transaction that runs the query (apps/web/lib/tenant-db.ts).
--
-- The table owner bypasses RLS. Migrations and the local owner connection keep
-- working. Enforcement starts when the app connects as `openpims_app`.
--
-- Apply with: pnpm db:rls
-- The role password is not stored here. apply-rls.ts creates the role from
-- OPENPIMS_APP_DB_PASSWORD.

GRANT USAGE ON SCHEMA public TO openpims_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO openpims_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO openpims_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO openpims_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO openpims_app;

CREATE OR REPLACE FUNCTION app_current_practice_id() RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = ''
  AS
$fn$ SELECT nullif(current_setting('app.current_practice_id', true), '')::uuid $fn$;

CREATE OR REPLACE FUNCTION app_rls_bypass() RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = ''
  AS
$fn$ SELECT coalesce(current_setting('app.rls_bypass', true), '') = 'on' $fn$;

-- The practice row is keyed by its own id.
ALTER TABLE practices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON practices;
CREATE POLICY tenant_isolation ON practices
  USING (app_rls_bypass() OR id = app_current_practice_id())
  WITH CHECK (app_rls_bypass() OR id = app_current_practice_id());

-- Every table that carries practice_id gets the same policy.
DO $$
DECLARE
  t text;
  tbls text[] := array[
    'api_keys',
    'appointment_types',
    'appointments',
    'clients',
    'communications',
    'inventory_stock_adjustments',
    'invoices',
    'patients',
    'portal_sessions',
    'products',
    'services',
    'soap_notes',
    'users',
    'webhooks'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (app_rls_bypass() OR practice_id = app_current_practice_id()) '
      'WITH CHECK (app_rls_bypass() OR practice_id = app_current_practice_id())',
      t
    );
  END LOOP;
END$$;

-- invoice_items has no practice_id. It follows the invoice that owns it.
DO $$
DECLARE
  i int;
  child_tbls text[][] := array[
    ['invoice_items', 'invoice_id', 'invoices']
  ];
BEGIN
  FOR i IN 1 .. array_length(child_tbls, 1) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', child_tbls[i][1]);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', child_tbls[i][1]);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %1$I '
      'USING (app_rls_bypass() OR EXISTS (SELECT 1 FROM %3$I p WHERE p.id = %1$I.%2$I AND p.practice_id = app_current_practice_id())) '
      'WITH CHECK (app_rls_bypass() OR EXISTS (SELECT 1 FROM %3$I p WHERE p.id = %1$I.%2$I AND p.practice_id = app_current_practice_id()))',
      child_tbls[i][1], child_tbls[i][2], child_tbls[i][3]
    );
  END LOOP;
END$$;

-- Session and verification rows are used before a practice is known.
-- They stay out of tenant policies. On Supabase, also hide them from the
-- data-API roles; those roles are absent on local Postgres.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format(
        'REVOKE ALL ON sessions, verification_tokens FROM %I',
        r
      );
    END IF;
  END LOOP;
END$$;
