-- Cookie & Tracker Compliance module (Tier A — static analysis).
--
-- Deliberately separate tables from website_monitors / notice_scans so the module can be
-- showcased independently and later merged into a unified compliance model without a data
-- migration. Same ownership + reviewer-access shape as the notice module.

create table if not exists public.cookie_monitors (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  site_url text not null,
  jurisdiction text not null default 'EU+CH',
  interval_hours integer not null default 168 check (interval_hours between 6 and 8760),
  enabled boolean not null default true,
  next_scan_at timestamptz not null default now(),
  last_scan_at timestamptz,
  last_status text not null default 'scheduled'
    check (last_status in ('scheduled','done','failed','needs_review')),
  last_score integer,
  last_grade text,
  previous_score integer,
  latest_scan_id bigint,
  last_error text,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, site_url)
);

create index if not exists cookie_monitors_due_idx
  on public.cookie_monitors (next_scan_at) where enabled;
create index if not exists cookie_monitors_user_idx
  on public.cookie_monitors (user_id, created_at desc);

create table if not exists public.cookie_scans (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  monitor_id bigint references public.cookie_monitors(id) on delete set null,
  label text,
  site_url text not null,
  final_url text,
  jurisdiction text not null default 'EU+CH',
  status text not null default 'done' check (status in ('done','failed')),
  scores jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text,
  scan_trigger text not null default 'manual',
  html_fingerprint text,
  created_at timestamptz not null default now()
);

create index if not exists cookie_scans_user_created_idx
  on public.cookie_scans (user_id, created_at desc);
create index if not exists cookie_scans_monitor_created_idx
  on public.cookie_scans (monitor_id, created_at desc) where monitor_id is not null;

create table if not exists public.cookie_reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  monitor_id bigint not null references public.cookie_monitors(id) on delete cascade,
  scan_id bigint references public.cookie_scans(id) on delete set null,
  finding_key text not null,
  kind text not null check (kind in ('initial_finding','new_finding','regression','reopened','recovered','score_drop','scan_failed')),
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

create index if not exists cookie_reviews_user_status_idx
  on public.cookie_reviews (user_id, status, created_at desc);
create index if not exists cookie_reviews_monitor_key_idx
  on public.cookie_reviews (monitor_id, finding_key, created_at desc);
create unique index if not exists cookie_reviews_one_open_finding
  on public.cookie_reviews (monitor_id, finding_key)
  where status in ('pending','in_review') and kind not in ('score_drop','scan_failed');

-- ── grants (required in the same migration or the Data API denies access) ──
grant select, insert, update, delete on public.cookie_monitors to authenticated, service_role;
grant select, insert, update, delete on public.cookie_scans to authenticated, service_role;
grant select, insert, update, delete on public.cookie_reviews to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- ── RLS ──
alter table public.cookie_monitors enable row level security;
alter table public.cookie_scans enable row level security;
alter table public.cookie_reviews enable row level security;

drop policy if exists cookie_monitors_own on public.cookie_monitors;
create policy cookie_monitors_own on public.cookie_monitors for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists cookie_monitors_reviewer on public.cookie_monitors;
create policy cookie_monitors_reviewer on public.cookie_monitors for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'reviewer'));

drop policy if exists cookie_scans_own on public.cookie_scans;
create policy cookie_scans_own on public.cookie_scans for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists cookie_scans_reviewer on public.cookie_scans;
create policy cookie_scans_reviewer on public.cookie_scans for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'reviewer'));

drop policy if exists cookie_reviews_own on public.cookie_reviews;
create policy cookie_reviews_own on public.cookie_reviews for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists cookie_reviews_reviewer on public.cookie_reviews;
create policy cookie_reviews_reviewer on public.cookie_reviews for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'reviewer'));

-- ── scheduler claim function (mirrors claim_due_website_monitors) ──
create or replace function public.claim_due_cookie_monitors(p_limit integer default 3)
returns setof public.cookie_monitors
language sql
security definer
set search_path = public
as $$
  update public.cookie_monitors m
     set lease_until = now() + interval '30 minutes',
         updated_at = now()
   where m.id in (
     select id from public.cookie_monitors
      where enabled and next_scan_at <= now()
        and (lease_until is null or lease_until < now())
      order by next_scan_at asc
      for update skip locked
      limit greatest(1, least(p_limit, 20))
   )
  returning m.*;
$$;
revoke all on function public.claim_due_cookie_monitors(integer) from public, anon, authenticated;
grant execute on function public.claim_due_cookie_monitors(integer) to service_role;
