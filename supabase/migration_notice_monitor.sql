-- Portfolio monitoring for the Notice Auditor. Each monitor and review belongs
-- to its creator; reviewer access follows the existing notice_scans reviewer policy.

create table if not exists public.website_monitors (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  site_url text not null,
  notice_url text,
  interval_hours integer not null default 168 check (interval_hours between 6 and 8760),
  qualitative_review boolean not null default false,
  enabled boolean not null default true,
  next_scan_at timestamptz not null default now(),
  last_scan_at timestamptz,
  last_status text not null default 'scheduled'
    check (last_status in ('scheduled','done','failed','needs_review')),
  last_score integer,
  last_grade text,
  previous_score integer,
  latest_scan_id bigint references public.notice_scans(id) on delete set null,
  last_error text,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, site_url)
);
create index if not exists website_monitors_due_idx
  on public.website_monitors (next_scan_at) where enabled;
create index if not exists website_monitors_user_idx
  on public.website_monitors (user_id, created_at desc);
alter table public.website_monitors
  add column if not exists qualitative_review boolean not null default false;

alter table public.notice_scans
  add column if not exists monitor_id bigint references public.website_monitors(id) on delete set null,
  add column if not exists scan_trigger text not null default 'manual',
  add column if not exists notice_fingerprint text;
alter table public.notice_scans alter column notice_url drop not null;
alter table public.notice_scans alter column notice_url set default '';
create index if not exists notice_scans_monitor_created_idx
  on public.notice_scans (monitor_id, created_at desc) where monitor_id is not null;

grant select, insert, update, delete on public.website_monitors to authenticated;
grant select, insert, update, delete on public.website_monitors to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
alter table public.website_monitors enable row level security;
drop policy if exists website_monitors_own on public.website_monitors;
create policy website_monitors_own on public.website_monitors for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists website_monitors_reviewer on public.website_monitors;
create policy website_monitors_reviewer on public.website_monitors for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'reviewer'));

create table if not exists public.monitor_reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  monitor_id bigint not null references public.website_monitors(id) on delete cascade,
  scan_id bigint references public.notice_scans(id) on delete set null,
  finding_key text not null,
  kind text not null check (kind in ('initial_finding','new_finding','regression','reopened','recovered','score_drop','notice_changed','notice_hub','scan_failed')),
  severity text not null default 'medium' check (severity in ('high','medium','low')),
  title text not null,
  detail text not null default '',
  status text not null default 'pending'
    check (status in ('pending','in_review','resolved','accepted','false_positive','auto_resolved')),
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists monitor_reviews_user_status_idx
  on public.monitor_reviews (user_id, status, created_at desc);
create index if not exists monitor_reviews_monitor_key_idx
  on public.monitor_reviews (monitor_id, finding_key, created_at desc);
create unique index if not exists monitor_reviews_one_open_finding
  on public.monitor_reviews (monitor_id, finding_key)
  where status in ('pending','in_review') and kind not in ('notice_changed','score_drop','scan_failed','notice_hub');

grant select, insert, update, delete on public.monitor_reviews to authenticated;
grant select, insert, update, delete on public.monitor_reviews to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
alter table public.monitor_reviews enable row level security;
drop policy if exists monitor_reviews_own on public.monitor_reviews;
create policy monitor_reviews_own on public.monitor_reviews for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists monitor_reviews_reviewer on public.monitor_reviews;
create policy monitor_reviews_reviewer on public.monitor_reviews for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'reviewer'));

-- Atomically reserve a batch for the in-app scheduler; lease expiry recovers
-- work if a web process exits during a fetch.
create or replace function public.claim_due_website_monitors(p_limit integer default 5)
returns setof public.website_monitors
language sql
security definer
set search_path = public
as $$
  update public.website_monitors m
     set lease_until = now() + interval '30 minutes',
         updated_at = now()
   where m.id in (
     select id from public.website_monitors
      where enabled and next_scan_at <= now()
        and (lease_until is null or lease_until < now())
      order by next_scan_at asc
      for update skip locked
      limit greatest(1, least(p_limit, 20))
   )
  returning m.*;
$$;
revoke all on function public.claim_due_website_monitors(integer) from public, anon, authenticated;
grant execute on function public.claim_due_website_monitors(integer) to service_role;
