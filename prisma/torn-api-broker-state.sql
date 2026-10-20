BEGIN;

CREATE TABLE IF NOT EXISTS "public"."TornApiBrokerState" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TornApiBrokerState_pkey" PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "TornApiBrokerState_expiresAt_idx"
    ON "public"."TornApiBrokerState"("expiresAt");

COMMIT;
