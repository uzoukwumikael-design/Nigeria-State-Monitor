set search_path = public, extensions;

drop function if exists purge_expired_ingestion_logs(interval);
drop function if exists purge_expired_raw_items(interval);
