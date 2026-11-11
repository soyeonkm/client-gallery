-- Every gallery needs a photographer name (shown to clients and baked into every watermark).
-- Run once in the Supabase SQL editor. Existing galleries all have names, so this applies cleanly.
alter table public.galleries alter column photographer_name set not null;
alter table public.galleries drop constraint if exists galleries_photographer_name_required;
alter table public.galleries add constraint galleries_photographer_name_required
  check (length(btrim(photographer_name)) > 0);
