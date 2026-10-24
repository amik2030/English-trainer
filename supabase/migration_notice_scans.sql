-- Privacy Notice Auditor — persisted audits
create table if not exists public.notice_scans (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,
  site_url text not null,
  notice_url text,
  status text not null default 'done' check (status in ('done','failed')),
  error text,
  scores jsonb default '{}'::jsonb,
  result jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists notice_scans_user_created_idx on public.notice_scans (user_id, created_at desc);

grant select, insert, update, delete on public.notice_scans to authenticated;
grant select, insert, update, delete on public.notice_scans to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

alter table public.notice_scans enable row level security;

drop policy if exists notice_scans_own on public.notice_scans;
create policy notice_scans_own on public.notice_scans
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists notice_scans_reviewer on public.notice_scans;
create policy notice_scans_reviewer on public.notice_scans
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'reviewer'));
