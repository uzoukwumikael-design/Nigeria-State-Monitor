import { loadEnvConfig } from "@next/env";
import { PostgresDriver } from "@/lib/data/postgres/client";
import type { DatabaseDriver } from "@/lib/data/postgres/driver";

loadEnvConfig(process.cwd());

export type DatabaseConnectionRole = "admin" | "runtime";

export interface ResolvedDatabaseUrl {
  url: string;
  variable: "MIGRATION_DATABASE_URL" | "DATABASE_URL";
}

/**
 * Admin commands (migrate/rollback/seed/verify/doctor) prefer the session or
 * direct URL. The application runtime always uses DATABASE_URL, which may be
 * the transaction pooler.
 */
export function resolveDatabaseUrl(
  role: DatabaseConnectionRole = "admin",
): ResolvedDatabaseUrl | null {
  const migration = process.env.MIGRATION_DATABASE_URL?.trim();
  const runtime = process.env.DATABASE_URL?.trim();

  if (role === "admin" && migration) {
    return { url: migration, variable: "MIGRATION_DATABASE_URL" };
  }
  if (runtime) {
    return { url: runtime, variable: "DATABASE_URL" };
  }
  return null;
}

export function requireDatabaseUrl(role: DatabaseConnectionRole = "admin"): string {
  const resolved = resolveDatabaseUrl(role);
  if (resolved) return resolved.url;

  if (role === "admin") {
    throw new Error(
      "MIGRATION_DATABASE_URL or DATABASE_URL is required for database commands. " +
        "Use the Supabase session pooler or direct connection; never expose it to the client.",
    );
  }
  throw new Error(
    "DATABASE_URL is required for the Postgres repository. " +
      "Use the Supabase transaction pooler URL on the server; never expose it to the client.",
  );
}

export function openDriver(role: DatabaseConnectionRole = "admin"): DatabaseDriver {
  return new PostgresDriver(requireDatabaseUrl(role));
}
