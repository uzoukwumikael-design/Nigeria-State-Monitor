import { MemoryDemoRepository } from "@/lib/data/demo-repository";
import { getPostgresDriver } from "@/lib/data/postgres/client";
import { PostgresRepository } from "@/lib/data/postgres/repository";
import { DATA_MODE } from "@/lib/data/mode";
import type { DataRepository, DataRuntime } from "@/lib/data/types";
import type { DashboardSnapshot, IntelligenceEvent } from "@/lib/types";

export { DATA_MODE } from "@/lib/data/mode";

let repositoryPromise: Promise<DataRepository> | null = null;

async function buildRepository(): Promise<DataRepository> {
  const configured = process.env.NSM_REPOSITORY?.trim().toLowerCase();
  const kind = configured || (DATA_MODE === "production" ? "postgres" : "memory");

  if (kind === "memory") {
    if (DATA_MODE === "production") {
      throw new Error(
        "NSM_MODE=production requires NSM_REPOSITORY=postgres. The in-memory demo repository is never a production data source.",
      );
    }
    return new MemoryDemoRepository();
  }

  if (kind !== "postgres") {
    throw new Error(`Unknown NSM_REPOSITORY "${kind}". Use "memory" or "postgres".`);
  }

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "NSM_REPOSITORY=postgres requires DATABASE_URL. Use the Supabase transaction pooler URL on the server only.",
    );
  }

  return new PostgresRepository(getPostgresDriver(connectionString), DATA_MODE);
}

function repository(): Promise<DataRepository> {
  if (!repositoryPromise) {
    repositoryPromise = buildRepository().catch((error: unknown) => {
      repositoryPromise = null;
      throw error;
    });
  }
  return repositoryPromise;
}

export async function getSnapshot(): Promise<DashboardSnapshot> {
  return (await repository()).getSnapshot();
}

export async function getEventById(id: string): Promise<IntelligenceEvent | null> {
  return (await repository()).getEventById(id);
}

export async function getDataRuntime(): Promise<DataRuntime> {
  return (await repository()).runtime();
}
