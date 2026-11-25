-- Roll back 0001. Run only after every dependent schema object is removed.
-- The `extensions` schema itself is shared with the hosting platform and is
-- intentionally left in place.
set search_path = public, extensions;

drop extension if exists pg_trgm;
drop extension if exists postgis;
