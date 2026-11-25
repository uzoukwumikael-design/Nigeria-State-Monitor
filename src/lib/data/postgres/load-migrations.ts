import fs from "node:fs";
import path from "node:path";
import type { MigrationBundle } from "@/lib/data/postgres/migrations";

export function loadMigrationBundles(root = process.cwd()): MigrationBundle[] {
  const upDir = path.join(root, "supabase", "migrations");
  const downDir = path.join(root, "supabase", "rollbacks");
  const files = fs
    .readdirSync(upDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    throw new Error(`No migrations found in ${upDir}`);
  }

  const bundles = files.map((filename) => {
    const version = filename.slice(0, 4);
    if (!/^\d{4}$/.test(version)) {
      throw new Error(`Invalid migration filename: ${filename}`);
    }
    const downPath = path.join(downDir, filename);
    if (!fs.existsSync(downPath)) {
      throw new Error(`Missing rollback for ${filename} at ${downPath}`);
    }
    return {
      version,
      filename,
      upSql: fs.readFileSync(path.join(upDir, filename), "utf8"),
      downSql: fs.readFileSync(downPath, "utf8"),
    } satisfies MigrationBundle;
  });

  return bundles;
}
