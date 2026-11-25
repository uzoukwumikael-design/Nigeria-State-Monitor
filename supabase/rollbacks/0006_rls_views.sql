set search_path = public, extensions;

drop view if exists public_economic_observations;
drop view if exists published_event_updates;
drop view if exists published_event_sources;
drop view if exists published_events;
drop view if exists public_states;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on all tables in schema public from service_role';
  end if;
end
$$;
