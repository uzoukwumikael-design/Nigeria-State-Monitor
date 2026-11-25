-- 0007: retention helpers. These are operational utilities, not automatic
-- schedulers. A worker/cron invokes them after metrics have been aggregated.

set search_path = public, extensions;

create or replace function purge_expired_raw_items(older_than interval default interval '90 days')
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed bigint;
begin
  delete from raw_items
  where fetched_at < now() - older_than
    and not exists (
      select 1 from articles a where a.raw_item_id = raw_items.id
    );
  get diagnostics removed = row_count;
  return removed;
end;
$$;

create or replace function purge_expired_ingestion_logs(older_than interval default interval '90 days')
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed bigint;
begin
  delete from ingestion_logs where created_at < now() - older_than;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function purge_expired_raw_items(interval) from public;
revoke all on function purge_expired_ingestion_logs(interval) from public;

comment on function purge_expired_raw_items(interval) is
  'Deletes old raw payload metadata only when no article still references it.';
comment on function purge_expired_ingestion_logs(interval) is
  'Deletes old ingestion logs after aggregate metrics have been retained.';
