-- 0008: ingestion review queue.
-- A captured article is evidence, not an event. Deterministic priors and, later,
-- AI proposals land here for review. Nothing in this table is published to the
-- public read models.

set search_path = public, extensions;

create table ingestion_candidates (
  id                    uuid primary key default gen_random_uuid(),
  public_id             text not null unique,
  run_id                uuid not null,
  source_id             uuid not null references sources(id) on delete cascade,
  article_id            uuid not null unique references articles(id) on delete cascade,
  category              text check (category in (
                          'security', 'politics', 'economy',
                          'infrastructure', 'environment', 'health'
                        )),
  state_id              text references states(id),
  lga                   text,
  category_confidence   numeric(3, 2) not null default 0
                          check (category_confidence between 0 and 1),
  geo_confidence        numeric(3, 2) not null default 0
                          check (geo_confidence between 0 and 1),
  status                text not null default 'pending' check (status in (
                          'pending', 'needs_review', 'accepted', 'rejected'
                        )),
  rejection_reason      text,
  reasons               jsonb not null default '[]'::jsonb
                          check (jsonb_typeof(reasons) = 'array'),
  rule_version          text not null,
  reviewed_at           timestamptz,
  reviewed_by           text,
  created_at            timestamptz not null default now(),
  constraint ingestion_candidates_review_shape check (
    (status = 'accepted' and reviewed_at is not null and reviewed_by is not null)
    or status in ('pending', 'needs_review', 'rejected')
  ),
  constraint ingestion_candidates_rejection_reason check (
    status <> 'rejected' or rejection_reason is not null
  )
);

create index ingestion_candidates_status_idx
  on ingestion_candidates (status, created_at desc);
create index ingestion_candidates_state_idx
  on ingestion_candidates (state_id, created_at desc);
create index ingestion_candidates_source_idx
  on ingestion_candidates (source_id, created_at desc);

alter table ingestion_candidates enable row level security;

revoke all on table ingestion_candidates from anon, authenticated;
grant select, insert, update, delete on table ingestion_candidates to service_role;
