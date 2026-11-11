-- Heartbeat rows written every 3 days by a Vercel Cron job, so the free Supabase project never sits idle.
-- Run once in the Supabase SQL editor. Safe to re-run.

create table if not exists public.heartbeat (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  message text not null
);

-- No policies: nobody can read or write this table directly with the public key
alter table public.heartbeat enable row level security;

-- The only way in. Adds at most one row per 24 hours, so repeated calls can't flood the table.
create or replace function public.record_heartbeat(p_message text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare new_id bigint;
begin
  if exists (select 1 from public.heartbeat where created_at > now() - interval '24 hours') then
    return null;
  end if;
  insert into public.heartbeat (message) values (left(p_message, 200)) returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.record_heartbeat(text) from public;
grant execute on function public.record_heartbeat(text) to anon, authenticated;
