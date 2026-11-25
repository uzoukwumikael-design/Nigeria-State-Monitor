-- 0003: immutable source evidence and publisher-level article records.
-- An article is never an event. Events are recorded in 0004.

set search_path = public, extensions;

create table raw_items (
  id                uuid primary key default gen_random_uuid(),
  source_id         uuid not null,
  external_id       text,
  fetched_at        timestamptz not null default now(),
  http_status       integer,
  content_type      text,
  payload_hash      text not null unique,
  storage_path      text,
  title_hint        text,
  published_hint    timestamptz,
  is_demo           boolean not null default false,
  created_at        timestamptz not null default now()
);

create table sources (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name                  text not null,
  source_type           text not null check (source_type in (
                          'news', 'official', 'international', 'aggregator',
                          'research', 'demo'
                        )),
  tier                  text not null check (tier in (
                          'official', 'major_publisher', 'regional_publisher',
                          'aggregator', 'unknown'
                        )),
  base_url              text,
  feed_url              text,
  access_method         text not null check (access_method in (
                          'rss', 'api', 'html', 'manual', 'gdelt', 'reliefweb', 'demo'
                        )),
  independence_group    text not null,
  licence_status        text not null default 'unreviewed' check (licence_status in (
                          'unreviewed', 'approved', 'restricted', 'rejected'
                        )),
  attribution           text,
  reliability_note      text not null default '',
  active                boolean not null default false,
  is_demo               boolean not null default false,
  sort_order            integer not null default 0,
  last_successful_sync  timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint sources_demo_type check (not is_demo or source_type = 'demo'),
  constraint sources_demo_base_url check (not is_demo or base_url is null),
  constraint sources_production_base_url check (is_demo or base_url is not null)
);

create table articles (
  id                uuid primary key default gen_random_uuid(),
  public_id         text not null unique,
  source_id         uuid not null references sources(id),
  external_id       text,
  original_title    text not null,
  original_url      text,
  canonical_url     text,
  excerpt           text,
  body_hash         text,
  content_hash      text not null unique,
  published_at      timestamptz,
  retrieved_at      timestamptz not null default now(),
  language          text not null default 'en',
  state_id          text references states(id),
  lga               text,
  raw_item_id       uuid references raw_items(id) on delete set null,
  is_demo           boolean not null default false,
  created_at        timestamptz not null default now(),
  constraint articles_demo_urls check (not is_demo or (original_url is null and canonical_url is null)),
  constraint articles_production_urls check (is_demo or (original_url is not null and canonical_url is not null))
);

alter table raw_items
  add constraint raw_items_source_fk foreign key (source_id) references sources(id) on delete cascade;

create unique index articles_source_canonical_idx
  on articles (source_id, canonical_url) where canonical_url is not null;
create index raw_items_source_time_idx on raw_items (source_id, fetched_at desc);
create index articles_published_idx on articles (published_at desc);
create index articles_source_idx on articles (source_id, published_at desc);
create index articles_content_hash_idx on articles (content_hash);
