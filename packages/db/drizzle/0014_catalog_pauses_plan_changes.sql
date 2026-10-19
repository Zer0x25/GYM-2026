ALTER TABLE plans ADD COLUMN version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE memberships ADD COLUMN next_plan_id uuid REFERENCES plans(id);
--> statement-breakpoint
ALTER TABLE membership_periods ADD COLUMN plan_version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE TABLE membership_pauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  membership_id uuid NOT NULL REFERENCES memberships(id),
  period_id uuid NOT NULL REFERENCES membership_periods(id),
  actor_id text NOT NULL REFERENCES "user"(id),
  idempotency_key uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  extended_days integer NOT NULL,
  reason text NOT NULL,
  state text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_pauses_org_key UNIQUE (organization_id, idempotency_key),
  CONSTRAINT membership_pauses_extended_days_check CHECK (extended_days >= 1),
  CONSTRAINT membership_pauses_dates CHECK (ends_at > starts_at),
  CONSTRAINT membership_pauses_reason_check CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  CONSTRAINT membership_pauses_state_check CHECK (state IN ('active', 'lifted'))
);
--> statement-breakpoint
CREATE INDEX membership_pauses_org_membership_idx ON membership_pauses(organization_id, membership_id);
--> statement-breakpoint
CREATE INDEX membership_pauses_org_period_idx ON membership_pauses(organization_id, period_id);
