ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "minor_registration_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "guardian_consent_ref" text;
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "guardian_consent_at" timestamp with time zone;
