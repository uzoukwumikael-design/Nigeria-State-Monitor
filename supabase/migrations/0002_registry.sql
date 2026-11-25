-- 0002: authoritative state registry and dataset snapshot metadata.
-- State boundaries are loaded by scripts/db/seed-registry.ts from the
-- checked-in GRID3/geoBoundaries output. They are never entered by hand.

set search_path = public, extensions;

create table states (
  id                text primary key check (id ~ '^NG-[A-Z]{2}$'),
  name              text not null unique,
  iso_code          text not null unique,
  zone              text not null check (zone in (
                      'north-central', 'north-east', 'north-west',
                      'south-east', 'south-south', 'south-west'
                    )),
  capital           text not null,
  capital_lga       text not null,
  boundary          geometry(MultiPolygon, 4326) not null,
  label_point       geometry(Point, 4326) not null,
  capital_point     geometry(Point, 4326) not null,
  area_km2          numeric(12, 2) not null check (area_km2 > 0),
  bbox_min_lng      numeric(10, 6) not null check (bbox_min_lng between -180 and 180),
  bbox_min_lat      numeric(10, 6) not null check (bbox_min_lat between -90 and 90),
  bbox_max_lng      numeric(10, 6) not null check (bbox_max_lng between -180 and 180),
  bbox_max_lat      numeric(10, 6) not null check (bbox_max_lat between -90 and 90),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint states_bbox_order check (bbox_min_lng < bbox_max_lng and bbox_min_lat < bbox_max_lat),
  constraint states_boundary_valid check (ST_IsValid(boundary))
);

create index states_boundary_gist on states using gist (boundary);
create index states_zone_idx on states (zone);

comment on column states.id is
  'NSM internal identifier (NG-FC for FCT), not an official ISO certification.';

-- One immutable description of each dataset generation. Repositories read the
-- active row for their mode; a snapshot never silently changes underneath an API.
create table dataset_snapshots (
  id                uuid primary key default gen_random_uuid(),
  mode              text not null check (mode in ('demo', 'production')),
  version           text not null,
  reference_time    timestamptz not null,
  generated_at      timestamptz not null,
  coverage_from     timestamptz,
  coverage_to       timestamptz,
  coverage_basis    text not null check (coverage_basis in ('demo_snapshot', 'live_ingestion')),
  coverage_label    text not null,
  disclaimer        text,
  limitations       jsonb not null default '[]'::jsonb
                      check (jsonb_typeof(limitations) = 'array'),
  is_active         boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (mode, version),
  constraint dataset_snapshot_demo_disclaimer
    check (mode <> 'demo' or disclaimer is not null),
  constraint dataset_snapshot_coverage_order
    check (coverage_from is null or coverage_to is null or coverage_from <= coverage_to)
);

create unique index dataset_snapshots_one_active_per_mode
  on dataset_snapshots (mode) where is_active;
