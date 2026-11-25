import { loadEnvConfig } from "@next/env";
import { inspectMigrations } from "@/lib/data/postgres/migrations";
import { loadMigrationBundles } from "@/lib/data/postgres/load-migrations";
import { evaluateGoLiveEnv, type CheckStatus } from "@/lib/setup/golive";
import { openDriver, resolveDatabaseUrl } from "../db/connection";

const MARK: Record<CheckStatus, string> = { ok: "✓", fail: "✗", warn: "!", info: "·" };

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const { checks, ready } = evaluateGoLiveEnv(process.env);
  console.log("Nigeria State Monitor — go-live check\n");
  for (const check of checks) console.log(`${MARK[check.status]} ${check.label.padEnd(24)} ${check.detail}`);

  let databaseReady = false;
  if (resolveDatabaseUrl("admin")) {
    try {
      const driver = openDriver("admin");
      try {
        const status = await inspectMigrations(driver, loadMigrationBundles(process.cwd()));
        const states = await driver
          .query<{ count: string }>("select count(*)::text as count from states")
          .then((result) => Number(result.rows[0]?.count ?? 0))
          .catch(() => 0);
        databaseReady = status.pending.length === 0 && states === 37;
        console.log(
          `${databaseReady ? "✓" : "✗"} ${"Database".padEnd(24)} ${
            databaseReady
              ? "Connected, all migrations applied, 37 states loaded."
              : `Connected, but setup is incomplete (${status.pending.length} migrations pending, ${states} of 37 states). Run the setup address (see docs/GO_LIVE.md) or npm run db:setup:registry.`
          }`,
        );
      } finally {
        await driver.close();
      }
    } catch (error) {
      console.log(`✗ ${"Database".padEnd(24)} Could not connect: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
    }
  }

  const all = ready && databaseReady;
  console.log(`\n${all ? "Ready to go live." : "Not ready yet: fix the ✗ lines above."} (! lines are optional improvements.)`);
  if (!all) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("Go-live check failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
