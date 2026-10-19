ALTER TABLE sessions ADD COLUMN rescheduled_at timestamptz;
--> statement-breakpoint
ALTER TABLE sessions ADD COLUMN rescheduled_from_starts_at timestamptz;
--> statement-breakpoint
ALTER TABLE sessions ADD COLUMN rescheduled_count integer NOT NULL DEFAULT 0;
