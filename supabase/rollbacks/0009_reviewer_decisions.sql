set search_path = public, extensions;

drop table if exists candidate_reviews;
drop function if exists prevent_candidate_review_update();

alter table ingestion_candidates
  drop constraint if exists ingestion_candidates_accepted_fields,
  drop constraint if exists ingestion_candidates_reviewer_shape;
