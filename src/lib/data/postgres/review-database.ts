import type { DatabaseDriver } from "@/lib/data/postgres/driver";
import { getPostgresDriver } from "@/lib/data/postgres/client";

/**
 * Server-only driver for reviewer and scheduler write paths. The public
 * repository path already has its own cached driver; this helper is never
 * imported by a client component.
 */
export function requireReviewDatabase(): DatabaseDriver {
  const repository = process.env.NSM_REPOSITORY?.trim().toLowerCase();
  if (repository !== "postgres") {
    throw new Error(
      "Review actions require NSM_REPOSITORY=postgres and a server-side DATABASE_URL.",
    );
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is required for review actions.");
  }
  return getPostgresDriver(url);
}

export function reviewDatabaseAvailable(): boolean {
  return (
    process.env.NSM_REPOSITORY?.trim().toLowerCase() === "postgres" &&
    Boolean(process.env.DATABASE_URL?.trim())
  );
}
