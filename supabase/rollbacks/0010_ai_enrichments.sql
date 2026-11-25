set search_path = public, extensions;

drop table if exists ai_enrichments;
drop function if exists prevent_ai_enrichment_update();
