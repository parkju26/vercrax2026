-- Vercrax minimal schema
-- Run this in Supabase SQL Editor (or via migration tooling)

create table if not exists public.judgments (
  run_id uuid primary key,
  user_id text not null,
  request_id text not null,
  prompt text not null,
  mode text not null,
  debate text not null,
  base_judgment jsonb not null,
  deep jsonb,
  debate_result jsonb,
  decision_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.debate_steps (
  run_id uuid references public.judgments(run_id) on delete cascade,
  idx int not null,
  round int not null,
  challenger text not null,
  defender text not null,
  phase text not null, -- question|answer|judge
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (run_id, idx)
);

create index if not exists debate_steps_run_round_idx
  on public.debate_steps(run_id, round, idx);
