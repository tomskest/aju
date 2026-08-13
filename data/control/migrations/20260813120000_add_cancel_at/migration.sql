-- Stripe records a cancel-at-period-end as `cancel_at` on current API
-- versions and leaves `cancel_at_period_end` false, so the mirror needs the
-- timestamp to tell a winding-down subscription from a renewing one.

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "cancel_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "cancel_at" TIMESTAMP(3);
