ALTER TABLE "members" ADD COLUMN "qr_token" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "qr_revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_qr_token_unique" UNIQUE("qr_token");--> statement-breakpoint
-- Backfill: existing members get an opaque, globally-unique QR token
-- (spec 007, SPEC:QR-TOKEN). gen_random_uuid() is not guessable/sequential.
UPDATE "members" SET "qr_token" = replace(gen_random_uuid()::text, '-', '') WHERE "qr_token" IS NULL;