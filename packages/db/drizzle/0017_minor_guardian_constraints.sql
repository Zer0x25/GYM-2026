DO $$ BEGIN
 ALTER TABLE "members" ADD CONSTRAINT "members_adult_responsible_id_members_id_fk" FOREIGN KEY ("adult_responsible_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "members_adult_responsible_idx" ON "members" USING btree ("adult_responsible_id");
