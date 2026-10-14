ALTER TABLE members ADD COLUMN account_id text REFERENCES "user"(id);
--> statement-breakpoint
CREATE UNIQUE INDEX members_account_id_unique ON members(account_id);
--> statement-breakpoint
-- Link only unambiguous historical identities; ambiguous rows remain unlinked.
UPDATE members m SET account_id = u.id
FROM "user" u
WHERE lower(m.contact_email) = lower(u.email)
AND (SELECT count(*) FROM members mm WHERE lower(mm.contact_email) = lower(u.email)) = 1;
--> statement-breakpoint
UPDATE members SET qr_token = replace(gen_random_uuid()::text, '-', '') WHERE qr_token IS NULL;
