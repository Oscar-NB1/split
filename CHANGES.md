# Correctness pass

No new features. Everything here is a bug that existed in the code you sent, or
a guard added so the same bug can't come back. `npm run typecheck`, `npm test`
(37 tests) and `next build` are all green.

Three things need a decision from you — they're in **Judgment calls** at the
bottom. Everything above that is unambiguous.

---

## The three that would have hurt

### 1. Every week boundary was a day out, and DST ate a week twice a year

`lib/templates.ts` and `lib/scoring.ts` both built a date with local getters and
then called `.toISOString().slice(0,10)`, which is UTC. In Berlin that reports
the **previous day**:

- `materialise()` wrote every template session one day early. Monday's easy run
  landed on Sunday, and `planned_date < today` skipped things that hadn't
  happened yet.
- `weekStart()` returned Sunday between midnight and 02:00, so overnight the app
  ran Sunday-to-Saturday weeks. A session finished late on Sunday scored in the
  wrong week's challenge.

Separately, `planWeek` was `Math.floor(msDifference / (7 * 864e5))`. A DST
weekend is 23 or 25 hours long, so a week measures 0.994 weeks and week 4 floors
to week 3 — twice a year, the plan silently repeated a week.

**Fix.** New `lib/dates.ts`. Dates are `'YYYY-MM-DD'` strings everywhere;
arithmetic runs on a noon-UTC anchor, so no offset can push a date onto a
neighbouring day, and day counting is exact. `templates.ts`, `scoring.ts`,
`runna.ts` and `Calendar.tsx` all go through it.

**And the layer underneath it.** A local-timezone `iso()` is only correct if the
server's timezone is the athletes'. Vercel runs Node with `TZ=UTC`, so the fix
was still half-broken on the server. `iso()` now formats through
`Intl.DateTimeFormat` with an explicit zone from **`NEXT_PUBLIC_APP_TIMEZONE`**
— a new variable you need to set to `Europe/Berlin`. It's `NEXT_PUBLIC_` so the
browser and the server agree on what today is. A typo in it logs an error and
falls back to the system zone rather than throwing on every date in the app.

### 2. The watch was getting one workout per hour, per session

`pushSession()` always `POST`ed a new intervals.icu event, and `pushUpcoming()`
selected every planned run in the next ten days regardless of whether it had
already been sent. `vercel.json` runs that hourly. One planned run became 24
identical workouts in Garmin Connect per day.

**Fix.** Two new columns (`intervals_event_id`, `intervals_pushed_at`) and a
`PUT`-then-`POST`-on-404 flow, so a session updates the workout it already owns.
`pushUpcoming()` now only touches sessions where `intervals_pushed_at <
updated_at`, so an unchanged week costs zero requests. `markPushed()`
deliberately doesn't touch `updated_at` — that gap is the signal.

Two related ones came out of the same file:

- **A skip left the workout on the watch.** She'd get an alert for a session you
  both agreed she wasn't doing. Skipping now deletes the event, and the event id
  is kept if the delete fails so it can be retried rather than orphaned.
- **Runna's prose was being sent as workout syntax.** `runna.ts` puts the feed's
  description into `target`, and `toWorkoutText()` treated `target` as
  intervals.icu step syntax. Structure vs prose is now decided by provenance
  (`source !== 'runna'`), not by the shape of the text — Runna prose is full of
  "45 min" and "8 x 400m", so no heuristic separates them reliably.

### 3. An expired session was a 500

`requireUser()` threw a bare `Error` that nothing caught, so every write route
answered 500 — indistinguishable from a broken server, and the UI showed
nothing at all. New `lib/http.ts` gives typed `HttpError`s and a `route()`
wrapper: 401 for a dead session, 400 for bad input, 404 for a missing session,
500 only for something genuinely unexpected. The `/connect` routes redirect to
the login screen instead, since a browser navigates to those directly. The
client now surfaces the message and bounces to `/login` on a 401 — writes used
to fail silently and close the sheet as if they'd worked.

---

## The rest of the sweep

| Where | What was wrong |
|---|---|
| `strava/webhook` | The post-ack work was a floating promise. On serverless the runtime freezes when the response goes out, so logged runs were silently dropped. Now `after()`. Same for the four watch-push calls in the session routes. |
| `ingest.ts` | Deleting an activity in Strava left the session marked `done` with no activity behind it, a stale `actual_minutes` and effort points for a run that no longer existed (the FK is `on delete set null`). New `unpairActivity()` puts it back to `planned`. |
| `ingest.ts` | The matcher read a session with no planned duration as an exact match, so an untimed "Hyrox stations" beat the 40-minute easy run for a 41-minute activity. Untimed candidates now rank last. |
| `ingest.ts` | `kindFor()` was inverted for the thing effort weighting exists for: Garmin station work reaches Strava as `Workout`, which mapped to `strength` (0.75, less than an easy run), while anything unrecognised — yoga — mapped to `hyrox` (1.7). Now `Workout`/`HIIT`/`Crossfit` → `hyrox`, `WeightTraining` → `strength`, unknown → conservative. |
| `whoop.ts` | `next_token` was ignored, so "six months backfills on connect" imported about three weeks and stopped. Now paginates. |
| `whoop.ts` | A refresh response without a new `refresh_token` wrote null over the old one, bricking the connection until manual re-auth. Now preserved. A null `expires_at` also threw. |
| `runna.ts` | Line unfolding only matched CRLF, so a feed served with bare LF broke long titles mid-word. |
| `runna.ts` | The hourly sync bumped `updated_at` on every poll whether anything changed or not — which, with fix 2 in place, would have rewritten every workout on the watch once an hour anyway. Now only writes on a real difference. |
| `templates.ts` | `source_ref` embedded the plan week number, which is derived — so fixing the DST bug renumbered every ref and would have re-inserted a duplicate of every future session. Keyed on the date now, which is stable, and survives the athlete moving a session. |
| `week` route | Unplanned activities came back without `status` or `source`, so the UI drew a real run as an unstarted plan with an empty rail. They're tagged `unplanned` and render as "off plan" with a dashed edge. |
| `week` route | `?week=` wasn't snapped to a Monday, so a mid-week date gave this week's challenge metric over a Wednesday-to-Wednesday scoring window. |
| `sessions` routes | No input validation: a missing `to_date` nulled `planned_date`, an unknown `kind` silently broke the matcher and the labels, and a non-integer or non-uuid reached Postgres as a 500. All 400s now, with a message. A malformed session id in the path is a 404. |
| `sessions/[id]` | Scaling twice nested the title: "Easy run (was: Easy run (was: Intervals))". |
| `intervals` route | Reconnecting with a different intervals.icu athlete id left every stored event id pointing at the old athlete's events, and `pushUpcoming` skips anything already pushed — so the obvious recovery action reported "0 pushed" and sent nothing. |
| `db.ts` | `ssl: "require"` was unconditional, so a local Postgres couldn't connect. Now decided by hostname (not by matching the whole connection string, which would drop TLS for a password containing "localhost") and `sslmode=disable` is honoured. |
| `Calendar.tsx` | "today" was computed in UTC, so the highlight was on the wrong day for two hours after midnight. The hardcoded race date is now `NEXT_PUBLIC_RACE_DATE`. |
| `Connections.tsx` | Save failures said "failed" with no reason, when almost every failure there is a mistyped key or a `webcal://` URL. |

## Tests

37 tests in `tests/`, no database needed, run with `npm test`. They cover the
date helpers, the iCal reader, the matcher and its 70% threshold, effort
weighting, the template progression rules, the workout rendering and the
challenge rotation.

They run under **`TZ=Europe/Berlin`**, on purpose: every date bug above is
invisible in UTC, which is what CI would otherwise default to.

The suite earns its keep already — the `kindFor` inversion above was found by a
test I wrote expecting it to pass, and each date test fails against the old
implementation.

## Judgment calls — your decision

1. **Long-run progression and deloads interact differently now.** Progression
   used to be dropped entirely on a deload week, so a week-11 deload came out
   *shorter* than week 1. It now applies first and the deload scales the real
   volume. I think the old behaviour was a bug, but it does change the shape of
   any plan you write.
2. **I added a `long_run_max_min` cap, default 150.** Without one, `5 min/week`
   compounds forever — two years out the long run is ten hours. It will silently
   truncate a genuine marathon build, so it wants documenting wherever you
   author templates. Say the word and I'll drop it.
3. **`kindFor` now maps `Workout` → `hyrox`.** Right if your station sessions
   record as Garmin Cardio/HIIT/Crossfit, wrong if you log something else as a
   generic "Workout". Worth checking against one real week of Strava data.

## Still not built

Unchanged from your list, plus two I hit while working:

- `plan_templates` has no route and no UI. The engine reads it, is idempotent
  and is tested, but a template has to be inserted by hand — so the adaptation
  path (skip twice → next week comes down) can't actually run yet.
- An unplanned activity can't be paired to a session by hand. It shows on the
  day marked "off plan"; the one-tap re-pair the brief describes isn't there.
- Auth is still two codes in env vars, tokens are still unencrypted, the OAuth
  `state` is still unsigned, and Zone-2 minutes are still approximated from
  average HR. All four are fine for two people behind a private URL.
