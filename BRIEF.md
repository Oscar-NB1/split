# SPLIT — project brief

## What this is

A private training app for two people. One athlete is self-coached and racing
Hyrox doubles; the other is being coached by the first. Both wear Garmin
watches and both are on Strava. Right now that means training
data lives in three apps and the plan lives in a fourth, and neither person can
see what the other is doing without asking.

Split puts the plan and the reality in the same place, for both people, and
adds a reason to look at it every day.

Three things it has to do:

1. **Hold the plan.** Calendar view, one calendar per athlete, either person
   able to write to either. Runna handles the running spine for the
   self-coached athlete; everything else is programmed by hand.
2. **Pull in what actually happened.** Strava for activities (Garmin arrives
   through it) — automatically, with no copying anything anywhere.
3. **Make it competitive.** Effort points, adherence streaks, and a weekly
   head-to-head challenge that changes metric each week.

Not a product. Two users, one household, no growth plan, no App Store.

## Design decisions that carry weight

These are the choices the rest of the code hangs off. Change them deliberately.

**Planned and actual are separate tables, joined by a matcher.**
`planned_sessions` is what was asked for; `activities` is what happened. A
matcher pairs them. Almost everything interesting — adherence, compliance,
the split rails in the UI, the competition — falls out of that pairing rather
than being computed separately.

**The matcher is deliberately dumb.** Same athlete, same local date, closest
duration. No pace or HR heuristics. A confident wrong match is worse than an
unmatched activity the human re-pairs in one tap.

**A session completed under 70% of planned minutes is `adjusted`, not `done`.**
This single threshold is what lets the "scale it down" button exist: the
streak survives, the record still tells the truth.

**Missed sessions carry no debt.** Nothing rolls into next week. What a skip
does instead is feed the template engine — two fatigue-tagged skips and next
week's volume drops automatically, with a note saying why. A plan that adapts,
rather than one that accumulates guilt.

**Future weeks are derived, not stored.** A plan is a week shape plus
progression rules. Only three weeks ahead get written as rows. Change a rule
and the unwritten future re-renders. Anything beyond three weeks is fiction.

**Warn, never block.** Moving a session into a bad slot produces a message,
not a refusal. She keeps agency, the coach keeps visibility, the change log
means nobody has to remember what happened.

**No privacy walls between the two users.** Every read is scoped to the
household. This is a couples tool; the moment there's a third user, this
assumption and the auth model both need replacing.

## The constraint that shaped the architecture

Garmin's Connect Developer Program is business-use only — there is no
self-serve path for an individual, for reading activities or for writing
workouts. So:

- **Reading** Garmin data happens via Strava, which Garmin auto-syncs to.
- **Writing** workouts to the watch happens via intervals.icu, which has an
  open API and its own Garmin Connect integration.

Both are detours around the same closed door.

## Data model

Seven tables. `users` (two rows). `oauth_accounts` holds every external
credential keyed by provider — the Strava tokens, but also the Runna feed URL
and the intervals.icu key, which aren't OAuth but live there to keep credential
handling in one place. `activities` is immutable fact from Strava.
`planned_sessions` is intent, and moves through
`planned → done | adjusted | skipped | moved`. `session_changes` logs every
move, scale and skip. `plan_templates` holds week shapes and rules.
`challenges` stores the resolved weekly head-to-head so a finished week keeps
the metric it was actually scored on.

## File map

### Core libraries — `lib/`

| File | What it does |
|---|---|
| `db.ts` | Postgres client, singleton across hot reloads. |
| `session.ts` | Signed cookie sessions. `requireUser()` guards every write route. |
| `strava.ts` | OAuth, token storage, and refresh. Access tokens live 6 hours; `accessTokenFor()` refreshes anything expiring within 5 minutes and writes the new pair back. **Every Strava call goes through it**, so expiry is handled in exactly one place. |
| `ingest.ts` | Turns a Strava activity into a row, then pairs it with the day's plan. Also holds `effortPoints()` — weighted by session type so station work isn't undervalued against running. The weights are a starting guess; tune them. |
| `runna.ts` | A ~40-line iCalendar reader (no dependency — we need four fields) and the mirror into `planned_sessions`. Never touches the past or anything already moved. |
| `templates.ts` | The plan engine. Materialises `horizon` weeks, applies deloads and the fatigue rule. Idempotent — safe to run hourly forever. |
| `intervals.ts` | Renders a session into intervals.icu workout syntax and pushes it. Rests are written as time or distance on purpose: rest-to-heart-rate degrades to a plain timer once it reaches a Garmin watch. |
| `scoring.ts` | Weekly challenge metrics, the rotation between them, and the streak rule. |

### API routes — `app/api/`

| Route | What it does |
|---|---|
| `auth/login` | Two access codes from env → a session cookie. The whole auth system. |
| `strava/connect` · `strava/callback` | The OAuth round trip. The callback rejects a connection missing `activity:read_all`, because without it you only get public activities. |
| `strava/webhook` | Answers Strava's verification GET, then handles events. **Acknowledges in under 2 seconds and fetches afterwards** — Strava doesn't wait and retries anything slow. |
| `sessions` (POST) | Create a session on either calendar. |
| `sessions/[id]` (PATCH) | The four actions: move, scale, skip, note. This file is where the "what if she can't do it" behaviour actually lives. |
| `week` | Everything one screen needs — sessions, unmatched activities, streaks, the challenge — in one round trip. |
| `intervals` | Stores the intervals.icu key (POST) and the Runna feed URL (PUT). |
| `cron` | Hourly: Runna sync, template materialisation, push to watch. Each wrapped so one broken feed can't stop the others. |

### UI — `app/` and `components/`

| File | What it does |
|---|---|
| `globals.css` | The whole design system. Two athlete colours (amber / teal) rather than one accent, because everything in this app is comparative. Mobile-first; the 7-column desktop grid is the override. |
| `Calendar.tsx` | The app. Three tabs, week navigation, the day strip on mobile, the split rails, the tug bar, and the action sheets. |
| `Connections.tsx` | Settings — the four connections, each with the manual step it needs. |
| `login` · `settings` · `page` | Thin server components; all three redirect to login without a session. |

### Setup and scripts

| File | What it does |
|---|---|
| `db/schema.sql` | Seven tables, run once. |
| `scripts/seed-users.ts` | Creates the two user rows from env. |
| `scripts/backfill-strava.ts` | One-time history import, paced under the rate limit. Re-runnable. |
| `scripts/subscribe-webhook.ts` | Creates, lists and deletes the Strava push subscription — the fiddliest part of setup. |
| `public/manifest.json` · `sw.js` · icons | PWA. Add to Home Screen is how the second person "downloads" it. |
| `vercel.json` | Registers the hourly cron. |

## Two flows worth tracing

**A run gets logged.** Watch syncs to Garmin Connect → Garmin pushes to Strava
→ Strava fires the webhook → `handle()` looks up which user owns that athlete
id → `stravaGet` fetches the activity → `upsertActivity` writes it →
`matchToPlan` finds the day's open session and marks it done or adjusted →
next page load, the rail fills and the tug bar moves.

**She can't do Thursday's intervals.** She opens the session, taps a reason.
`PATCH /sessions/[id]` sets `skipped`, records the reason, writes a
`session_changes` row. Nothing reschedules. Next time the cron runs
`materialise()`, `fatigueSkips()` counts tired/sore/sick skips from last week;
at two or more, next week's sessions are written 15% shorter with a coach note
explaining the cut.

## Deliberately unfinished

- Auth is two codes in environment variables.
- OAuth tokens are stored unencrypted.
- Zone-2 minutes are approximated from average HR per activity, not from HR
  streams — fine for a weekly challenge, wrong for training analysis.
- No push notifications; the service worker is an offline shell only.
- The OAuth `state` parameter carries a user id and isn't signed.

Every one of these is fine for two people behind a private URL, and none of
them is fine for a third user.
