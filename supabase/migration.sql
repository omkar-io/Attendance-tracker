-- Run once in Supabase SQL Editor (role: postgres)
alter table public.user_settings
  add column if not exists reminder_enabled boolean not null default false,
  add column if not exists reminder_time time not null default '18:00',
  add column if not exists timezone text not null default 'Asia/Kolkata',
  add column if not exists reminder_telegram boolean not null default false,
  add column if not exists last_reminded_on date;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy "push: owner select" on public.push_subscriptions for select using (auth.uid() = user_id);
create policy "push: owner insert" on public.push_subscriptions for insert with check (auth.uid() = user_id);
create policy "push: owner delete" on public.push_subscriptions for delete using (auth.uid() = user_id);

-- Indexes on every user_id FK: makes deleting a user fast (the timeout you hit earlier)
create index if not exists subjects_user_idx on public.subjects(user_id);
create index if not exists activity_log_user_idx on public.activity_log(user_id);
create index if not exists push_user_idx on public.push_subscriptions(user_id);

-- Schedule reminders every 15 min (replace YOUR_CRON_SECRET with the same value you set on the function)
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('ledger-reminders', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://xvixhvkurxcfrxstrayx.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','YOUR_CRON_SECRET'),
    body := '{}'::jsonb) $$);
