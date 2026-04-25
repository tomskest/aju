/**
 * Thin Neon HTTP API client.
 *
 * Scope: the four things src/lib/tenant-provision.ts needs —
 *   - create a database on the project's default branch
 *   - create a role on the project's default branch
 *   - drop database / role (for hard org delete)
 *   - fetch branch endpoint info to build DSNs
 *
 * Uses NEON_API_KEY (Neon personal or org API key) and NEON_PROJECT_ID
 * from the environment. All calls go through `fetch` — no extra dep.
 *
 * Docs: https://api-docs.neon.tech/reference/getting-started-with-neon-api
 */

const API_BASE = "https://console.neon.tech/api/v2";

interface NeonErrorBody {
  message?: string;
  code?: string;
}

export class NeonApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(`Neon API ${status}: ${message}`);
    this.name = "NeonApiError";
    this.status = status;
    this.code = code;
  }
}

function apiKey(): string {
  const key = process.env.NEON_API_KEY;
  if (!key) throw new Error("NEON_API_KEY is not set");
  return key;
}

function projectId(): string {
  const id = process.env.NEON_PROJECT_ID;
  if (!id) throw new Error("NEON_PROJECT_ID is not set");
  return id;
}

// Neon returns 423 when a concurrent operation holds the project-level
// lock (creating a DB/role/branch while another is in flight). That error
// is transient — the previous operation finishes within a few seconds.
// Retry with exponential backoff before surfacing the failure, so a user
// signing up while a prior provisioning is still wrapping up doesn't eat
// a 500 + orphaned Org row.
//
// Budget: 1s + 2s + 4s + 8s = ~15s total. Deliberately kept well under
// Cloudflare's ~100s edge timeout; with the rest of provisioning (migrate
// deploy, tigris CLI subprocesses) adding ~20-30s we still have headroom.
// Harder contention surfaces as a 500 the user retries — preferable to a
// request that hangs long enough to get killed mid-flight.
const LOCKED_MAX_RETRIES = 4;
const LOCKED_BASE_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  for (let attempt = 0; attempt <= LOCKED_MAX_RETRIES; attempt++) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (res.ok) {
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }
    let body: NeonErrorBody = {};
    try {
      body = (await res.json()) as NeonErrorBody;
    } catch {
      // non-JSON body
    }
    const err = new NeonApiError(
      res.status,
      body.message ?? res.statusText,
      body.code,
    );
    if (res.status === 423 && attempt < LOCKED_MAX_RETRIES) {
      // 1s, 2s, 4s, 8s — ~15s total, leaves headroom under CF's edge
      // timeout for the rest of the provisioning pipeline.
      await sleep(LOCKED_BASE_DELAY_MS * 2 ** attempt);
      continue;
    }
    throw err;
  }
  // Unreachable — the loop either returns or throws.
  throw new NeonApiError(500, "neon retry loop exhausted without decision");
}

// ---------- Branches ----------

interface NeonBranch {
  id: string;
  name: string;
  default?: boolean;
  primary?: boolean;
}

interface NeonEndpoint {
  id: string;
  host: string;
  type: "read_write" | "read_only";
  branch_id: string;
}

interface ListBranchesResponse {
  branches: NeonBranch[];
}

interface ListEndpointsResponse {
  endpoints: NeonEndpoint[];
}

export async function getDefaultBranchId(): Promise<string> {
  const res = await request<ListBranchesResponse>(
    `/projects/${projectId()}/branches`,
  );
  const def =
    res.branches.find((b) => b.default) ??
    res.branches.find((b) => b.primary) ??
    res.branches[0];
  if (!def) throw new Error("no branches on Neon project");
  return def.id;
}

export async function getReadWriteEndpoint(
  branchId: string,
): Promise<NeonEndpoint> {
  const res = await request<ListEndpointsResponse>(
    `/projects/${projectId()}/endpoints`,
  );
  const ep = res.endpoints.find(
    (e) => e.branch_id === branchId && e.type === "read_write",
  );
  if (!ep) {
    throw new Error(`no read_write endpoint on branch ${branchId}`);
  }
  return ep;
}

// ---------- Databases ----------

interface NeonDatabase {
  id: number;
  name: string;
  owner_name: string;
}

interface DatabaseResponse {
  database: NeonDatabase;
}

export async function createDatabase(params: {
  branchId: string;
  name: string;
  ownerRole: string;
}): Promise<NeonDatabase> {
  const res = await request<DatabaseResponse>(
    `/projects/${projectId()}/branches/${params.branchId}/databases`,
    {
      method: "POST",
      body: JSON.stringify({
        database: { name: params.name, owner_name: params.ownerRole },
      }),
    },
  );
  return res.database;
}

export async function deleteDatabase(params: {
  branchId: string;
  name: string;
}): Promise<void> {
  await request<void>(
    `/projects/${projectId()}/branches/${params.branchId}/databases/${params.name}`,
    { method: "DELETE" },
  );
}

// ---------- Roles ----------

interface NeonRole {
  name: string;
  password?: string;
  protected: boolean;
}

interface RoleResponse {
  role: NeonRole;
}

// The reveal_password endpoint returns the password at the top level, not
// wrapped under `role` — see Neon API docs for
// GET /projects/{id}/branches/{branch}/roles/{name}/reveal_password.
interface RevealPasswordResponse {
  password: string;
}

export async function createRole(params: {
  branchId: string;
  name: string;
}): Promise<NeonRole> {
  const res = await request<RoleResponse>(
    `/projects/${projectId()}/branches/${params.branchId}/roles`,
    {
      method: "POST",
      body: JSON.stringify({ role: { name: params.name } }),
    },
  );
  return res.role;
}

export async function revealRolePassword(params: {
  branchId: string;
  name: string;
}): Promise<string> {
  const res = await request<RevealPasswordResponse>(
    `/projects/${projectId()}/branches/${params.branchId}/roles/${params.name}/reveal_password`,
  );
  if (!res.password) {
    throw new Error(`no password returned for role ${params.name}`);
  }
  return res.password;
}

export async function deleteRole(params: {
  branchId: string;
  name: string;
}): Promise<void> {
  await request<void>(
    `/projects/${projectId()}/branches/${params.branchId}/roles/${params.name}`,
    { method: "DELETE" },
  );
}

// ---------- DSN construction ----------

/**
 * Build a direct (non-pooled) Postgres DSN. Use for Prisma migrations and
 * any workload that needs prepared statements / session state.
 */
export function buildDirectDsn(params: {
  host: string;
  role: string;
  password: string;
  database: string;
}): string {
  const encodedPw = encodeURIComponent(params.password);
  return `postgresql://${params.role}:${encodedPw}@${params.host}/${params.database}?sslmode=require`;
}

/**
 * Build a pooled Postgres DSN (Neon's PgBouncer, transaction mode). Use for
 * runtime queries. Prisma auto-disables prepared statements when it sees
 * `pgbouncer=true`.
 *
 * Neon's pooler host is the read-write host with `-pooler` inserted before
 * the first `.`. e.g. `ep-foo-123.eu-central-1.aws.neon.tech` →
 * `ep-foo-123-pooler.eu-central-1.aws.neon.tech`.
 */
export function buildPooledDsn(params: {
  host: string;
  role: string;
  password: string;
  database: string;
}): string {
  const [head, ...rest] = params.host.split(".");
  const pooledHost = [`${head}-pooler`, ...rest].join(".");
  const encodedPw = encodeURIComponent(params.password);
  return `postgresql://${params.role}:${encodedPw}@${pooledHost}/${params.database}?sslmode=require&pgbouncer=true&connection_limit=1`;
}
