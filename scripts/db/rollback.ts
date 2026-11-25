import { openDriver } from "./connection";
import { loadMigrationBundles } from "./load-migrations";
import { rollbackMigrations } from "@/lib/data/postgres/migrations";

function requestedSteps(): number {
  const raw = process.argv.find((argument) => argument.startsWith("--steps="));
  if (!raw) return 1;
  const value = Number(raw.slice("--steps=".length));
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("--steps must be a positive integer.");
  }
  return value;
}

async function main(): Promise<void> {
  const all = process.argv.includes("--all");
  const driver = openDriver();
  try {
    const bundles = loadMigrationBundles();
    const rolledBack = await rollbackMigrations(
      driver,
      bundles,
      { all, steps: requestedSteps() },
      console.log,
    );
    console.log(
      rolledBack.length > 0
        ? `Rolled back ${rolledBack.length} migration${rolledBack.length === 1 ? "" : "s"}.`
        : "No applied migrations to roll back.",
    );
  } finally {
    await driver.close();
  }
}

main().catch((error: unknown) => {
  console.error("Rollback failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
