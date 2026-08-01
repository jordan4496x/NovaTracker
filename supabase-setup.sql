-- Run this once in Supabase: Project → SQL Editor → New query → paste → Run

create table if not exists kv_store (
  key text primary key,
  value jsonb,
  updated_at timestamptz default now()
);

-- Enables live sync: when one device saves a run, other open devices
-- automatically pull the update within a second or two (no restart needed).
-- If you already ran the table creation above on a previous visit, you can
-- just run this ALTER line by itself — re-running create table is harmless too.
alter publication supabase_realtime add table kv_store;

-- This app is single-user with no login, so Row Level Security stays off
-- (the default for a new table) and the anon/publishable key can read/write freely.
-- That's fine for personal race data, but do not put anything sensitive
-- (passwords, financial info, etc.) into this table.
