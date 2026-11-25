import { openDriver } from "./connection";
import { seedRegistry } from "@/lib/data/postgres/seed";

async function main(): Promise<void> {
  const driver = openDriver();
  try {
    const result = await driver.transaction((tx) => seedRegistry(tx));
    console.log(`Seeded ${result.states} authoritative state boundaries from the checked-in GRID3 output.`);
  } finally {
    await driver.close();
  }
}

main().catch((error: unknown) => {
  console.error("Registry seed failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
