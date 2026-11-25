-- 0010: AI enrichment proposals and provenance metadata.
-- A model never writes to events, candidates or public views. Each row is a
-- validated proposal attached to captured evidence; raw response text is not
-- stored, only its SHA-256 hash. The table is server-only and append-only.

set search_path = public, extensions;

create table ai_enrichments (
  id                 uuid primary key default gen_random_uuid(),
  candidate_id       uuid not null references ingestion_candidates(id) on delete restrict,
  article_id         uuid not null references articles(id) on delete restrict,
  provider           text not null check (provider ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  model              text not null check (char_length(model) between 1 and 128),
  prompt_version     text not null check (prompt_version ~ '^[a-z0-9][a-z0-9._-]{2,127}$'),
  schema_version     text not null check (schema_version ~ '^[a-z0-9][a-z0-9._-]{2,127}$'),
  proposal           jsonb not null check (jsonb_typeof(proposal) = 'object'),
  confidence         numeric(3, 2) not null check (confidence between 0 and 1),
  raw_response_hash  text not null check (raw_response_hash ~ '^[a-f0-9]{64}$'),
  processed_at       timestamptz not null,
  created_at         timestamptz not null default now(),
  unique (candidate_id, provider, model, prompt_version, schema_version)
);

create index ai_enrichments_candidate_idx
  on ai_enrichments (candidate_id, processed_at desc);
create index ai_enrichments_article_idx
  on ai_enrichments (article_id, processed_at desc);
create index ai_enrichments_processed_idx
  on ai_enrichments (processed_at desc);

alter table ai_enrichments enable row level security;

revoke all on table ai_enrichments from anon, authenticated;
grant select, insert on table ai_enrichments to service_role;

-- service_role has no update or delete grant. This trigger additionally blocks
-- accidental updates by any role. A database owner can still remove the table
-- or trigger, as with any migration.
create function prevent_ai_enrichment_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ai_enrichments is append-only';
end;
$$;

create trigger ai_enrichments_no_update
  before update on ai_enrichments
  for each row execute function prevent_ai_enrichment_update();

comment on table ai_enrichments is
  'Validated AI enrichment proposals with provider provenance. Never an event; append-only and server-only.';
comment on column ai_enrichments.raw_response_hash is
  'SHA-256 of the raw model response. Raw response text is not stored.';
comment on column ai_enrichments.proposal is
  'Validated proposal only. Model output is never written directly to candidates or events.';
