-- Policies key off app.current_practice_id, set per transaction by withTenant.
-- The table owner bypasses RLS because FORCE is not used. Enforcement starts
-- when a connection uses the openpims_app role created by apply-rls.ts.

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

ALTER TABLE practices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON practices;
CREATE POLICY tenant_isolation ON practices
  USING (app_rls_bypass() OR id = app_current_practice_id())
  WITH CHECK (app_rls_bypass() OR id = app_current_practice_id());

DO $$
DECLARE
  t text;
  tbls text[] := array[
    'api_keys',
    'appointments',
    'clients',
    'communications',
    'invoices',
    'patients',
    'portal_sessions',
    'products',
    'soap_notes',
    'users',
    'webhooks',
    'locations',
    'location_messaging',
    'usage_records'
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

ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON invoice_items;
CREATE POLICY tenant_isolation ON invoice_items
  USING (
    app_rls_bypass()
    OR EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = invoice_items.invoice_id
        AND invoices.practice_id = app_current_practice_id()
    )
  )
  WITH CHECK (
    app_rls_bypass()
    OR EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = invoice_items.invoice_id
        AND invoices.practice_id = app_current_practice_id()
    )
  );
