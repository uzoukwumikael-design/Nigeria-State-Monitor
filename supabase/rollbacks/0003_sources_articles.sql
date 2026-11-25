set search_path = public, extensions;

drop index if exists articles_content_hash_idx;
drop index if exists articles_source_idx;
drop index if exists articles_published_idx;
drop index if exists raw_items_source_time_idx;
drop index if exists articles_source_canonical_idx;
drop table if exists articles;
drop table if exists raw_items;
drop table if exists sources;
