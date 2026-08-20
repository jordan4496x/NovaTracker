-- Run this once in Supabase: Project → SQL Editor → New query → paste → Run

create table if not exists kv_store (
  key text primary key,
  value jsonb,
  updated_at timestamptz default now()
);

-- Row Level Security is ON with no policies, which denies ALL access via
-- the public anon key by default — the app never uses that key anyway. All
-- reads/writes go through api/storage.js on the server, using the SERVICE
-- ROLE key (Project Settings → API → service_role), which bypasses RLS.
-- If you already created this table before with RLS off, just run this
-- ALTER line by itself to lock it down — re-running the create table above
-- is harmless too.
alter table kv_store enable row level security;
