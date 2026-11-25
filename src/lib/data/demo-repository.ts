import { buildDemoSnapshot } from "@/lib/demo/build";
import type { DashboardSnapshot, IntelligenceEvent } from "@/lib/types";
import type { DataRepository, DataRuntime } from "@/lib/data/types";

/**
 * Development/demo repository. It is deliberately in-process: no database is
 * required to run the labelled demo dashboard. Production mode can never select
 * this implementation.
 */
export class MemoryDemoRepository implements DataRepository {
  readonly kind = "memory" as const;
  readonly mode = "demo" as const;

  async getSnapshot(): Promise<DashboardSnapshot> {
    const snapshot = buildDemoSnapshot();
    if (snapshot.events.some((event) => !event.isDemo)) {
      throw new Error("Demo repository contains a non-demo event; refusing to serve mixed data.");
    }
    return snapshot;
  }

  async getEventById(id: string): Promise<IntelligenceEvent | null> {
    const snapshot = await this.getSnapshot();
    return snapshot.events.find((event) => event.id === id) ?? null;
  }

  runtime(): DataRuntime {
    return { mode: this.mode, repository: this.kind, database: "not_connected" };
  }
}
