import { loadEnvConfig } from "@next/env";
import { executeAutopilot } from "@/lib/autopilot/execute";
import { openDriver, resolveDatabaseUrl } from "../db/connection";

const USAGE = `Nigeria State Monitor — automatic publishing

Usage:
  npm run autopilot [-- --json]

Classifies new articles (with the AI model when AI_PROVIDER is configured, otherwise with the rule-based
classifier), accepts what passes the confidence rules, attaches duplicates to existing events and publishes
the rest. No human review. Needs DATABASE_URL. AUTOPUBLISH=off stops it. Software-assigned severity is
capped at level 3 and every record is audited under the actor "system.autopublish".`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(USAGE);
    return;
  }
  loadEnvConfig(process.cwd());
  if (!resolveDatabaseUrl("admin")) {
    throw new Error("A database URL is required. Set MIGRATION_DATABASE_URL or DATABASE_URL; publishing never happens in memory.");
  }
  const driver = openDriver("admin");
  try {
    const result = await executeAutopilot(driver, { deadlineMs: Date.now() + 240_000 });
    if (args.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const { autopilot: a, enrichment: e } = result;
    console.log(`AI: ${"attempted" in e ? `${e.stored} stored of ${e.attempted} attempted` : `off (${e.error})`}`);
    console.log(
      `Considered ${a.considered}: accepted ${a.accepted}, published ${a.published}, attached to existing events ${a.attached}`,
    );
    console.log(`Declined: ${Object.entries(a.declined).map(([reason, count]) => `${reason} ${count}`).join(", ")}`);
    if (a.timeBudgetReached) console.log("Stopped early: time budget reached; the rest waits for the next run.");
    for (const message of a.errors) console.log(`  problem: ${message}`);
  } finally {
    await driver.close();
  }
}

main().catch((error: unknown) => {
  console.error("Autopilot failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
