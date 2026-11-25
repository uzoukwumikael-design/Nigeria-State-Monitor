-- 0006: row-level security and public read models.
-- Raw tables stay private. Public views expose only published, non-demo data
-- with explicit columns; no browser client receives a service-role key.

set search_path = public, extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

alter table states enable row level security;
alter table dataset_snapshots enable row level security;
alter table raw_items enable row level security;
alter table sources enable row level security;
alter table articles enable row level security;
alter table events enable row level security;
alter table event_sources enable row level security;
alter table event_updates enable row level security;
alter table event_relations enable row level security;
alter table event_clusters enable row level security;
alter table ingestion_logs enable row level security;
alter table source_health enable row level security;
alter table economic_indicators enable row level security;
alter table economic_observations enable row level security;
alter table audit_logs enable row level security;

revoke all on all tables in schema public from anon, authenticated;

create view public_states as
select
  s.id,
  s.name,
  s.iso_code,
  s.zone,
  s.capital,
  s.capital_lga,
  s.area_km2,
  ST_X(s.label_point) as label_lng,
  ST_Y(s.label_point) as label_lat,
  ST_X(s.capital_point) as capital_lng,
  ST_Y(s.capital_point) as capital_lat,
  s.bbox_min_lng,
  s.bbox_min_lat,
  s.bbox_max_lng,
  s.bbox_max_lat
from states s;

-- Security-definer view: the owner reads the tables, while this WHERE clause
-- and the column list are the entire public contract. Never remove the demo or
-- published filters.
create view published_events as
select
  e.public_id,
  e.slug,
  e.title,
  e.summary,
  e.category,
  e.subcategory,
  e.severity,
  e.severity_rationale,
  e.state_id,
  e.lga,
  e.geo_precision,
  e.geo_confidence,
  e.occurrence_at,
  e.first_reported_at,
  e.last_updated_at,
  e.verification_status,
  e.confidence,
  e.uncertainties,
  e.analysis,
  e.analysis_kind,
  (
    select count(*)::integer
    from event_sources es
    where es.event_id = e.id
  ) as article_count,
  (
    select count(distinct es.independence_group)::integer
    from event_sources es
    where es.event_id = e.id and es.relationship <> 'retracted'
  ) as independent_source_count
from events e
where e.published = true and e.is_demo = false;

create view published_event_sources as
select
  es.public_id,
  e.public_id as event_public_id,
  a.original_title,
  a.original_url,
  a.published_at,
  a.retrieved_at,
  src.slug as source_slug,
  src.name as source_name,
  src.tier as source_tier,
  src.source_type,
  es.relationship,
  es.independence_group
from event_sources es
join events e on e.id = es.event_id
join articles a on a.id = es.article_id
join sources src on src.id = a.source_id
where e.published = true
  and e.is_demo = false
  and a.is_demo = false
  and src.is_demo = false;

create view published_event_updates as
select
  eu.public_id,
  e.public_id as event_public_id,
  eu.update_type,
  eu.description,
  eu.actor,
  eu.created_at,
  src.slug as source_slug,
  src.name as source_name
from event_updates eu
join events e on e.id = eu.event_id
left join sources src on src.id = eu.source_id
where e.published = true and e.is_demo = false;

create view public_economic_observations as
select
  eo.id,
  ei.code as indicator_code,
  ei.name as indicator_name,
  eo.value,
  eo.unit,
  eo.currency,
  eo.reference_period_start,
  eo.reference_period_end,
  eo.publication_date,
  eo.retrieved_at,
  eo.geographic_level,
  eo.state_id,
  eo.zone,
  eo.data_status,
  eo.source_url,
  eo.source_series,
  eo.vintage,
  src.slug as source_slug,
  src.name as source_name
from economic_observations eo
join economic_indicators ei on ei.id = eo.indicator_id
join sources src on src.id = ei.source_id
where eo.is_demo = false and src.is_demo = false;

grant usage on schema public to anon, authenticated;
grant select on public_states to anon, authenticated;
grant select on published_events to anon, authenticated;
grant select on published_event_sources to anon, authenticated;
grant select on published_event_updates to anon, authenticated;
grant select on public_economic_observations to anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

comment on view published_events is
  'Public contract: published, non-demo events only. Unknown or disputed claims remain labelled.';
comment on view published_event_sources is
  'Public evidence links for published non-demo events. Article bodies are never exposed.';
