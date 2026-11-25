import { readFileSync } from "node:fs";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { DatabaseDriver, DatabaseRow, QueryExecutor } from "@/lib/data/postgres/driver";

type Env = Record<string, string | undefined>;

export type PostgresPooler = "direct" | "session" | "transaction";
export type PostgresSslMode = "default" | "disable" | "require" | "verify-full";

export interface PostgresConnectionInfo {
  host: string;
  port: number;
  database: string;
  user: string;
  sslMode: PostgresSslMode;
  pooler: PostgresPooler;
  isSupabase: boolean;
  searchPath: string;
  usesStartupSearchPath: boolean;
  poolMax: number;
}

const DEFAULT_SEARCH_PATH = "public,extensions";
const DEFAULT_POOL_MAX = 5;
const MAX_POOL_MAX = 20;

function parseUrl(connectionString: string): URL {
  let url: URL;
  try {
    url = new URL(connectionString.trim());
  } catch {
    throw new Error(
      "The database connection string must be a PostgreSQL URI such as postgresql://user:password@host:5432/postgres.",
    );
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("The database connection string must use the postgresql:// or postgres:// scheme.");
  }
  return url;
}

function isSupabaseHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "supabase.co" ||
    host === "supabase.com" ||
    host.endsWith(".supabase.co") ||
    host.endsWith(".supabase.com") ||
    host.includes(".pooler.supabase.com")
  );
}

/**
 * Supabase uses port 6543 for transaction pooling and port 5432 for session
 * pooling/direct connections. Port 6543 is also treated as transaction mode
 * for self-hosted poolers because it is the common convention.
 */
function classifyPooler(url: URL): PostgresPooler {
  const port = Number(url.port || 5432);
  if (port === 6543) return "transaction";
  if (url.hostname.toLowerCase().includes(".pooler.supabase.com")) return "session";
  return "direct";
}

function resolveSslMode(
  hostname: string,
  urlSslMode: string | null,
  override: string | undefined,
): PoolConfig["ssl"] {
  const configured = override?.trim().toLowerCase();
  if (configured) {
    switch (configured) {
      case "disable":
      case "false":
      case "off":
        return false;
      case "require":
      case "no-verify":
        return { rejectUnauthorized: false };
      case "verify":
      case "verify-full":
      case "true":
        return { rejectUnauthorized: true };
      default:
        throw new Error(
          `Unknown DATABASE_SSL value "${configured}". Use disable, require or verify-full.`,
        );
    }
  }

  if (urlSslMode) {
    switch (urlSslMode) {
      case "disable":
        return false;
      case "allow":
      case "prefer":
      case "require":
        // Encrypt without CA verification. This matches libpq's require mode
        // and avoids breaking hosted connections with platform-managed CAs.
        return { rejectUnauthorized: false };
      case "verify-ca":
      case "verify-full":
        return { rejectUnauthorized: true };
      default:
        throw new Error(
          `Unknown sslmode "${urlSslMode}" in the connection string. Use disable, require or verify-full.`,
        );
    }
  }

  if (isSupabaseHost(hostname)) {
    return { rejectUnauthorized: false };
  }

  return undefined;
}

function resolveSearchPath(override: string | undefined): string {
  const raw = override?.trim() || DEFAULT_SEARCH_PATH;
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new Error("DATABASE_SEARCH_PATH must contain at least one schema name.");
  }
  for (const part of parts) {
    if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(part)) {
      throw new Error(
        `Invalid schema "${part}" in DATABASE_SEARCH_PATH. Use comma-separated unquoted schema names.`,
      );
    }
  }
  return parts.join(",");
}

function resolvePoolMax(value: string | undefined): number {
  const raw = value?.trim();
  if (!raw) return DEFAULT_POOL_MAX;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("DATABASE_POOL_MAX must be a positive integer (maximum 20).");
  }
  return Math.min(parsed, MAX_POOL_MAX);
}

function withCertificateAuthority(
  ssl: PoolConfig["ssl"],
  caPath: string | undefined,
): PoolConfig["ssl"] {
  const path = caPath?.trim();
  if (!path) return ssl;
  if (ssl === false) {
    throw new Error("DATABASE_SSL_CA cannot be used together with DATABASE_SSL=disable.");
  }
  let ca: string;
  try {
    ca = readFileSync(path, "utf8");
  } catch {
    throw new Error(`DATABASE_SSL_CA could not be read at ${path}.`);
  }
  return {
    ...(typeof ssl === "object" ? ssl : {}),
    ca,
    rejectUnauthorized: true,
  };
}

function sslModeOf(ssl: PoolConfig["ssl"]): PostgresSslMode {
  if (ssl === false) return "disable";
  if (!ssl) return "default";
  if (ssl === true) return "verify-full";
  return ssl.rejectUnauthorized === false ? "require" : "verify-full";
}

/**
 * Build a pg pool configuration that works with hosted Supabase without
 * leaking hosted-specific assumptions into the repository. Supabase's
 * connection strings are ordinary Postgres URIs, but the pooler, SSL and
 * PostGIS schema need to be explicit.
 *
 * The shared transaction pooler ignores session-level startup options in some
 * versions, so `options` is only sent to direct/session connections. Runtime
 * SQL qualifies PostGIS functions with `extensions.` and migrations set their
 * own search_path, so transaction-pooled queries remain correct either way.
 */
export function buildPostgresPoolConfig(
  connectionString: string,
  env: Env = process.env,
): PoolConfig {
  const url = parseUrl(connectionString);

  // pg merges the parsed connection string over the explicit config, so any
  // supported query parameter left in the URL can silently override SSL or
  // options. Normalise them here and set both explicitly below.
  let urlSslMode: string | null = null;
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    const value = url.searchParams.get(key)?.trim().toLowerCase() ?? "";
    if (lower === "sslmode") {
      urlSslMode ??= value || null;
      url.searchParams.delete(key);
    } else if (lower === "ssl") {
      if (!urlSslMode) {
        if (["true", "1", "yes", "on"].includes(value)) urlSslMode = "require";
        else if (["false", "0", "no", "off"].includes(value)) urlSslMode = "disable";
      }
      url.searchParams.delete(key);
    } else if (lower === "options" || lower === "pgbouncer" || lower === "connection_limit") {
      url.searchParams.delete(key);
    }
  }

  const ssl = withCertificateAuthority(
    resolveSslMode(url.hostname, urlSslMode, env.DATABASE_SSL),
    env.DATABASE_SSL_CA,
  );
  const searchPath = resolveSearchPath(env.DATABASE_SEARCH_PATH);
  const config: PoolConfig = {
    connectionString: url.toString(),
    ssl,
    max: resolvePoolMax(env.DATABASE_POOL_MAX),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    application_name: "nigeria-state-monitor",
  };

  // Supabase poolers are inconsistent about startup options. Runtime SQL
  // schema-qualifies PostGIS and migrations set their own search_path, so
  // hosted connections do not send the option at all.
  if (!isSupabaseHost(url.hostname) && classifyPooler(url) !== "transaction") {
    config.options = `-c search_path=${searchPath}`;
  }

  return config;
}

/**
 * Password-free description of a connection for `db:doctor` output.
 */
export function describePostgresConnection(
  connectionString: string,
  env: Env = process.env,
): PostgresConnectionInfo {
  const url = parseUrl(connectionString);
  const config = buildPostgresPoolConfig(connectionString, env);
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.replace(/^\/+/, "")) || "postgres",
    user: decodeURIComponent(url.username) || "(default)",
    sslMode: sslModeOf(config.ssl),
    pooler: classifyPooler(url),
    isSupabase: isSupabaseHost(url.hostname),
    searchPath: resolveSearchPath(env.DATABASE_SEARCH_PATH),
    usesStartupSearchPath: config.options !== undefined,
    poolMax: config.max ?? DEFAULT_POOL_MAX,
  };
}

function executor(client: Pool | PoolClient): QueryExecutor {
  return {
    async query<T = DatabaseRow>(sql: string, params?: readonly unknown[]) {
      // pg's runtime accepts readonly arrays; its published type only says any[].
      const result = await client.query(sql, params as unknown[] | undefined);
      return { rows: result.rows as T[] };
    },
    async exec(sql: string) {
      await client.query(sql);
    },
  };
}

export class PostgresDriver implements DatabaseDriver {
  private readonly pool: Pool;

  constructor(connectionString: string, env: Env = process.env) {
    this.pool = new Pool(buildPostgresPoolConfig(connectionString, env));
    this.pool.on("error", (error) => {
      console.error("postgres_pool_error", error);
    });
    const base = executor(this.pool);
    this.query = base.query.bind(base);
    this.exec = base.exec.bind(base);
  }

  query: QueryExecutor["query"];
  exec: QueryExecutor["exec"];

  async transaction<T>(work: (tx: QueryExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await work(executor(client));
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

const globalForDb = globalThis as typeof globalThis & {
  __nsmPostgresDriver?: PostgresDriver;
};

export function getPostgresDriver(connectionString: string): PostgresDriver {
  if (!globalForDb.__nsmPostgresDriver) {
    globalForDb.__nsmPostgresDriver = new PostgresDriver(connectionString);
  }
  return globalForDb.__nsmPostgresDriver;
}
