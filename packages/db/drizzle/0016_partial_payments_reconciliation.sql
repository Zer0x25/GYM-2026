ALTER TABLE memberships ADD COLUMN IF NOT EXISTS cycle_target_cents integer;
--> statement-breakpoint
ALTER TABLE payments ADD COLUMN IF NOT EXISTS period_id uuid REFERENCES membership_periods(id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS payments_period_idx ON payments(period_id);
