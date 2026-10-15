-- Additive; historical manual payments keep their existing reference and null comment.
ALTER TABLE "payments" ADD COLUMN "comment" text;
