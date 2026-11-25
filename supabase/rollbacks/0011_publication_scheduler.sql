-- Rollback for 0011. Restores the broad service_role grants from 0006.

set search_path = public, extensions;

drop table if exists scheduler_locks;

drop trigger if exists audit_logs_no_update on audit_logs;
drop function if exists prevent_audit_log_mutation();

drop trigger if exists event_updates_no_update on event_updates;
drop function if exists prevent_event_update_mutation();

grant all on table event_updates to service_role;
grant all on table audit_logs to service_role;
grant all on table event_clusters to service_role;

drop trigger if exists candidate_event_links_no_update on candidate_event_links;
drop function if exists prevent_candidate_event_link_mutation();
drop table if exists candidate_event_links;

drop index if exists event_clusters_article_event_unique;

alter table event_clusters
  drop constraint if exists event_clusters_review_shape,
  drop constraint if exists event_clusters_reviewed_by_check,
  drop column if exists rule_version,
  drop column if exists score_components,
  drop column if exists reasons,
  drop column if exists reviewed_at;
