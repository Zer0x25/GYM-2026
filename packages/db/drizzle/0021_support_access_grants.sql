CREATE TABLE support_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  granted_by_account_id text NOT NULL REFERENCES "user"(id),
  support_email text NOT NULL,
  reason text NOT NULL,
  scope text NOT NULL DEFAULT 'diagnostic',
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by_account_id text REFERENCES "user"(id),
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_access_grants_scope_check CHECK (scope IN ('diagnostic', 'read_only'))
);
--> statement-breakpoint
CREATE INDEX support_access_grants_org_created_idx ON support_access_grants(organization_id, created_at);
--> statement-breakpoint
CREATE INDEX support_access_grants_token_hash_idx ON support_access_grants(token_hash);
