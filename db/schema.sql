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
  -- strava | intervals. There is no Apple Health or Garmin here: HealthKit has
  -- no web API, and Garmin's needs a business agreement — both reach us through
  -- Strava, which is why Strava is the only thing worth asking an athlete for.
  provider          text not null,
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
  source             text not null default 'manual', -- manual | template
  source_ref         text,                           -- template week id
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

-- One plan of a given name per athlete. seed-plan.ts always claimed to upsert on
-- this pair, but nothing enforced it, so running the script twice wrote a second
-- active template and every session in the block was materialised twice — 20
-- duplicated sessions on the calendar with no way to tell which copy was real.
create unique index if not exists plan_templates_athlete_name
  on plan_templates (athlete_id, name);

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

-- ------------------------------------------------- session logging (2026-08-15)
-- The three tables the Brief, Strength and Activity screens need. Each hangs
-- off a planned session rather than off an activity, because the thing being
-- logged is the prescription being executed — a set belongs to "Strength A",
-- not to whatever Strava happened to record around it.

-- One row per set. `prescribed_*` is what the plan asked for and never changes;
-- `load_kg`/`reps` are what actually happened. Keeping both is the entire point:
-- "3x5 @ 100" vs "3x5 @ 95" is the signal the progression rules read.
create table if not exists session_sets (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references planned_sessions(id) on delete cascade,
  exercise          text not null,
  ord               int  not null,            -- exercise order within the session
  set_no            int  not null,            -- 1-based set within the exercise
  prescribed_load   numeric,
  prescribed_reps   int,
  load_kg           numeric,
  reps              int,
  done              boolean not null default false,
  note              text,
  updated_at        timestamptz not null default now(),
  unique (session_id, ord, set_no)
);

-- How it felt. Separate from the activity because RPE is the athlete's report on
-- the *session*, and a session can exist with no activity behind it.
create table if not exists session_feedback (
  session_id   uuid primary key references planned_sessions(id) on delete cascade,
  rpe          int,                            -- 1-10
  length_feel  text,                           -- short | right | long
  note         text,
  updated_at   timestamptz not null default now()
);

-- The coach thread. Two people, so no read receipts and no threading — just
-- who said what, when, against which session.
create table if not exists session_comments (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references planned_sessions(id) on delete cascade,
  author_id   uuid not null references users(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists session_comments_session
  on session_comments (session_id, created_at);

-- ------------------------------------------------------------ notifications
-- One row per device per person. The endpoint is the identity: the push service
-- issues a new one when a subscription is renewed, and the old one starts
-- answering 410, which is the cue to delete it.
create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);

-- The queue, the log and the de-duplicator, in one table.
--
-- Queue first, send second. That single decision is what lets quiet hours
-- *defer* a notification rather than drop it, and `dedupe_key` is what stops the
-- same thing being announced twice — Strava fires an update event for an
-- activity it already told us about, and the hourly cron re-evaluates the same
-- upcoming session every hour until it stops being tomorrow.
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  kind        text not null,
  dedupe_key  text not null,
  title       text not null,
  body        text not null,
  url         text,
  created_at  timestamptz not null default now(),
  send_after  timestamptz not null default now(),
  sent_at     timestamptz,
  unique (user_id, dedupe_key)
);
create index if not exists notifications_pending
  on notifications (send_after) where sent_at is null;

-- Current personal bests, one row per person per metric. Beating one is what
-- produces the notification; the row itself is the bar.
create table if not exists records (
  user_id      uuid not null references users(id) on delete cascade,
  metric       text not null,
  value        numeric not null,
  activity_id  uuid references activities(id) on delete set null,
  achieved_on  date not null,
  previous     numeric,
  primary key (user_id, metric)
);

-- Lets the cron sweep find what is still missing without a full scan.
create index if not exists activities_detail_gap
  on activities (start_time desc) where provider = 'strava';
-- This file is idempotent: run it again after pulling and it upgrades in place.
-- Adding to a table above? Add the matching `add column if not exists` here.
alter table planned_sessions add column if not exists intervals_event_id  text;
alter table planned_sessions add column if not exists intervals_pushed_at timestamptz;
-- What kind of day this is: null | key | benchmark | race. Set by the plan, so
-- "benchmark tomorrow" never depends on matching words in a title.
alter table planned_sessions add column if not exists significance text;
-- Per-person notification switches. On the user row rather than its own table:
-- two people, one column.
alter table users add column if not exists notify jsonb not null default '{}';
-- AM | PM. The plan puts two sessions on Monday and Thursday, and which half of
-- the day they belong to is part of the prescription, not decoration.
alter table planned_sessions add column if not exists slot text;

-- Athlete profile (2026-08-15). Zones were a module constant derived from one
-- athlete's max of 189 and applied to whoever's activity was open — correct for
-- one person and wrong for the other the moment she connects a watch.
alter table users add column if not exists hr_max int;
alter table users add column if not exists zones jsonb;          -- explicit override
alter table users add column if not exists dob date;
alter table users add column if not exists weight_kg numeric;
alter table users add column if not exists injury_notes text;

-- The join that makes a training session's laps comparable to the race plan
-- (2026-08-15). A Hyrox session's laps are named by the watch ("Lap 7"), so
-- without this there is no way to line a sled push in training up against the
-- sled push in a result. Set at import, never derived at read time.
alter table activity_laps add column if not exists station_key text;
create index if not exists activity_laps_station on activity_laps (station_key)
  where station_key is not null;

-- The race plan the Strategy screen builds (2026-08-15). It was component state
-- seeded from a constant, so the screen carried a footnote reading "Changes here
-- are not saved yet" and its export button set a boolean and claimed the plan had
-- been sent to the watch. One row per athlete per race date.
create table if not exists race_plans (
  user_id       uuid not null references users(id) on delete cascade,
  race_date     date not null,
  segments      jsonb not null,
  rox_seconds   int not null default 30,
  -- the intervals.icu event, so re-exporting updates the workout on the watch
  -- rather than adding a second copy of the same race
  event_id      text,
  exported_at   timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (user_id, race_date)
);

-- The block moves into the database (2026-08-15). Its start, race, goal, volume
-- table and phase narrative were module constants in lib/coach.ts, so every screen
-- that read them showed the same block to whoever was signed in — the second
-- athlete saw the first athlete's race and target as hers. Same shape as the HR
-- zones, which were one athlete's measured maximum applied to both.
alter table plan_templates add column if not exists race_date    date;
alter table plan_templates add column if not exists race_name    text;
alter table plan_templates add column if not exists goal_label   text;
alter table plan_templates add column if not exists goal_seconds int;
-- per-week volume target and its one-line note, in week order: [{km, note}]
alter table plan_templates add column if not exists volume  jsonb not null default '[]';
-- what a phase is for, by week range:
--   [{from, to, phase, purpose, protect[], sacrifice, watch}]
alter table plan_templates add column if not exists intents jsonb not null default '[]';

-- What an athlete tells us about themselves (2026-08-15), and the only honest
-- source for a block when nobody here has written them a plan document. Mirrors
-- the intake in the design question for question: the values stored are the
-- labels the screens send, so there is no translation layer to drift.
--
-- Rebuilt rather than patched when the design's intake landed. The previous
-- columns encoded a different set of questions, and keeping both would have left
-- two answers to "how much do you run".
create table if not exists athlete_intake (
  user_id        uuid primary key references users(id) on delete cascade,
  -- the goal
  has_race       text not null,          -- Yes | No
  discipline     text not null,          -- Hyrox doubles | Hyrox singles | Running race | General fitness
  race_distance  text,                   -- running races only
  race_date      date,
  role           text,                   -- Protected | Engine | Even split (doubles only)
  division       text,                   -- sets the station loads (Hyrox only). Asked, never derived from sex.
  -- where they are now. base and running_self are asked separately and the lower
  -- of the two governs: a year of consistent training with walk breaks reads as
  -- experienced and would be handed 30 km in week 1, when 5 km continuous is not
  -- yet there. Aerobic fitness runs ahead of connective tissue.
  base           text not null,
  running_self   text not null,
  pace_min       int,
  pace_sec       int,
  pace_unknown   boolean not null default false,
  -- the week
  days           text[] not null default '{}',
  commitments    text[] not null default '{}',
  freq           jsonb  not null default '{}',   -- {commitment: sessions per week}
  commit_day     jsonb  not null default '{}',   -- {commitment: [days it is fixed to]}
  -- what they can train with
  equipment      text[] not null default '{}',
  sled           text,
  -- what to work around, and how hard to push
  injuries       text,
  volume         text not null,          -- Conservative | Progressive | Aggressive
  difficulty     text not null,          -- Steady | Challenging | Hard
  -- where the benchmark got to. Only 'logged' lifts the conservatism: week 1
  -- comes off 85% of the ceiling and the ramp cap goes from 8% to 12%.
  benchmark      text not null default 'offered',
  completed_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- The plan document gained a state model (2026-08-15). The chip on the plan
-- header reads Estimated, Awaiting baseline or Measured, and the benchmark's
-- variant and protocol version live here because a result is only comparable
-- within its own variant and protocol.
alter table plan_templates add column if not exists plan_state  text;
alter table plan_templates add column if not exists benchmark   jsonb not null default '{}';
alter table plan_templates add column if not exists guardrails  jsonb not null default '[]';
alter table plan_templates add column if not exists easy_pace   int;
alter table plan_templates add column if not exists corrections jsonb not null default '[]';

-- Who coaches whom (2026-08-15). Read from here rather than hardcoded, so a
-- second athlete appears on the profile without a code change — and, more
-- importantly, so "may I open this person's plan" has one answer in one place.
-- An `athlete` parameter on a request is an access-control question.
create table if not exists coaching (
  coach_id   uuid not null references users(id) on delete cascade,
  athlete_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (coach_id, athlete_id),
  -- coaching yourself is not a relationship
  check (coach_id <> athlete_id)
);

-- Accounts (2026-08-15). Everything in this app hangs off a user id — activities,
-- plans, zones, records, the coaching relationship — so this is where a mistake
-- hands somebody another athlete's training history.
alter table users alter column email drop not null;   -- a Strava sign-in has none
alter table users add column if not exists password_hash  text;
alter table users add column if not exists avatar_url     text;
alter table users add column if not exists email_verified boolean not null default false;
alter table users add column if not exists failed_logins  int not null default 0;
alter table users add column if not exists locked_until   timestamptz;

-- Compared case-insensitively, so unique that way too: "Sarah@example.com" and
-- "sarah@example.com" are one mailbox, and two accounts would each hold half a
-- training history.
create unique index if not exists users_email_lower on users (lower(email));

-- A way of signing in that is not a password. Keyed on the provider's own
-- subject, never on the email, because people change their email and the subject
-- is what stays the same.
--
-- Separate from oauth_accounts, which is about reading an athlete's data: the
-- same Strava account can be both, and disconnecting the data should not sign
-- anyone out.
create table if not exists identities (
  provider    text not null,          -- google | apple | strava
  subject     text not null,
  user_id     uuid not null references users(id) on delete cascade,
  email       text,
  created_at  timestamptz not null default now(),
  last_used   timestamptz,
  primary key (provider, subject)
);
create index if not exists identities_user on identities (user_id);

-- Brief 2's schema (2026-08-15). Alongside what exists rather than replacing it:
-- the app still runs on the original tables while the new generator is built.
--
-- `race_targets`, not `races`. That name was already taken by the Hyrox results
-- import — a record of a race that HAPPENED. This is a race being trained for.
-- Two different things, and overloading one table would make both unreadable.
alter table users add column if not exists sex                  text;
alter table users add column if not exists general_training_age text;
alter table users add column if not exists running_base         text;
alter table users add column if not exists hyrox_experience     jsonb;
alter table users add column if not exists sled_experience      text;
alter table users add column if not exists kit                  text[] not null default '{}';
alter table users add column if not exists access               text;
alter table users add column if not exists run_attachment       text;
-- derived at intake and stored, never recomputed: a plan has to stay
-- explainable after the athlete changes gyms
alter table users add column if not exists variant              text;
alter table users add column if not exists session_preference   text;

create table if not exists race_targets (
  id            uuid primary key default gen_random_uuid(),
  athlete_id    uuid not null references users(id) on delete cascade,
  race_date     date,
  start_date    date not null,
  discipline    text not null,
  division      text,
  sex_category  text,
  goal          text not null,          -- finish | strong | compete
  target_time_s int,
  created_at    timestamptz not null default now()
);
create index if not exists race_targets_athlete on race_targets (athlete_id);

-- Signed five-point deltas. The SIGN picks the training role; the size only
-- decides how the work is split on race day.
create table if not exists partners (
  race_target_id uuid primary key references race_targets(id) on delete cascade,
  run_delta      int not null check (run_delta between -2 and 2),
  station_delta  int not null check (station_delta between -2 and 2),
  result_ref     text,
  train_together boolean not null default false
);

create table if not exists schedules (
  race_target_id  uuid primary key references race_targets(id) on delete cascade,
  available_days  int[] not null default '{}',
  target_sessions int not null,
  allow_doubles   boolean not null default false,
  want_rest_day   boolean not null default true,
  commitments     jsonb not null default '[]',
  absences        jsonb not null default '[]'
);

-- Append-only: one row per field per capture, never updated in place. A
-- measurement six months old is still a measurement, and overwriting it loses
-- the ability to say when something changed.
create table if not exists capabilities (
  id          bigserial primary key,
  athlete_id  uuid not null references users(id) on delete cascade,
  field       text not null,
  value       double precision not null,
  source      text not null,   -- measured_race | measured_benchmark | reported_race | reported_self
  captured_at timestamptz not null default now()
);
create index if not exists capabilities_lookup
  on capabilities (athlete_id, field, captured_at desc);

create table if not exists benchmark_results (
  id               uuid primary key default gen_random_uuid(),
  athlete_id       uuid not null references users(id) on delete cascade,
  protocol_version int not null,
  variant          text not null,
  submaximal       boolean not null default false,
  completed_at     timestamptz not null default now(),
  rounds           jsonb not null default '[]',
  hr               jsonb,
  aborted          boolean not null default false,
  abort_round      int
);
create index if not exists benchmarks_athlete on benchmark_results (athlete_id, completed_at desc);

-- `resolved_params` is the point: any plan must be explainable and reproducible
-- six months later, and without the inputs it is not. `superseded_by` keeps the
-- prior plan, because a regeneration that produces a worse one must be revertible.
create table if not exists plans (
  id                uuid primary key default gen_random_uuid(),
  race_target_id    uuid not null references race_targets(id) on delete cascade,
  generated_at      timestamptz not null default now(),
  generator_version text not null,
  confidence        text not null,
  resolved_params   jsonb not null,
  weeks             jsonb not null default '[]',
  flags             jsonb not null default '[]',
  superseded_by     uuid references plans(id),
  active            boolean not null default true
);
create index if not exists plans_target on plans (race_target_id, generated_at desc);

-- Versioned config, never inline constants: Hyrox revises standards between
-- seasons, and a plan built on a stale table is quietly wrong until race day.
create table if not exists standards (
  season   text not null,
  division text not null,
  sex      text not null,
  loads    jsonb not null,
  primary key (season, division, sex)
);

-- What she reads in her week (2026-08-15). Two different things that look alike
-- and are stored apart because they behave differently.
--
-- A `context` message is keyed to a kind of week — one for a deload, one for a
-- taper, one for the week a benchmark lands in — and is written once, then
-- shown every time a week of that kind comes round. A `warm` message belongs to
-- no particular week and rotates. Storing them in one table with a nullable key
-- would make "which message does this week get" a query with a coalesce in it
-- rather than a lookup.
create table if not exists coach_messages (
  id         uuid primary key default gen_random_uuid(),
  coach_id   uuid not null references users(id) on delete cascade,
  athlete_id uuid not null references users(id) on delete cascade,
  kind       text not null check (kind in ('context', 'warm')),
  -- benchmark | deload | taper | raceclose | peak | build | base, for context
  -- messages; null for warm ones, which are not keyed to anything
  context    text,
  body       text not null,
  position   int  not null default 0,
  updated_at timestamptz not null default now(),
  check ((kind = 'context') = (context is not null))
);

-- One context message per kind of week: writing a second is editing the first.
create unique index if not exists coach_messages_context
  on coach_messages (coach_id, athlete_id, context) where kind = 'context';

-- The thread. Distinct from planned_sessions.coach_note, which is about one
-- session — this is the conversation that has nowhere else to live.
create table if not exists messages (
  id         uuid primary key default gen_random_uuid(),
  coach_id   uuid not null references users(id) on delete cascade,
  athlete_id uuid not null references users(id) on delete cascade,
  author_id  uuid not null references users(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists messages_pair on messages (coach_id, athlete_id, created_at desc);

-- What a benchmark did to the plan (2026-08-15). The before and after are
-- stored, the reading of them is not: a stored reading would freeze an
-- interpretation next to numbers that outlive it, and nothing in the row would
-- say which version of the band tables wrote it.
alter table benchmark_results add column if not exists plan_before jsonb;
alter table benchmark_results add column if not exists plan_after  jsonb;
alter table benchmark_results add column if not exists applied_at  timestamptz;

-- What they have actually been running lately (2026-08-15). Optional: not
-- everyone tracks, and refusing to build a plan without them would be worse
-- than the matrix guess they replace. Where they exist they beat every
-- adjective in the form — "runs regularly" is a self-description, 40 km a week
-- with a 16 km long run is a measurement.
-- Added under their old names and renamed below on 2026-08-16; a database built
-- from this file gets the current names directly, and the rename that follows is
-- for the ones that already had the old ones.
alter table athlete_intake add column if not exists peak_week_km   numeric;
alter table athlete_intake add column if not exists longest_run_km numeric;

-- Renamed to match the form (2026-08-16): the biggest week of the last four is
-- what week 1 builds from, and the longest run of the last eight caps the long
-- run. volume_source records whether Strava supplied them, which halves the
-- unmeasured haircut rather than clearing it.
-- The pre-rename columns, where they are still there.
--
-- A database that predates the rename carries the data under the old names, so it
-- is copied across; one that does not simply has nothing to copy. Either way the
-- old columns go, because two columns for one answer is how the wrong one ends up
-- being read.
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_name = 'athlete_intake' and column_name = 'recent_weekly_km') then
    update athlete_intake set peak_week_km = coalesce(peak_week_km, recent_weekly_km);
    alter table athlete_intake drop column recent_weekly_km;
  end if;
  if exists (select 1 from information_schema.columns
              where table_name = 'athlete_intake' and column_name = 'recent_long_run_km') then
    update athlete_intake set longest_run_km = coalesce(longest_run_km, recent_long_run_km);
    alter table athlete_intake drop column recent_long_run_km;
  end if;
end $$;
alter table athlete_intake add column if not exists volume_source text;

-- Time away (2026-08-16). Kept against the athlete rather than the race target,
-- because a trip is a fact about their life and outlives any one block — and
-- because it is edited from two places: the intake, and the profile.
--
-- schedules.absences stays as the snapshot the plan was generated from. This is
-- the living list; that is the record of what a given plan knew.
create table if not exists absences (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  from_date  date not null,
  to_date    date not null,
  -- no_training | some_access | normal
  kind       text not null default 'some_access'
    check (kind in ('no_training', 'some_access', 'normal')),
  note       text,
  created_at timestamptz not null default now(),
  check (to_date >= from_date)
);
create index if not exists absences_user on absences (user_id, from_date);

alter table users add column if not exists gender text;

-- Athlete archetype (2026-08-16). A label for findings already computed from a
-- benchmark. Read-only: it derives nothing and prescribes nothing, and if it
-- vanished no plan would change.
--
-- History is kept rather than overwritten, because a change of type is the most
-- useful output the feature has — "you used to fade and now you do not" says
-- more than either reading alone. derivation_version sits alongside
-- protocol_version: if the protocol changes, the bands may not hold.
create table if not exists archetypes (
  id                  uuid primary key default gen_random_uuid(),
  athlete_id          uuid not null references users(id) on delete cascade,
  type                text not null,
  confidence          text not null check (confidence in ('high', 'low')),
  derivation_version  int  not null,
  source_benchmark_id uuid references benchmark_results(id) on delete cascade,
  contributing        jsonb not null default '[]',
  dimensions          jsonb not null default '{}',
  derived_at          timestamptz not null default now()
);
create index if not exists archetypes_athlete
  on archetypes (athlete_id, derived_at desc);

-- Connections and head-to-head (2026-08-16).
--
-- One row per pair, canonically ordered by user id so (A,B) and (B,A) cannot
-- both exist — enforced, not merely intended. The direction still matters for
-- who asked, so requester_id is kept alongside rather than lost to the ordering.
create table if not exists connections (
  id            uuid primary key default gen_random_uuid(),
  low_id        uuid not null references users(id) on delete cascade,
  high_id       uuid not null references users(id) on delete cascade,
  requester_id  uuid not null references users(id) on delete cascade,
  addressee_id  uuid not null references users(id) on delete cascade,
  status        text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'disconnected')),
  -- single-use, seven days
  invite_code   text unique,
  invite_expires_at timestamptz,
  scope         text not null default 'adherence',
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  check (low_id < high_id),
  check (requester_id <> addressee_id)
);
create unique index if not exists connections_pair on connections (low_id, high_id);

create table if not exists rivalries (
  id            uuid primary key default gen_random_uuid(),
  connection_id uuid not null unique references connections(id) on delete cascade,
  started_at    timestamptz not null default now(),
  -- fixed at creation from the requester's, so both sides agree when a week
  -- ended. Without it they score different weeks and both are right.
  timezone      text not null default 'Europe/Berlin',
  requester_wins int not null default 0,
  addressee_wins int not null default 0
);

-- One row per rivalry per ISO week. The prescription is snapshotted at week
-- start: adaptation moves prescriptions, and rescoring a week retroactively
-- because the plan changed would let someone lose a week they had already won.
create table if not exists rivalry_weeks (
  rivalry_id  uuid not null references rivalries(id) on delete cascade,
  iso_week    text not null,              -- '2026-W34'
  week_start  date not null,
  requester   jsonb not null default '{}',
  addressee   jsonb not null default '{}',
  winner      text not null default 'undecided'
    check (winner in ('requester', 'addressee', 'tie', 'undecided')),
  points_requester int not null default 0,
  points_addressee int not null default 0,
  finalised_at timestamptz,
  primary key (rivalry_id, iso_week)
);

-- Usernames were specified for exact-match connection requests and are dropped
-- on instruction. Invite codes do the same job without the lookup, and removing
-- the lookup removes the account-enumeration oracle entirely rather than
-- rate-limiting it — there is no endpoint left that answers "does this person
-- exist". A single-use code that expires is strictly less to defend.
drop index if exists users_username;
alter table users drop column if exists username;

-- The reworked intake's extra steps (2026-08-16), in one jsonb column rather
-- than eleven columns: they are answers, not relations, and nothing queries
-- across them. An intake saved before they existed reads them back as null.
alter table athlete_intake add column if not exists answers jsonb not null default '{}';

-- Race plans (2026-08-16). One per race per athlete, held against race_targets.
--
-- Every field carries where its number came from, because that is what decides
-- whether the client may present it as the athlete's own. The projection and the
-- gap are not stored: both are pure functions of the components, and a stored
-- total would be a second answer that could disagree with the first.
create table if not exists race_plans (
  id            uuid primary key default gen_random_uuid(),
  race_id       uuid not null references race_targets(id) on delete cascade,
  athlete_id    uuid not null references users(id) on delete cascade,
  mode          text not null default 'components_up'
    check (mode in ('target_down', 'components_up')),
  target_total_s int,
  runs          jsonb not null default '[]',
  stations      jsonb not null default '[]',
  roxzone       jsonb not null default '{}',
  pushed_to_watch_at timestamptz,
  updated_at    timestamptz not null default now(),
  unique (race_id, athlete_id)
);

-- Race-week checklist state. The items themselves are code (lib/race/checklist.ts)
-- so their wording can improve without a migration; only what the athlete has
-- ticked, and anything they added, lives here.
create table if not exists race_checklist (
  race_id    uuid not null references race_targets(id) on delete cascade,
  athlete_id uuid not null references users(id) on delete cascade,
  item_id    text not null,
  label      text,                    -- set only for items the athlete added
  category   text,
  due_offset_days int,
  done       boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (race_id, athlete_id, item_id)
);

-- Venue details, which nothing can derive.
alter table race_targets add column if not exists venue      text;
alter table race_targets add column if not exists start_time text;
alter table race_targets add column if not exists wave       text;

-- Email is no longer identity (2026-08-16).
--
-- Registration creates a new athlete for any provider subject the app has not
-- seen, and never matches onto an existing account by address — so two accounts
-- may legitimately carry the same email: a Google sign-in and a Strava sign-in
-- by the same person are two athletes until they are deliberately linked.
--
-- The unique constraint made that a crash. Uniqueness lives on
-- identities (provider, subject), which is issued by the provider and is the
-- thing that actually identifies someone.
drop index if exists users_email_lower;
alter table users drop constraint if exists users_email_key;

-- Secondary races (2026-08-16). A plan has many races; exactly one is the target.
--
-- The target's intent is null rather than 'compete': it is not a choice, and a
-- column that can hold a value nobody may set is a column that will eventually
-- hold it.
create table if not exists plan_races (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references plan_templates(id) on delete cascade,
  race_date     date not null,
  venue         text,
  role          text not null check (role in ('target', 'secondary')),
  discipline    text,
  division      text,
  sex_category  text,
  partner_name  text,
  intent        text check (intent in ('training', 'sharpen', 'compete')),
  -- true once inside seven days: reshaping the weeks around a race you are about
  -- to run is not a decision anyone makes well
  intent_locked boolean not null default false,
  created_at    timestamptz not null default now(),
  check ((role = 'target') = (intent is null))
);

-- One target per plan, enforced rather than intended.
create unique index if not exists plan_races_one_target
  on plan_races (plan_id) where role = 'target';
create index if not exists plan_races_plan on plan_races (plan_id, race_date);

-- A result, with the per-field usability that decides what may reach the
-- capability hierarchy. Stored alongside the numbers so a later change to the
-- rules cannot retroactively promote a distorted field.
create table if not exists race_results (
  id             uuid primary key default gen_random_uuid(),
  race_id        uuid not null unique references plan_races(id) on delete cascade,
  athlete_id     uuid not null references users(id) on delete cascade,
  finish_s       int,
  run_avg_s      int,
  stations_s     int,
  rox_s          int,
  my_share       numeric,
  partner_slower boolean,
  field_usability jsonb not null default '{}',
  captured_at    timestamptz not null default now()
);

-- One race table (2026-08-16). plan_races and race_targets were the same concept
-- arrived at twice: race_targets from the plan briefs, plan_races from the B-race
-- brief a few hours later. race_targets wins because twelve other places already
-- reference it; the role and intent columns move onto it, and plan_races goes.
--
-- Free to do because both were empty. It would not have been tomorrow.
alter table race_targets add column if not exists role text not null default 'target'
  check (role in ('target', 'secondary'));
alter table race_targets add column if not exists intent text
  check (intent in ('training', 'sharpen', 'compete'));
alter table race_targets add column if not exists intent_locked boolean not null default false;
alter table race_targets add column if not exists partner_name text;

-- One target per athlete per plan window, enforced rather than intended.
create unique index if not exists race_targets_one_target
  on race_targets (athlete_id) where role = 'target';

drop table if exists race_results;
drop table if exists plan_races;

-- Results hang off the one race table.
create table if not exists race_results (
  id             uuid primary key default gen_random_uuid(),
  race_id        uuid not null unique references race_targets(id) on delete cascade,
  athlete_id     uuid not null references users(id) on delete cascade,
  finish_s       int,
  run_avg_s      int,
  stations_s     int,
  rox_s          int,
  my_share       numeric,
  partner_slower boolean,
  -- stored beside the numbers so a later change to the usability rules cannot
  -- retroactively promote a field that was distorted when it was captured
  field_usability jsonb not null default '{}',
  captured_at    timestamptz not null default now()
);

-- Lap and split lookups by activity (2026-08-16).
--
-- Both are always read as "every row for this activity", and neither had an index
-- for it — so the week screen's batched lap fetch planned a sequential scan over
-- every lap ever recorded. Cheap now at a few thousand rows and wrong at the
-- shape rather than the size.
create index if not exists activity_laps_activity
  on activity_laps (activity_id, lap_index);
create index if not exists activity_splits_activity
  on activity_splits (activity_id, split);

-- The week screen's own query: one athlete, one date range, ordered by day.
create index if not exists planned_sessions_user_date
  on planned_sessions (user_id, planned_date);

-- Invite codes (2026-08-16).
--
-- An open invite cannot live in `connections`: that row needs both athletes, and
-- the point of a code is that the second one is not known yet. So the code is its
-- own record, and redeeming it is what creates the connection.
--
-- Single-use and seven days by rule, both enforced here as well as in lib/connect
-- so a code cannot be redeemed twice by two requests arriving together.
create table if not exists connection_invites (
  code        text primary key,
  inviter_id  uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_by     uuid references users(id) on delete set null,
  used_at     timestamptz,
  revoked_at  timestamptz,
  check ((used_by is null) = (used_at is null))
);
create index if not exists connection_invites_inviter
  on connection_invites (inviter_id, created_at desc);

-- One open invite per athlete: the screen shows a single code, and a second live
-- code would mean a link they had already sent still worked after they replaced
-- it. Partial, so spent and revoked codes stay for the audit.
create unique index if not exists connection_invites_open
  on connection_invites (inviter_id)
  where used_at is null and revoked_at is null;

-- Every connection query is "mine, whatever side I am on".
create index if not exists connections_requester on connections (requester_id, status);
create index if not exists connections_addressee on connections (addressee_id, status);

-- Build failures (2026-08-16).
--
-- The intake answered a 500 with "Something broke. Try again.", which tells the
-- athlete nothing and tells whoever has to fix it less. The error is recorded here
-- with the answers that produced it, so a failure reported as "I cannot get past
-- the last step" can be read rather than guessed at from the outside.
--
-- Kept deliberately small: the message, where it happened, and the payload. No
-- stack in the client's hands — this is the server's copy.
create table if not exists build_failures (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references users(id) on delete cascade,
  at         timestamptz not null default now(),
  route      text not null,
  message    text not null,
  stack      text,
  payload    jsonb not null default '{}'
);
create index if not exists build_failures_at on build_failures (at desc);

-- Pace calibration decisions (2026-08-17).
--
-- The engine recommends a shift; the athlete accepts or declines it. Both are
-- recorded on the plan: the applied shift because every session written afterwards
-- has to carry it, and the declined value because an athlete who said no to four
-- seconds should not be asked again about the same four seconds every time they open
-- the app.
alter table plan_templates add column if not exists pace_shift_s int not null default 0;
alter table plan_templates add column if not exists pace_shift_declined_s int;
alter table plan_templates add column if not exists pace_shift_at timestamptz;
