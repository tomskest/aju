/**
 * One-off: flip toomas.koost@crewpoint.com to beta_founder tier on the
 * production control DB. Explicit target + value per user directive:
 *   "run the flip: email=toomas.koost@crewpoint.com tier=beta_founder"
 */
import { Client } from "pg";

const EMAIL = "toomas.koost@crewpoint.com";
const TARGET_TIER = "beta_founder";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const before = await client.query(
  `SELECT id, email, plan_tier, grandfathered_at FROM "user" WHERE email = $1`,
  [EMAIL],
);
if (before.rows.length === 0) {
  console.error(`no user with email ${EMAIL}`);
  await client.end();
  process.exit(1);
}
console.log("before:", before.rows[0]);

if (before.rows[0].plan_tier === TARGET_TIER) {
  console.log(`already on ${TARGET_TIER} — no change`);
  await client.end();
  process.exit(0);
}

const after = await client.query(
  `UPDATE "user" SET plan_tier = $1 WHERE email = $2 RETURNING id, email, plan_tier`,
  [TARGET_TIER, EMAIL],
);
console.log("after: ", after.rows[0]);

await client.end();
