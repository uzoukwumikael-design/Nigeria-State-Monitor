import { openDriver } from "./connection";
import { loadMigrationBundles } from "./load-migrations";
import { applyMigrations } from "@/lib/data/postgres/migrations";

async function main(): Promise<void> {
  const driver = openDriver();
  try {
    const bundles = loadMigrationBundles();
    const applied = await applyMigrations(driver, bundles, console.log);
    console.log(
      applied.length > 0
        ? `Database schema is current (${applied.length} migration${applied.length === 1 ? "" : "s"} applied).`
        : "Database schema is already current.",
    );
  } finally {
    await driver.close();
  }
}

main().catch((error: unknown) => {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
