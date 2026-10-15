ALTER TABLE members ADD COLUMN contact_verified_at timestamptz;
--> statement-breakpoint
CREATE TABLE contact_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  member_id uuid NOT NULL REFERENCES members(id),
  account_id text NOT NULL REFERENCES "user"(id),
  token_hash text NOT NULL UNIQUE,
  target_email text NOT NULL,
  previous_email text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX contact_verifications_member_idx ON contact_verifications(organization_id, member_id);
