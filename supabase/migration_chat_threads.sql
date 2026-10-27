-- Conversational Ask mode: multi-turn threads with titled conversations.
-- Each thread belongs to its creator; reviewer access follows existing patterns.

create table if not exists public.chat_threads (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation',
  scope jsonb not null default '{}'::jsonb,
  message_count integer not null default 0,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chat_threads_user_recent_idx
  on public.chat_threads (user_id, last_message_at desc);

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  thread_id bigint not null references public.chat_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  kb_grounded boolean,
  confidence double precision,
  jurisdiction text,
  qa_id bigint references public.qa_history(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_thread_idx
  on public.chat_messages (thread_id, created_at);

-- Let Ask history distinguish one-off questions from conversational turns so the
-- "recent questions" list stays a list of discrete questions.
alter table public.qa_history
  add column if not exists source text not null default 'ask';
create index if not exists qa_history_user_source_idx
  on public.qa_history (user_id, source, answered_at desc);

grant select, insert, update, delete on public.chat_threads to authenticated;
grant select, insert, update, delete on public.chat_threads to service_role;
grant select, insert, update, delete on public.chat_messages to authenticated;
grant select, insert, update, delete on public.chat_messages to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

alter table public.chat_threads enable row level security;
drop policy if exists chat_threads_own on public.chat_threads;
create policy chat_threads_own on public.chat_threads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists chat_threads_reviewer on public.chat_threads;
create policy chat_threads_reviewer on public.chat_threads for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'reviewer'));

alter table public.chat_messages enable row level security;
drop policy if exists chat_messages_own on public.chat_messages;
create policy chat_messages_own on public.chat_messages for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists chat_messages_reviewer on public.chat_messages;
create policy chat_messages_reviewer on public.chat_messages for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'reviewer'));
