-- 0009: reviewer decisions and append-only audit trail.
-- A reviewer may accept or reject a captured candidate. Acceptance is not
-- publication: this migration and the review CLI never create or update an
-- event, and no public view exposes the review queue or its audit trail.

set search_path = public, extensions;

-- Acceptance means a human resolved category and geography. Capture can still
-- only write pending/needs_review/rejected, so these constraints cannot be
-- satisfied by the ingestion path.
alter table ingestion_candidates
  add constraint ingestion_candidates_accepted_fields check (
    status <> 'accepted' or (category is not null and state_id is not null)
  ),
  add constraint ingestion_candidates_reviewer_shape check (
    reviewed_by is null or reviewed_by ~ '^[a-z0-9][a-z0-9._-]{2,63}$'
  );

create table candidate_reviews (
  id                 uuid primary key default gen_random_uuid(),
  candidate_id       uuid not null unique references ingestion_candidates(id) on delete restrict,
  article_id         uuid not null references articles(id) on delete restrict,
  reviewer_id        text not null check (reviewer_id ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  action             text not null check (action in ('accept', 'reject')),
  previous_status    text not null check (previous_status in ('pending', 'needs_review')),
  new_status         text not null check (new_status in ('accepted', 'rejected')),
  previous_category  text check (previous_category in (
                       'security', 'politics', 'economy',
                       'infrastructure', 'environment', 'health'
                     )),
  previous_state_id  text references states(id),
  category           text check (category in (
                       'security', 'politics', 'economy',
                       'infrastructure', 'environment', 'health'
                     )),
  state_id           text references states(id),
  notes              text check (notes is null or char_length(notes) <= 1000),
  created_at         timestamptz not null default now(),
  constraint candidate_reviews_action_shape check (
    (action = 'accept'
      and new_status = 'accepted'
      and category is not null
      and state_id is not null)
    or
    (action = 'reject'
      and new_status = 'rejected'
      and notes is not null
      and char_length(btrim(notes)) >= 3)
  )
);

create index candidate_reviews_reviewer_idx
  on candidate_reviews (reviewer_id, created_at desc);
create index candidate_reviews_created_idx
  on candidate_reviews (created_at desc);

alter table candidate_reviews enable row level security;

revoke all on table candidate_reviews from anon, authenticated;
grant select, insert on table candidate_reviews to service_role;

-- Application-level append-only protection. service_role has no update or
-- delete grant; this trigger additionally blocks accidental updates by any
-- role. A database owner can still remove the table or trigger, as with any
-- migration.
create function prevent_candidate_review_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'candidate_reviews is append-only';
end;
$$;

create trigger candidate_reviews_no_update
  before update on candidate_reviews
  for each row execute function prevent_candidate_review_update();

comment on table candidate_reviews is
  'Append-only reviewer decisions for ingestion candidates. Acceptance is not event publication.';
comment on column candidate_reviews.notes is
  'Reviewer rationale. Required for rejection; never contains article body text.';
