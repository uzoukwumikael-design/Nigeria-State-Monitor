// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPostgresPoolConfig,
  describePostgresConnection,
} from "@/lib/data/postgres/client";

const TRANSACTION_URL =
  "postgresql://postgres.abcdefghijklmnop:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true";
const SESSION_URL =
  "postgresql://postgres.abcdefghijklmnop:secret@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full";
const DIRECT_URL =
  "postgresql://postgres:secret@db.abcdefghijklmnop.supabase.co:5432/postgres";
const SELF_HOSTED_URL = "postgresql://nsm:secret@db.internal.example.com:5432/nsm";
const LOCAL_URL = "postgresql://nsm:secret@localhost:5432/nsm";

describe("buildPostgresPoolConfig", () => {
  it("strips sslmode, pgbouncer and SSL params and encrypts Supabase transaction-pooler connections", () => {
    const config = buildPostgresPoolConfig(TRANSACTION_URL, {});
    expect(config.ssl).toMatchObject({ rejectUnauthorized: false });
    expect(config.connectionString).not.toContain("sslmode");
    expect(config.connectionString).not.toContain("pgbouncer");
    expect(config.max).toBe(5);
    expect(config.options).toBeUndefined();
    expect(config.application_name).toBe("nigeria-state-monitor");
  });

  it("ignores URL ssl/options overrides that pg would apply over explicit config", () => {
    const config = buildPostgresPoolConfig(
      `${LOCAL_URL}?ssl=true&options=-c%20search_path%3Devil&connection_limit=99`,
      {},
    );
    expect(config.ssl).toMatchObject({ rejectUnauthorized: false });
    expect(config.connectionString).not.toContain("ssl=");
    expect(config.connectionString).not.toContain("options=");
    expect(config.connectionString).not.toContain("connection_limit");
    expect(config.options).toBe("-c search_path=public,extensions");

    const disabled = buildPostgresPoolConfig(`${LOCAL_URL}?ssl=false`, {});
    expect(disabled.ssl).toBe(false);
  });

  it("avoids startup search-path options on Supabase poolers", () => {
    const session = buildPostgresPoolConfig(SESSION_URL, {});
    expect(session.ssl).toMatchObject({ rejectUnauthorized: true });
    expect(session.options).toBeUndefined();

    const direct = buildPostgresPoolConfig(DIRECT_URL, {});
    expect(direct.ssl).toMatchObject({ rejectUnauthorized: false });
    expect(direct.options).toBeUndefined();
  });

  it("keeps the search path startup option for self-hosted direct connections", () => {
    const config = buildPostgresPoolConfig(SELF_HOSTED_URL, {
      DATABASE_SEARCH_PATH: "public, extensions",
    });
    expect(config.options).toBe("-c search_path=public,extensions");
  });

  it("honours explicit SSL overrides and removes sslmode from the URL", () => {
    const require = buildPostgresPoolConfig(`${LOCAL_URL}?sslmode=require`, {});
    expect(require.ssl).toMatchObject({ rejectUnauthorized: false });
    expect(require.connectionString).not.toContain("sslmode");

    const verify = buildPostgresPoolConfig(LOCAL_URL, { DATABASE_SSL: "verify-full" });
    expect(verify.ssl).toMatchObject({ rejectUnauthorized: true });

    const disabled = buildPostgresPoolConfig(DIRECT_URL, { DATABASE_SSL: "disable" });
    expect(disabled.ssl).toBe(false);
  });

  it("loads a custom certificate authority for verify-full", () => {
    const directory = mkdtempSync(join(tmpdir(), "nsm-ca-"));
    const caPath = join(directory, "ca.pem");
    try {
      writeFileSync(caPath, "test-ca-certificate", "utf8");
      const config = buildPostgresPoolConfig(LOCAL_URL, {
        DATABASE_SSL: "verify-full",
        DATABASE_SSL_CA: caPath,
      });
      expect(config.ssl).toMatchObject({
        ca: "test-ca-certificate",
        rejectUnauthorized: true,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a CA combined with disabled SSL", () => {
    expect(() =>
      buildPostgresPoolConfig(LOCAL_URL, {
        DATABASE_SSL: "disable",
        DATABASE_SSL_CA: "missing.pem",
      }),
    ).toThrow(/cannot be used together/);
  });

  it("normalises the search path and rejects injection-shaped values", () => {
    const config = buildPostgresPoolConfig(SELF_HOSTED_URL, {
      DATABASE_SEARCH_PATH: " public, extensions ",
    });
    expect(config.options).toBe("-c search_path=public,extensions");

    expect(() =>
      buildPostgresPoolConfig(SESSION_URL, { DATABASE_SEARCH_PATH: "public; drop table events" }),
    ).toThrow(/Invalid schema/);
    expect(() =>
      buildPostgresPoolConfig(SESSION_URL, { DATABASE_SEARCH_PATH: "," }),
    ).toThrow(/at least one schema/);
  });

  it("validates and clamps DATABASE_POOL_MAX", () => {
    expect(buildPostgresPoolConfig(LOCAL_URL, { DATABASE_POOL_MAX: "2" }).max).toBe(2);
    expect(buildPostgresPoolConfig(LOCAL_URL, { DATABASE_POOL_MAX: "99" }).max).toBe(20);
    expect(() => buildPostgresPoolConfig(LOCAL_URL, { DATABASE_POOL_MAX: "0" })).toThrow(
      /positive integer/,
    );
    expect(() => buildPostgresPoolConfig(LOCAL_URL, { DATABASE_POOL_MAX: "abc" })).toThrow(
      /positive integer/,
    );
  });

  it("rejects unknown SSL modes and non-Postgres protocols", () => {
    expect(() => buildPostgresPoolConfig(LOCAL_URL, { DATABASE_SSL: "sometimes" })).toThrow(
      /Unknown DATABASE_SSL/,
    );
    expect(() => buildPostgresPoolConfig(`${LOCAL_URL}?sslmode=typo`, {})).toThrow(
      /Unknown sslmode/,
    );
    expect(() => buildPostgresPoolConfig("mysql://user:pass@localhost/db", {})).toThrow(
      /postgresql:\/\//,
    );
  });
});

describe("describePostgresConnection", () => {
  it("classifies a Supabase transaction pooler without exposing the password", () => {
    const info = describePostgresConnection(TRANSACTION_URL, {});
    expect(info).toMatchObject({
      host: "aws-0-eu-west-1.pooler.supabase.com",
      port: 6543,
      database: "postgres",
      user: "postgres.abcdefghijklmnop",
      sslMode: "require",
      pooler: "transaction",
      isSupabase: true,
      searchPath: "public,extensions",
      usesStartupSearchPath: false,
      poolMax: 5,
    });
    expect(JSON.stringify(info)).not.toContain("secret");
  });

  it("classifies session/direct connections and defaults local SSL off", () => {
    expect(describePostgresConnection(SESSION_URL, {})).toMatchObject({
      port: 5432,
      pooler: "session",
      sslMode: "verify-full",
    });
    expect(describePostgresConnection(DIRECT_URL, {})).toMatchObject({
      pooler: "direct",
      sslMode: "require",
    });
    expect(describePostgresConnection(LOCAL_URL, {})).toMatchObject({
      host: "localhost",
      sslMode: "default",
      pooler: "direct",
      isSupabase: false,
    });
  });
});
