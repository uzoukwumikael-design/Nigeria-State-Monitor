import { openDriver } from "./connection";
import { buildDemoSnapshot } from "@/lib/demo/build";
import { seedDemoData, seedRegistry } from "@/lib/data/postgres/seed";

async function main(): Promise<void> {
  if (process.env.NSM_MODE === "production") {
    throw new Error("Refusing to seed demo data while NSM_MODE=production.");
  }
  const snapshot = buildDemoSnapshot();
  const driver = openDriver();
  try {
    const result = await driver.transaction(async (tx) => {
      const registry = await seedRegistry(tx);
      const demo = await seedDemoData(tx, snapshot);
      return { ...demo, states: registry.states };
    });
    console.log("DEMO DATA SEEDED — fictional records only.");
    console.log(
      `${result.states} states, ${result.sources} demo sources, ${result.events} demo events, ` +
        `${result.evidenceLinks} evidence links, ${result.timelineEntries} timeline entries, ` +
        `${result.relations} event relations.`,
    );
  } finally {
    await driver.close();
  }
}

main().catch((error: unknown) => {
  console.error("Demo seed failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
