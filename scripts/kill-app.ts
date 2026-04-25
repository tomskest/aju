import { Pool } from "pg";

const slug = process.argv[2];

if (!slug) {
  console.error("Usage: npm run kill:app <slug>");
  console.error("Example: npm run kill:app outreach-tracker");
  process.exit(1);
}

const schemaName = `app_${slug.replace(/-/g, "_")}`;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Check if schema exists
    const check = await pool.query(
      `SELECT nspname FROM pg_namespace WHERE nspname = $1`,
      [schemaName]
    );

    if (check.rows.length === 0) {
      console.log(`Schema "${schemaName}" does not exist. Nothing to drop.`);
    } else {
      await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      console.log(`Dropped schema: ${schemaName}`);
    }

    // Print file paths to delete manually
    console.log(`\nDelete these directories to fully remove the app:`);
    console.log(`  src/app/apps/${slug}/`);
    console.log(`  src/app/api/apps/${slug}/`);
    console.log(`  src/lib/apps/${slug}/`);
    console.log(`  scripts/setup-app-${slug}.ts (if exists)`);
    console.log(`\nAlso remove the entry from src/lib/app-registry.ts`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
