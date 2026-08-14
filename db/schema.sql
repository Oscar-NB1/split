-- SPLIT - schema v0
-- Two athletes, one household. No privacy walls between them, by design.

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------------ people
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  display_name  text not null,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------- connections
create table if not exists oauth_accounts (
  user_id           uuid not null references users(id) on delete cascade,
  provider          text not null,            -- strava | runna | intervals
  provider_user_id  text not null,
  access_token      text not null,
  refresh_token     text,
  expires_at        timestamptz,
  scope             text,
  updated_at        timestamptz not null default now(),
  primary key (user_id, provider)
);

-- --------------------------------------------------------- what happened
create table if not exists activities (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  provider              text not null,
  provider_activity_id  text not null,
  start_time            timestamptz not null,
  local_date            date not null,        -- the day the athlete thinks it was
  sport_type            text,
  name                  text,
  moving_seconds        int,
  elapsed_seconds       int,
  distance_m            numeric,
  elevation_m           numeric,
  avg_hr                numeric,
  max_hr                numeric,
  avg_speed_ms          numeric,
  raw                   jsonb,
  created_at            timestamptz not null default now(),
  unique (provider, provider_activity_id)
);
create index if not exists activities_user_date on activities (user_id, local_date desc);

-- ---------------------------------------------------------- what was asked
-- status:
--   planned   not yet done
--   done      completed as written
--   adjusted  completed, but scaled down from what was planned
--   skipped   not done, reason recorded, NO debt carried forward
--   moved     superseded by a copy on another date, kept for the audit trail
create table if not exists planned_sessions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete cascade,
  author_id          uuid references users(id),      -- who programmed it
  planned_date       date not null,
  title              text not null,
  kind               text not null,                  -- run_easy | run_intervals | run_long | hyrox | strength | rest
  planned_minutes    int,
  target             text,                           -- '10x400m @ 3:55, walk 90s'
  coach_note         text,
  source             text not null default 'manual', -- manual | template | runna
  source_ref         text,                           -- runna ical UID, or template week id
  status             text not null default 'planned',
  actual_minutes     int,
  activity_id        uuid references activities(id) on delete set null,
  adjusted_from      uuid references planned_sessions(id),
  skip_reason        text,                           -- tired | sore | no_time | sick | other
  effort_points      int,
  -- the intervals.icu event this session became. Keeping it is what lets the
  -- hourly push UPDATE one workout on the watch instead of adding another.
  intervals_event_id  text,
  intervals_pushed_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists sessions_user_date on planned_sessions (user_id, planned_date);
create unique index if not exists sessions_runna_uid
  on planned_sessions (user_id, source_ref) where source = 'runna';

-- every move, scale-down and skip, so nobody has to remember what happened
create table if not exists session_changes (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references planned_sessions(id) on delete cascade,
  actor_id     uuid not null references users(id),
  action       text not null,        -- created | moved | scaled | skipped | completed
  from_date    date,
  to_date      date,
  reason       text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------- what comes next
-- weeks: [ { day: 0..6, kind, title, minutes, target } ]
-- rules: { long_run_delta_min: 5, deload_every: 4, fatigue_skips_to_deload: 2 }
create table if not exists plan_templates (
  id          uuid primary key default gen_random_uuid(),
  athlete_id  uuid not null references users(id) on delete cascade,
  author_id   uuid not null references users(id),
  name        text not null,
  start_date  date not null,
  weeks       jsonb not null,
  rules       jsonb not null default '{}',
  horizon     int not null default 3,     -- weeks materialised ahead of today
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------- the competition
create table if not exists challenges (
  week_start  date primary key,
  metric      text not null,   -- sessions_done | zone2_minutes | longest_session | effort_points
  label       text not null,
  rule        text
);

-- ------------------------------------------------------------------ migrations
-- Whoop was removed (2026-08-14). Nothing else ever wrote `wellness`, so the
-- table is dropped rather than left as an orphan nothing reads.
drop table if exists wellness;
-- This file is idempotent: run it again after pulling and it upgrades in place.
-- Adding to a table above? Add the matching `add column if not exists` here.
alter table planned_sessions add column if not exists intervals_event_id  text;
alter table planned_sessions add column if not exists intervals_pushed_at timestamptz;
