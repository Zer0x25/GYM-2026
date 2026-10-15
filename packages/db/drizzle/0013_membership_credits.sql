ALTER TABLE plans ADD COLUMN grupal_credits integer CHECK (grupal_credits BETWEEN 0 AND 100000);
--> statement-breakpoint
ALTER TABLE plans ADD COLUMN fija_credits integer CHECK (fija_credits BETWEEN 0 AND 100000);
--> statement-breakpoint
ALTER TABLE plans ADD COLUMN cita_credits integer CHECK (cita_credits BETWEEN 0 AND 100000);
--> statement-breakpoint
CREATE TABLE membership_periods (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 member_id uuid NOT NULL REFERENCES members(id),
 membership_id uuid NOT NULL REFERENCES memberships(id),
 payment_id uuid UNIQUE REFERENCES payments(id),
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 coverage text NOT NULL CHECK (coverage IN ('none','unlimited','limited')),
 plan_name text NOT NULL, price_cents integer NOT NULL, duration_days integer NOT NULL,
 grupal_credits integer CHECK (grupal_credits BETWEEN 0 AND 100000),
 fija_credits integer CHECK (fija_credits BETWEEN 0 AND 100000),
 cita_credits integer CHECK (cita_credits BETWEEN 0 AND 100000),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT membership_periods_dates CHECK (ends_at > starts_at)
);
--> statement-breakpoint
CREATE INDEX membership_periods_member_idx ON membership_periods(organization_id,member_id);
--> statement-breakpoint
-- Preserve authoritative legacy windows, never infer quantitative quotas from flags.
INSERT INTO membership_periods (organization_id,member_id,membership_id,starts_at,ends_at,coverage,plan_name,price_cents,duration_days)
SELECT m.organization_id,m.member_id,m.id,m.start_at,m.end_at,p.coverage,p.name,p.price_cents,p.duration_days
FROM memberships m JOIN plans p ON p.id=m.plan_id AND p.organization_id=m.organization_id
WHERE m.start_at IS NOT NULL AND m.end_at > m.start_at;
--> statement-breakpoint
ALTER TABLE bookings ADD COLUMN period_id uuid REFERENCES membership_periods(id);
--> statement-breakpoint
ALTER TABLE booking_cancellations ADD COLUMN credit_review_required boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE credit_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 member_id uuid NOT NULL REFERENCES members(id),
 period_id uuid NOT NULL REFERENCES membership_periods(id),
 booking_id uuid NOT NULL REFERENCES bookings(id),
 modality text NOT NULL CHECK (modality IN ('grupal','fija','cita')),
 kind text NOT NULL CHECK (kind IN ('commit','return','review')),
 quantity integer NOT NULL,
 actor_id text NOT NULL REFERENCES "user"(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT credit_movements_booking_kind_unique UNIQUE (booking_id,kind),
 CONSTRAINT credit_movements_effect CHECK ((kind='commit' AND quantity=-1) OR (kind='return' AND quantity=1) OR (kind='review' AND quantity=0))
);
--> statement-breakpoint
CREATE INDEX credit_movements_period_idx ON credit_movements(organization_id,period_id);
