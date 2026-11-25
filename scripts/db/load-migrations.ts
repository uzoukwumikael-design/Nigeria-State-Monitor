// The loader lives in the application code so the protected /api/cron/setup route can use it too.
export { loadMigrationBundles } from "@/lib/data/postgres/load-migrations";
