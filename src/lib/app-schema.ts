import { Pool } from "pg";

function getPool(): Pool {
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

/**
 * Ensure an app's PostgreSQL schema exists.
 * Creates `app_[slug]` schema if it doesn't exist.
 */
export async function ensureAppSchema(slug: string): Promise<void> {
  const schemaName = `app_${slug.replace(/-/g, "_")}`;
  const pool = getPool();
  try {
    await pool.query(
      `CREATE SCHEMA IF NOT EXISTS "${schemaName}"`
    );
  } finally {
    await pool.end();
  }
}

/**
 * Drop an app's PostgreSQL schema and all its tables.
 */
export async function dropAppSchema(slug: string): Promise<void> {
  const schemaName = `app_${slug.replace(/-/g, "_")}`;
  const pool = getPool();
  try {
    await pool.query(
      `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`
    );
  } finally {
    await pool.end();
  }
}

/**
 * Run a SQL query within an app's schema context.
 * Sets search_path to the app schema, then resets.
 */
export async function queryAppSchema<T extends Record<string, unknown>>(
  slug: string,
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const schemaName = `app_${slug.replace(/-/g, "_")}`;
  const pool = getPool();
  try {
    await pool.query(`SET search_path TO "${schemaName}", public`);
    const result = await pool.query(sql, params);
    await pool.query(`SET search_path TO public`);
    return result.rows as T[];
  } finally {
    await pool.end();
  }
}
