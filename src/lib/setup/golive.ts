export type CheckStatus = "ok" | "fail" | "warn" | "info";

export interface GoLiveCheck {
  id: string;
  status: CheckStatus;
  label: string;
  detail: string;
}

type Env = Record<string, string | undefined>;

const has = (value: string | undefined): value is string => Boolean(value && value.trim());

/** Pure review of the environment for a live deployment. The command adds database checks on top. */
export function evaluateGoLiveEnv(env: Env): { checks: GoLiveCheck[]; ready: boolean } {
  const checks: GoLiveCheck[] = [];
  const add = (id: string, status: CheckStatus, label: string, detail: string) => checks.push({ id, status, label, detail });

  if (env.NSM_MODE?.trim() === "production") add("mode", "ok", "Live mode", "NSM_MODE=production");
  else add("mode", "fail", "Live mode", "Set NSM_MODE=production. Without it the site shows the fictional demo data.");

  if (env.NSM_REPOSITORY?.trim().toLowerCase() === "postgres") add("repository", "ok", "Database storage", "NSM_REPOSITORY=postgres");
  else add("repository", "fail", "Database storage", "Set NSM_REPOSITORY=postgres. Live mode cannot run from memory.");

  if (has(env.NEXT_PUBLIC_DATABASE_URL)) {
    add("db-url", "fail", "Database address", "NEXT_PUBLIC_DATABASE_URL would expose your database to every visitor. Delete it and use DATABASE_URL.");
  } else if (has(env.DATABASE_URL)) {
    add("db-url", "ok", "Database address", "DATABASE_URL is set (server-only).");
  } else {
    add("db-url", "fail", "Database address", "Set DATABASE_URL to your Supabase connection string (transaction pooler, port 6543).");
  }

  if (has(env.MIGRATION_DATABASE_URL)) add("migration-url", "ok", "Setup connection", "MIGRATION_DATABASE_URL is set.");
  else add("migration-url", "warn", "Setup connection", "MIGRATION_DATABASE_URL is not set, so setup uses DATABASE_URL. If setup fails, use the session pooler (port 5432) here.");

  const secret = env.CRON_SECRET?.trim() ?? "";
  if (secret.length >= 16) add("cron-secret", "ok", "Scheduler password", "CRON_SECRET is set.");
  else if (secret.length > 0) add("cron-secret", "fail", "Scheduler password", "CRON_SECRET is too short. Use at least 16 characters (24 or more is better).");
  else add("cron-secret", "fail", "Scheduler password", "Set CRON_SECRET. Without it the scheduled endpoints refuse to run.");

  const provider = (env.AI_PROVIDER ?? "disabled").trim().toLowerCase() || "disabled";
  if (provider === "disabled") {
    add("ai", "warn", "AI sorting", "AI is off, so articles are sorted by the built-in rules only. Set AI_PROVIDER to turn the AI model on.");
  } else if (provider !== "openai" && provider !== "openai-compatible") {
    add("ai", "fail", "AI sorting", `AI_PROVIDER="${provider}" is not supported. Use disabled, openai or openai-compatible.`);
  } else {
    const missing = [
      !has(env.AI_API_KEY) && "AI_API_KEY",
      !has(env.AI_MODEL) && "AI_MODEL",
      provider === "openai-compatible" && !has(env.AI_BASE_URL) && "AI_BASE_URL",
    ].filter(Boolean);
    if (missing.length) add("ai", "fail", "AI sorting", `Missing: ${missing.join(", ")}.`);
    else add("ai", "ok", "AI sorting", `${provider} with model ${env.AI_MODEL}.`);
  }

  const autopublish = env.AUTOPUBLISH?.trim().toLowerCase();
  if (autopublish === "off" || autopublish === "false" || autopublish === "0") {
    add("autopublish", "warn", "Automatic publishing", "AUTOPUBLISH is off: articles are collected but nothing is published.");
  } else {
    add("autopublish", "ok", "Automatic publishing", "On.");
  }

  if (has(env.UPSTASH_REDIS_REST_URL) && has(env.UPSTASH_REDIS_REST_TOKEN)) add("rate-limit", "ok", "Rate limiting", "Shared limiter (Upstash).");
  else add("rate-limit", "warn", "Rate limiting", "Using the per-server limiter. Fine to start; add Upstash keys to share limits across servers.");

  if (has(env.INGESTION_DISABLE)) add("disabled", "info", "Switched-off sources", `INGESTION_DISABLE=${env.INGESTION_DISABLE}`);
  if (has(env.REVIEWER_CREDENTIALS)) add("reviewer", "info", "Reviewer console", "Configured (optional: publishing does not need it).");

  return { checks, ready: checks.every((check) => check.status !== "fail") };
}
