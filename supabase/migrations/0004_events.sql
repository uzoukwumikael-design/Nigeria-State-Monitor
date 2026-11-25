-- 0004: events, evidence joins, append-only updates and clustering review.

set search_path = public, extensions;

create table events (
  id                    uuid primary key default gen_random_uuid(),
  public_id             text not null unique,
  slug                  text not null unique,
  title                 text not null,
  summary               text not null,
  category              text not null check (category in (
                          'security', 'politics', 'economy',
                          'infrastructure', 'environment', 'health'
                        )),
  subcategory           text not null default '',
  severity              smallint not null check (severity between 1 and 5),
  severity_rationale    text not null,
  state_id              text references states(id),
  lga                   text,
  location              geography(Point, 4326),
  geo_precision         text not null check (geo_precision in (
                          'exact', 'lga', 'state', 'national', 'unknown'
                        )),
  geo_confidence        numeric(3, 2) not null default 0
                          check (geo_confidence between 0 and 1),
  occurrence_at         timestamptz,
  first_reported_at     timestamptz not null,
  last_updated_at       timestamptz not null default now(),
  verification_status   text not null default 'unassessed' check (verification_status in (
                          'unassessed', 'single_source', 'multiple_sources',
                          'corroborated', 'official_confirmation', 'disputed', 'retracted'
                        )),
  confidence            numeric(3, 2) not null default 0
                          check (confidence between 0 and 1),
  uncertainties         jsonb not null default '[]'::jsonb
                          check (jsonb_typeof(uncertainties) = 'array'),
  analysis              text not null default '',
  analysis_kind         text not null default 'none' check (analysis_kind in (
                          'automated_demo_summary', 'ai_analysis', 'none'
                        )),
  is_demo               boolean not null default false,
  published             boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint events_geo_state check (
    geo_precision in ('national', 'unknown') or state_id is not null
  ),
  constraint events_geo_location check (
    geo_precision in ('national', 'unknown') or location is not null
  ),
  constraint events_demo_analysis check (
    not is_demo or analysis_kind <> 'ai_analysis'
  ),
  constraint events_production_analysis check (
    is_demo or analysis_kind <> 'automated_demo_summary'
  )
);

create index events_state_time_idx on events (state_id, occurrence_at desc);
create index events_category_time_idx on events (category, occurrence_at desc);
create index events_verification_idx on events (verification_status);
create index events_location_gist on events using gist (location);
create index events_published_idx on events (published, last_updated_at desc);
create index events_search_idx
  on events using gin (to_tsvector('english', title || ' ' || summary));

create table event_sources (
  id                    uuid primary key default gen_random_uuid(),
  public_id             text not null unique,
  event_id              uuid not null references events(id) on delete cascade,
  article_id            uuid not null references articles(id) on delete cascade,
  relationship          text not null check (relationship in (
                          'primary', 'supporting', 'conflicting', 'retracted', 'background'
                        )),
  independence_group    text not null,
  added_at              timestamptz not null default now(),
  unique (event_id, article_id)
);

create index event_sources_event_idx on event_sources (event_id);
create index event_sources_article_idx on event_sources (article_id);

create table event_updates (
  id                uuid primary key default gen_random_uuid(),
  public_id         text not null unique,
  event_id          uuid not null references events(id) on delete cascade,
  update_type       text not null check (update_type in (
                      'new_report', 'casualty_update', 'official_statement',
                      'correction', 'retraction', 'location_update',
                      'verification_change', 'context'
                    )),
  description       text not null,
  source_id         uuid references sources(id),
  article_id        uuid references articles(id),
  actor             text not null default 'pipeline'
                      check (actor in ('pipeline', 'reviewer', 'system')),
  created_at        timestamptz not null default now()
);

create index event_updates_event_idx on event_updates (event_id, created_at desc);

create table event_relations (
  event_id          uuid not null references events(id) on delete cascade,
  related_event_id  uuid not null references events(id) on delete cascade,
  relation_type     text not null default 'related'
                      check (relation_type in ('related', 'follow_up', 'correction', 'context')),
  sort_order        smallint not null default 0,
  created_at        timestamptz not null default now(),
  primary key (event_id, related_event_id),
  constraint event_relations_distinct check (event_id <> related_event_id)
);

create index event_relations_related_idx on event_relations (related_event_id);

create table event_clusters (
  id                uuid primary key default gen_random_uuid(),
  cluster_reference text not null,
  event_id          uuid references events(id) on delete cascade,
  article_id        uuid not null references articles(id) on delete cascade,
  clustering_method text not null check (clustering_method in (
                      'deterministic', 'semantic', 'hybrid', 'manual'
                    )),
  similarity        numeric(4, 3) check (similarity between 0 and 1),
  confidence        numeric(3, 2) check (confidence between 0 and 1),
  decision          text not null default 'pending'
                      check (decision in ('pending', 'accepted', 'rejected')),
  reviewed_by       text,
  created_at        timestamptz not null default now()
);

create index event_clusters_review_idx
  on event_clusters (decision, confidence) where decision = 'pending';
create index event_clusters_reference_idx on event_clusters (cluster_reference);
