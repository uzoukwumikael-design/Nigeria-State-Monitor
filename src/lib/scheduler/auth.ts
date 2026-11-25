import { createHash, timingSafeEqual } from "node:crypto";
import type { CronAuthorization } from "./types";

export const MIN_CRON_SECRET_LENGTH = 16;
const MAX_CRON_SECRET_LENGTH = 512;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function equal(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

export function configuredCronSecret(
  env: Record<string, string | undefined> = process.env,
): { ok: true; secret: string } | { ok: false; message: string } {
  const secret = env.CRON_SECRET?.trim() ?? "";
  if (!secret) {
    return {
      ok: false,
      message: "CRON_SECRET is not configured. Scheduled ingestion is disabled.",
    };
  }
  if (
    secret.length < MIN_CRON_SECRET_LENGTH ||
    secret.length > MAX_CRON_SECRET_LENGTH ||
    /[\u0000-\u0020\u007f]/.test(secret)
  ) {
    return {
      ok: false,
      message: `CRON_SECRET must be ${MIN_CRON_SECRET_LENGTH}–${MAX_CRON_SECRET_LENGTH} non-whitespace characters.`,
    };
  }
  return { ok: true, secret };
}

function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

/** Vercel Cron and compatible schedulers send `Authorization: Bearer <secret>`. */
export function authorizeCronRequest(
  headers: Headers,
  env: Record<string, string | undefined> = process.env,
): CronAuthorization {
  const configured = configuredCronSecret(env);
  if (!configured.ok) return { ok: false, reason: "not_configured" };
  const supplied = bearerToken(headers.get("authorization"));
  if (!supplied) return { ok: false, reason: "unauthorized" };
  return equal(supplied, configured.secret) ? { ok: true } : { ok: false, reason: "unauthorized" };
}
