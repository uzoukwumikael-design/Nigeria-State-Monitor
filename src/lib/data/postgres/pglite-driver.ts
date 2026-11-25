import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import type { DatabaseDriver, DatabaseRow, QueryExecutor } from "@/lib/data/postgres/driver";

/**
 * PGlite + PostGIS is the local verification database. It is not selected by
 * the application runtime; production uses the `pg` driver.
 */
export class PgliteDriver implements DatabaseDriver {
  private constructor(private readonly db: PGlite) {}

  static async create(): Promise<PgliteDriver> {
    const db = await PGlite.create({ extensions: { postgis } });
    // Mirror Supabase: PostGIS lives in `extensions`, while application tables
    // live in `public`. Migration files also set this path defensively.
    await db.exec("create schema if not exists extensions;");
    await db.exec("set search_path = public, extensions;");
    return new PgliteDriver(db);
  }

  async query<T = DatabaseRow>(sql: string, params?: readonly unknown[]) {
    const result = await this.db.query<T>(sql, params as unknown[] | undefined);
    return { rows: result.rows };
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  async transaction<T>(work: (tx: QueryExecutor) => Promise<T>): Promise<T> {
    await this.db.exec("begin");
    try {
      const result = await work({
        query: this.query.bind(this),
        exec: this.exec.bind(this),
      });
      await this.db.exec("commit");
      return result;
    } catch (error) {
      await this.db.exec("rollback");
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
