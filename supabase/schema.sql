-- ==========================================================================
-- The Ledger — Supabase schema
-- Run this once in your Supabase project's SQL Editor (Database → SQL Editor
-- → New query → paste all of this → Run).
-- ==========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Subjects
-- ---------------------------------------------------------------------
create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  required_percent integer not null default 75,
  color text not null default '#1D2B3A',
  base_attended integer not null default 0,
  base_total integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.subjects enable row level security;

create policy "subjects: owner select" on public.subjects
  for select using (auth.uid() = user_id);
create policy "subjects: owner insert" on public.subjects
  for insert with check (auth.uid() = user_id);
create policy "subjects: owner update" on public.subjects
  for update using (auth.uid() = user_id);
create policy "subjects: owner delete" on public.subjects
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Attendance records
-- ---------------------------------------------------------------------
create table if not exists public.records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  date date not null,
  status text not null check (status in ('present', 'absent')),
  created_at timestamptz not null default now()
);

alter table public.records enable row level security;

create policy "records: owner select" on public.records
  for select using (auth.uid() = user_id);
create policy "records: owner insert" on public.records
  for insert with check (auth.uid() = user_id);
create policy "records: owner update" on public.records
  for update using (auth.uid() = user_id);
create policy "records: owner delete" on public.records
  for delete using (auth.uid() = user_id);

create index if not exists records_subject_idx on public.records(subject_id);
create index if not exists records_user_date_idx on public.records(user_id, date);

-- ---------------------------------------------------------------------
-- Activity log
-- ---------------------------------------------------------------------
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null,
  type text not null default 'info',
  created_at timestamptz not null default now()
);

alter table public.activity_log enable row level security;

create policy "log: owner select" on public.activity_log
  for select using (auth.uid() = user_id);
create policy "log: owner insert" on public.activity_log
  for insert with check (auth.uid() = user_id);
create policy "log: owner delete" on public.activity_log
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Per-user settings (Telegram token/chat id, default target %)
-- ---------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  telegram_token text default '',
  telegram_chat_id text default '',
  notify_present boolean not null default false,
  notify_absent boolean not null default false,
  default_percent integer not null default 75,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy "settings: owner select" on public.user_settings
  for select using (auth.uid() = user_id);
create policy "settings: owner insert" on public.user_settings
  for insert with check (auth.uid() = user_id);
create policy "settings: owner update" on public.user_settings
  for update using (auth.uid() = user_id);

-- ==========================================================================
-- Done. Next: Authentication → Providers → make sure Email is enabled.
-- If you want signups to work without an email-confirmation step while
-- you're testing, go to Authentication → Settings and turn off
-- "Confirm email" (turn it back on before sharing the site publicly).
-- ==========================================================================
