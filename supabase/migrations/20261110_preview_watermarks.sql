-- Preview galleries with watermarks
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
-- Safe to re-run.

-- Optional: see the current policies on images before changing them
-- select policyname, cmd, roles, qual from pg_policies where schemaname = 'public' and tablename = 'images';

-- 1. New columns
alter table public.galleries add column if not exists is_preview boolean not null default false;
alter table public.images add column if not exists watermarked_url text;

-- 2. images: only the gallery owner may read or update rows directly.
--    The public reads photos through get_gallery_photos() below, which never exposes clean URLs for preview galleries.
alter table public.images enable row level security;

-- Drop every existing SELECT/UPDATE policy on images (their names aren't known to the app), then recreate owner-only ones.
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'images' and cmd in ('SELECT', 'UPDATE')
  loop
    execute format('drop policy %I on public.images', p.policyname);
  end loop;
end $$;

create policy "images_select_owner" on public.images
  for select to authenticated
  using (exists (select 1 from public.galleries g where g.id = images.gallery_id and g.owner_id = auth.uid()));

create policy "images_update_owner" on public.images
  for update to authenticated
  using (exists (select 1 from public.galleries g where g.id = images.gallery_id and g.owner_id = auth.uid()))
  with check (exists (select 1 from public.galleries g where g.id = images.gallery_id and g.owner_id = auth.uid()));

-- 3. Public photo list: returns only the URLs a client is allowed to see.
create or replace function public.get_gallery_photos(p_gallery_id uuid)
returns table (id uuid, created_at timestamptz, display_url text, download_url text)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.id,
    i.created_at,
    case when g.is_preview then i.watermarked_url else coalesce(i.preview_url, i.image_url) end,
    case when g.is_preview then i.watermarked_url else i.image_url end
  from public.images i
  join public.galleries g on g.id = i.gallery_id
  where i.gallery_id = p_gallery_id
    and (not g.is_preview or i.watermarked_url is not null)  -- never fall back to a clean URL in preview mode
  order by i.created_at desc;
$$;

revoke all on function public.get_gallery_photos(uuid) from public;
grant execute on function public.get_gallery_photos(uuid) to anon, authenticated;
