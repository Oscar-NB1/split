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

-- Per-km splits and the time series behind the HR/pace graphs (2026-08-14).
-- Split rows come free with a detailed activity fetch (the webhook already does
-- one); streams are a second request per activity, so they are fetched once and
-- kept. latlng and cadence are deliberately NOT stored: the route is already in
-- map.summary_polyline on the activity, and latlng alone is ~40% of the payload.
create table if not exists activity_splits (
  activity_id      uuid    not null references activities(id) on delete cascade,
  split            int     not null,          -- 1-based km index from Strava
  distance_m       numeric,
  moving_seconds   int,
  elapsed_seconds  int,
  avg_speed_ms     numeric,
  avg_hr           numeric,
  elevation_diff_m numeric,
  pace_zone        int,
  primary key (activity_id, split)
);

create table if not exists activity_streams (
  activity_id uuid primary key references activities(id) on delete cascade,
  keys        text[]      not null,
  points      int         not null,
  data        jsonb       not null,
  fetched_at  timestamptz not null default now()
);

-- Laps are the interval structure (2026-08-14). A Garmin interval workout
-- reaches Strava with one lap per rep and one per recovery, each carrying its
-- own average HR and speed — which is the only place "average HR of the work
-- reps vs the rest" can come from. Splits are always 1km and cannot express it.
--
-- Unlike splits, laps exist for non-distance sports too, so this table is not
-- gated on distance_m.
create table if not exists activity_laps (
  activity_id      uuid    not null references activities(id) on delete cascade,
  lap_index        int     not null,          -- 1-based, in workout order
  name             text,
  distance_m       numeric,
  moving_seconds   int,
  elapsed_seconds  int,
  start_index      int,                       -- index into the stream arrays
  avg_speed_ms     numeric,
  max_speed_ms     numeric,
  avg_hr           numeric,
  max_hr           numeric,
  avg_cadence      numeric,
  elevation_diff_m numeric,
  primary key (activity_id, lap_index)
);

-- Records that the detailed fetch happened, separately from whether it yielded
-- anything. Judging "do we still need detail?" on the presence of split rows
-- means a gym session — which legitimately has no splits — is re-fetched every
-- hour forever, burning quota to learn the same nothing.
alter table activities add column if not exists detail_fetched_at timestamptz;

-- ------------------------------------------------------------------ races
-- A HYROX result imported from results.hyrox.com (2026-08-15).
--
-- Strava records a race as one undifferentiated blob — the existing entry is
-- literally called "Hyrox Mechelen - 1.00.45", with the finish time typed into
-- the name. The eight run splits and eight station times only exist on the
-- official timing site, so they are fetched from there and stored here.
--
-- `activity_id` links the race to what the watch recorded, which is also where
-- the date comes from: the result page carries the event as "Warsaw 2026" and
-- no date at all.
create table if not exists races (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  activity_id    uuid references activities(id) on delete set null,
  source_url     text not null,
  external_id    text not null,        -- mikatiming's `idp`, one per result
  athlete_name   text,
  bib            text,
  event_name     text,
  division       text,
  age_group      text,
  race_date      date,
  overall_seconds int,
  rank_overall   int,
  rank_age_group int,
  imported_at    timestamptz not null default now(),
  -- re-importing the same result updates it rather than duplicating
  unique (user_id, external_id)
);

-- Splits are stored as labelled rows rather than sixteen fixed columns, because
-- the format is not ours to fix: doubles, relay and adaptive divisions have
-- different station sets, and HYROX has changed stations between seasons. A new
-- format lands as new rows, not a migration.
create table if not exists race_splits (
  race_id  uuid not null references races(id) on delete cascade,
  ord      int  not null,               -- order on the official result page
  label    text not null,               -- e.g. "Running 3", "50m Sled Push"
  kind     text not null,               -- run | station | roxzone | total | other
  seconds  int  not null,
  place    int,
  primary key (race_id, ord)
);

-- The lap column was first declared `start_offset_s`, which is wrong about its
-- own contents: Strava's `start_index` is an offset into the stream arrays, not
-- a number of seconds, and the two only coincide when the watch sampled at
-- exactly 1Hz. Guarded so the file stays re-runnable.
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_name = 'activity_laps' and column_name = 'start_offset_s')
  then alter table activity_laps rename column start_offset_s to start_index;
  end if;
end $$;

-- Lets the cron sweep find what is still missing without a full scan.
create index if not exists activities_detail_gap
  on activities (start_time desc) where provider = 'strava';
-- This file is idempotent: run it again after pulling and it upgrades in place.
-- Adding to a table above? Add the matching `add column if not exists` here.
alter table planned_sessions add column if not exists intervals_event_id  text;
alter table planned_sessions add column if not exists intervals_pushed_at timestamptz;
