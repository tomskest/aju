-- AlterTable
ALTER TABLE "user" ADD COLUMN     "stripe_customer_id" TEXT,
ADD COLUMN     "stripe_subscription_id" TEXT,
ADD COLUMN     "subscription_status" TEXT,
ADD COLUMN     "current_period_end" TIMESTAMP(3),
ADD COLUMN     "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "stripe_customer_id" TEXT,
ADD COLUMN     "stripe_subscription_id" TEXT,
ADD COLUMN     "subscription_status" TEXT,
ADD COLUMN     "current_period_end" TIMESTAMP(3),
ADD COLUMN     "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "seat_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "processed_stripe_event" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_stripe_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_stripe_customer_id_key" ON "user"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_stripe_subscription_id_key" ON "user"("stripe_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_stripe_customer_id_key" ON "organization"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_stripe_subscription_id_key" ON "organization"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "processed_stripe_event_processed_at_idx" ON "processed_stripe_event"("processed_at");

-- Backfill seat_count from existing accepted memberships so the seat-sync job
-- starts from the truth rather than from zero. Personal orgs settle at 1.
UPDATE "organization" o
SET "seat_count" = (
    SELECT COUNT(*) FROM "organization_membership" m
    WHERE m."organization_id" = o."id" AND m."accepted_at" IS NOT NULL
);
