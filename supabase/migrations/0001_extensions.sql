-- 0001: required database extensions.
-- PostGIS is mandatory: Nigeria State Monitor stores authoritative state
-- boundaries and evidence-gated event locations as real geometry.
--
-- Supabase installs extensions in the dedicated `extensions` schema. Keep the
-- same layout locally so migrations and the runtime use one code path.
create schema if not exists extensions;
set search_path = public, extensions;

create extension if not exists postgis with schema extensions;

-- Trigram search is useful in production but is not bundled by PGlite. The
-- application does not depend on it; keep the migration runnable locally.
do $$
begin
  create extension if not exists pg_trgm;
exception
  when others then
    raise notice 'pg_trgm unavailable in this environment: %', sqlerrm;
end
$$;
