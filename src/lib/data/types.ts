import type { DashboardSnapshot, IntelligenceEvent } from "@/lib/types";

export type DataMode = "demo" | "production";
export type RepositoryKind = "memory" | "postgres";

export interface DataRuntime {
  mode: DataMode;
  repository: RepositoryKind;
  database: "connected" | "not_connected";
}

export interface DataRepository {
  readonly kind: RepositoryKind;
  readonly mode: DataMode;
  getSnapshot(): Promise<DashboardSnapshot>;
  getEventById(id: string): Promise<IntelligenceEvent | null>;
  runtime(): DataRuntime;
}
