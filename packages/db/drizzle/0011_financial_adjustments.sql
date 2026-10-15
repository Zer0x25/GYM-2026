CREATE TABLE "financial_adjustments" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
 "payment_id" uuid NOT NULL REFERENCES "payments"("id"),
 "session_id" uuid NOT NULL REFERENCES "cash_sessions"("id"),
 "actor_id" text NOT NULL REFERENCES "user"("id"),
 "idempotency_key" uuid NOT NULL,
 "kind" text NOT NULL CHECK (kind IN ('refund','adjustment')),
 "method" text NOT NULL CHECK (method IN ('cash','transfer','transbank')),
 "amount_cents" integer NOT NULL CHECK (amount_cents > 0),
 "reason" text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
 "created_at" timestamptz DEFAULT now() NOT NULL,
 CONSTRAINT "financial_adjustments_org_key" UNIQUE ("organization_id","idempotency_key")
);
CREATE INDEX "financial_adjustments_payment_idx" ON "financial_adjustments"("organization_id","payment_id");
CREATE INDEX "financial_adjustments_session_idx" ON "financial_adjustments"("session_id");
