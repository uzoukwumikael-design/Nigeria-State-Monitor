import { describe, expect, it } from "vitest";
import { evaluateGoLiveEnv } from "./golive";

const GOOD = {
  NSM_MODE: "production",
  NSM_REPOSITORY: "postgres",
  DATABASE_URL: "postgresql://u:p@host:6543/db",
  MIGRATION_DATABASE_URL: "postgresql://u:p@host:5432/db",
  CRON_SECRET: "a-long-random-secret-1234567890",
};
const status = (env: Record<string, string | undefined>, id: string) => evaluateGoLiveEnv(env).checks.find((check) => check.id === id)?.status;

describe("evaluateGoLiveEnv", () => {
  it("is ready with the minimum settings, warning (not failing) about AI and rate limiting", () => {
    const result = evaluateGoLiveEnv(GOOD);
    expect(result.ready).toBe(true);
    expect(status(GOOD, "ai")).toBe("warn");
    expect(status(GOOD, "rate-limit")).toBe("warn");
  });

  it("fails on an empty environment and explains each missing piece", () => {
    const result = evaluateGoLiveEnv({});
    expect(result.ready).toBe(false);
    for (const id of ["mode", "repository", "db-url", "cron-secret"]) expect(status({}, id)).toBe("fail");
  });

  it("refuses a database address exposed to the browser", () => {
    expect(status({ ...GOOD, NEXT_PUBLIC_DATABASE_URL: "postgresql://x" }, "db-url")).toBe("fail");
  });

  it("requires a long enough scheduler password", () => {
    expect(status({ ...GOOD, CRON_SECRET: "short" }, "cron-secret")).toBe("fail");
    expect(status({ ...GOOD, CRON_SECRET: "x".repeat(16) }, "cron-secret")).toBe("ok");
  });

  it("checks the AI settings that each provider needs", () => {
    expect(status({ ...GOOD, AI_PROVIDER: "openai" }, "ai")).toBe("fail");
    expect(status({ ...GOOD, AI_PROVIDER: "openai", AI_API_KEY: "k", AI_MODEL: "m" }, "ai")).toBe("ok");
    expect(status({ ...GOOD, AI_PROVIDER: "openai-compatible", AI_API_KEY: "k", AI_MODEL: "m" }, "ai")).toBe("fail");
    expect(status({ ...GOOD, AI_PROVIDER: "openai-compatible", AI_API_KEY: "k", AI_MODEL: "m", AI_BASE_URL: "https://x/v1" }, "ai")).toBe("ok");
    expect(status({ ...GOOD, AI_PROVIDER: "llama" }, "ai")).toBe("fail");
  });

  it("warns when automatic publishing is switched off and treats the reviewer console as optional", () => {
    expect(status({ ...GOOD, AUTOPUBLISH: "off" }, "autopublish")).toBe("warn");
    expect(evaluateGoLiveEnv(GOOD).checks.some((check) => check.id === "reviewer")).toBe(false);
    expect(evaluateGoLiveEnv(GOOD).ready).toBe(true);
  });
});
