-- 0005: source operations, economic observations and audit trail.
-- Economic figures are deliberately separate from reported-event counts.

set search_path = public, extensions;

create table ingestion_logs (
  id                uuid primary key default gen_random_uuid(),
  source_id         uuid not null references sources(id),
  run_id             uuid not null,
  status             text not null check (status in (
                       'started', 'success', 'partial', 'failed', 'skipped'
                     )),
  records_fetched   integer not null default 0 check (records_fetched >= 0),
  records_new       integer not null default 0 check (records_new >= 0),
  records_rejected  integer not null default 0 check (records_rejected >= 0),
  error_message     text,
  execution_ms      integer check (execution_ms >= 0),
  created_at        timestamptz not null default now()
);

create index ingestion_logs_source_idx on ingestion_logs (source_id, created_at desc);
create index ingestion_logs_run_idx on ingestion_logs (run_id);

create table source_health (
  id                      uuid primary key default gen_random_uuid(),
  source_id               uuid not null unique references sources(id) on delete cascade,
  last_checked_at         timestamptz,
  last_successful_sync    timestamptz,
  status                  text not null default 'unknown' check (status in (
                            'healthy', 'degraded', 'down', 'unknown'
                          )),
  error_count             integer not null default 0 check (error_count >= 0),
  consecutive_failures    integer not null default 0 check (consecutive_failures >= 0),
  last_error              text,
  latency_ms              integer check (latency_ms >= 0)
);

create table economic_indicators (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  name              text not null,
  unit              text not null,
  currency          text,
  frequency         text not null check (frequency in (
                      'daily', 'weekly', 'monthly', 'quarterly', 'annual'
                    )),
  source_id         uuid not null references sources(id),
  data_status       text not null check (data_status in (
                      'official', 'market', 'estimated', 'modelled'
                    )),
  description       text,
  created_at        timestamptz not null default now()
);

create table economic_observations (
  id                      uuid primary key default gen_random_uuid(),
  indicator_id            uuid not null references economic_indicators(id),
  value                   numeric(20, 6) not null,
  unit                    text not null,
  currency                text,
  reference_period_start  date not null,
  reference_period_end    date not null,
  publication_date        date,
  retrieved_at            timestamptz not null default now(),
  geographic_level        text not null check (geographic_level in (
                            'national', 'zone', 'state'
                          )),
  state_id                text references states(id),
  zone                    text check (zone is null or zone in (
                            'north-central', 'north-east', 'north-west',
                            'south-east', 'south-south', 'south-west'
                          )),
  data_status             text not null check (data_status in (
                            'official', 'market', 'estimated', 'modelled'
                          )),
  source_url              text,
  source_series           text,
  vintage                 text,
  supersedes_id           uuid references economic_observations(id),
  is_demo                 boolean not null default false,
  constraint economic_period_order check (reference_period_start <= reference_period_end),
  constraint economic_geography check (
    (geographic_level = 'state' and state_id is not null and zone is null) or
    (geographic_level = 'zone' and state_id is null and zone is not null) or
    (geographic_level = 'national' and state_id is null and zone is null)
  )
);

create unique index economic_observations_unique_idx on economic_observations (
  indicator_id,
  reference_period_start,
  geographic_level,
  coalesce(state_id, ''),
  coalesce(zone, ''),
  coalesce(vintage, '')
);
create index economic_obs_indicator_idx
  on economic_observations (indicator_id, reference_period_start desc);
create index economic_obs_state_idx
  on economic_observations (state_id, reference_period_start desc);

create table audit_logs (
  id                bigint generated always as identity primary key,
  actor_id          uuid,
  actor_type        text not null check (actor_type in ('user', 'service', 'system')),
  action            text not null,
  entity_type       text not null,
  entity_id         text,
  before            jsonb,
  after             jsonb,
  request_id        text,
  created_at        timestamptz not null default now()
);

create index audit_logs_entity_idx
  on audit_logs (entity_type, entity_id, created_at desc);
