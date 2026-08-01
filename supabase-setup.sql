-- Run this once in Supabase: Project → SQL Editor → New query → paste → Run

create table if not exists kv_store (
  key text primary key,
  value jsonb,
  updated_at timestamptz default now()
);

-- This app is single-user with no login, so Row Level Security stays off
-- (the default for a new table) and the anon key can read/write freely.
-- That's fine for personal race data, but do not put anything sensitive
-- (passwords, financial info, etc.) into this table.
