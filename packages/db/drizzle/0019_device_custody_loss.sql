ALTER TABLE devices ADD COLUMN IF NOT EXISTS custody_reference text;
--> statement-breakpoint
ALTER TABLE devices ADD COLUMN IF NOT EXISTS custody_confirmed_at timestamptz;
--> statement-breakpoint
ALTER TABLE devices ADD COLUMN IF NOT EXISTS revoked_reason text;
--> statement-breakpoint
ALTER TABLE devices ADD COLUMN IF NOT EXISTS revoked_notes text;
