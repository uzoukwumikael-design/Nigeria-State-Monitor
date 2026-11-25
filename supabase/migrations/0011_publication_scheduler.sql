-- 0011: cluster decisions, candidate-to-event links, append-only hardening
-- and the scheduler lock. All tables are server-only; no public view exposes
-- candidates, clusters, links or locks.

set search_path = public, extensions;

-- Cluster review metadata. `event_clusters` already exists from 0004; this adds
-- the fields a reviewer needs without changing its meaning.
alter table event_clusters
  add column reviewed_at timestamptz,
  add column reasons jsonb not null default '[]'::jsonb
    check (jsonb_typeof(reasons) = 'array'),
  add column score_components jsonb,
  add column rule_version text;

alter table event_clusters
  add constraint event_clusters_reviewed_by_check check (
    reviewed_by is null or reviewed_by ~ '^[a-z0-9][a-z0-9._-]{2,63}$'
  ),
  add constraint event_clusters_review_shape check (
    (decision = 'pending' and reviewed_by is null and reviewed_at is null)
    or
    (decision in ('accepted', 'rejected') and reviewed_by is not null and reviewed_at is not null)
  );

create unique index event_clusters_article_event_unique
  on event_clusters (article_id, event_id)
  where event_id is not null;

-- One candidate can either become its own event or support an existing event.
-- Never both, and never twice. The article is also globally unique so an
-- accepted candidate cannot be attached to two different events.
create table candidate_event_links (
  id                  uuid primary key default gen_random_uuid(),
  candidate_id        uuid not null unique references ingestion_candidates(id) on delete restrict,
  article_id          uuid not null unique references articles(id) on delete restrict,
  event_id            uuid not null references events(id) on delete restrict,
  link_type           text not null check (link_type in ('published', 'supporting')),
  cluster_id          uuid unique references event_clusters(id) on delete restrict,
  reviewer_id         text check (reviewer_id is null or reviewer_id ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  severity            smallint check (severity between 1 and 5),
  severity_rationale  text check (severity_rationale is null or char_length(severity_rationale) between 10 and 500),
  linked_at           timestamptz not null default now(),
  constraint candidate_event_links_shape check (
    (link_type = 'published'
      and cluster_id is null
      and severity is not null
      and severity_rationale is not null)
    or
    (link_type = 'supporting'
      and cluster_id is not null
      and severity is null
      and severity_rationale is null)
  )
);

create index candidate_event_links_event_idx
  on candidate_event_links (event_id, linked_at desc);
create unique index candidate_event_links_published_event
  on candidate_event_links (event_id)
  where link_type = 'published';

alter table candidate_event_links enable row level security;

revoke all on table candidate_event_links from anon, authenticated;
grant select, insert on table candidate_event_links to service_role;

create function prevent_candidate_event_link_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'candidate_event_links is append-only';
end;
$$;

create trigger candidate_event_links_no_update
  before update or delete on candidate_event_links
  for each row execute function prevent_candidate_event_link_mutation();

-- Cluster rows are mutable only for the review decision. service_role keeps
-- select/insert/update, but delete is removed.
revoke all on table event_clusters from service_role;
grant select, insert, update on table event_clusters to service_role;

-- Timeline and audit rows are append-only for the application role. Updates
-- are blocked for every role by a trigger; deletes are removed from
-- service_role. The database owner can still perform a cascade cleanup when a
-- demo seed is replaced, but an application connection cannot edit history.
revoke update, delete on table event_updates from service_role;
revoke update, delete on table audit_logs from service_role;

create function prevent_event_update_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'event_updates is append-only';
end;
$$;

create trigger event_updates_no_update
  before update on event_updates
  for each row execute function prevent_event_update_mutation();

create function prevent_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs is append-only';
end;
$$;

create trigger audit_logs_no_update
  before update or delete on audit_logs
  for each row execute function prevent_audit_log_mutation();

-- A database-level lease prevents two schedulers/one cron invocation from
-- ingesting the same source concurrently. The key is independent of the
-- sources row, so the first run can lock before the source is upserted.
create table scheduler_locks (
  lock_key       text primary key,
  lock_token     uuid not null,
  locked_until   timestamptz not null,
  updated_at     timestamptz not null default now(),
  constraint scheduler_locks_key_shape check (lock_key ~ '^[a-z0-9][a-z0-9:._-]{2,127}$')
);

alter table scheduler_locks enable row level security;

revoke all on table scheduler_locks from anon, authenticated;
grant select, insert, update, delete on table scheduler_locks to service_role;

comment on table candidate_event_links is
  'One immutable outcome per accepted candidate: its own published event or supporting evidence on an existing event.';
comment on table scheduler_locks is
  'Lease used by the ingestion scheduler and cron endpoint. Server-only; never exposed by the API.';
comment on table event_clusters is
  'Cluster review queue. A high similarity score alone never authorises a merge.';
