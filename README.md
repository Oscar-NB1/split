# SPLIT

Two athletes, one calendar. A private training app for exactly two people:
planned sessions on one side, real Garmin/Whoop data on the other, and a
competitive layer over the top.

This drop is the **spine**: database, auth, Strava OAuth, history backfill,
and the live webhook. Everything else hangs off this working.

---

## Setup, in order

Do these in sequence. Steps 1-4 are clicking, step 5 is where things break.

### 1. Database (10 min)

Create a Postgres database at [neon.tech](https://neon.tech) or
[supabase.com](https://supabase.com). Free tier is plenty for two people.
Copy the **pooled** connection string.

```bash
cp .env.example .env.local        # fill in DATABASE_URL
npm install
npm run db:push                   # creates the tables
```

Generate a session secret while you're here:

```bash
openssl rand -base64 32           # -> SESSION_SECRET
```

Pick two access codes (long, random) for `USER_A_CODE` and `USER_B_CODE`.
That's the whole auth system for now — see *Known shortcuts* below.

### 2. Deploy (10 min)

```bash
npx vercel                        # link the project
npx vercel env pull               # or paste vars in the dashboard
npx vercel --prod
```

Set `APP_URL` to your real deployed URL, **no trailing slash**. Then
redeploy — several things read it at request time.

```bash
npm run db:seed                   # creates the two user rows
```

### 3. Strava app (5 min)

At [strava.com/settings/api](https://www.strava.com/settings/api), create an
application.

> **Authorization Callback Domain** must be your bare domain — `split.vercel.app`.
> No `https://`, no path, no trailing slash. This field rejects more setups
> than anything else in this build.

Copy the Client ID and Client Secret into your env. Invent a random
`STRAVA_VERIFY_TOKEN` (any string; Strava echoes it back).

### 4. Connect both accounts (2 min)

Each of you signs in with your access code, then visits:

```
https://your-domain/api/strava/connect
```

Approve on Strava's screen, **leaving all permission boxes ticked** — the
callback rejects the connection without `activity:read_all`, because without
it you only get public activities.

### 5. Webhook (this is the one that fights back)

```bash
npm run strava:subscribe create
```

Strava immediately sends a GET to `/api/strava/webhook` to verify it. If that
GET doesn't return the challenge, the whole thing fails. Common causes, in
order of likelihood:

| Symptom | Cause |
|---|---|
| `callback url not verifiable` | app not deployed yet, or `APP_URL` wrong |
| `already exists` | Strava allows exactly **one** subscription per app — list, delete, recreate |
| verification 403s | `STRAVA_VERIFY_TOKEN` differs between your env and the command |

Inspect or clean up:

```bash
npm run strava:subscribe          # list
npx tsx scripts/subscribe-webhook.ts delete <id>
```

Then finish a run and watch it appear. That's the real test.

### 6. Backfill your history

```bash
npx tsx scripts/backfill-strava.ts you@example.com
npx tsx scripts/backfill-strava.ts her@example.com
```

Pulls every activity Strava holds, oldest to newest, pacing itself under the
rate limit. Re-running is safe — activities upsert on `(provider, activity_id)`.

---

## How the pieces fit

**`lib/strava.ts`** — OAuth, token storage, and refresh. Access tokens live 6
hours; `accessTokenFor()` refreshes anything expiring within 5 minutes and
writes the new pair back. Every other Strava call goes through it, so token
expiry is handled in exactly one place.

**`lib/ingest.ts`** — turns a Strava activity into a row, then tries to pair it
with whatever was planned that day. The matcher is deliberately dumb: same
athlete, same local date, closest duration. Anything cleverer produces
confident wrong answers, and a human can re-pair in the UI in one tap.

A session completed at under 70% of planned minutes lands as `adjusted`, not
`done` — that distinction is what lets the streak survive a scaled-down
session while still telling the truth about it.

**Effort points** are weighted by session type (`effortPoints()`), so station
work isn't undervalued against running the way raw duration would do. The
weights are a starting guess. Tune them once you've watched a few weeks.

**`app/api/strava/webhook`** — answers Strava's verification GET, then handles
events. It acknowledges in under 2 seconds and does the fetch afterwards,
because Strava doesn't wait and retries anything slow.

**Status model** — `planned` → `done` | `adjusted` | `skipped` | `moved`.
Skipped sessions carry a reason and **do not roll forward as debt.** Nothing
stacks onto next week. Every change writes a row to `session_changes`, so
neither of you has to remember what happened or argue about it.

---

## Known shortcuts

Deliberate, and worth knowing before you build on top:

- **Auth is two access codes in env vars.** Fine for a household tool on a
  private URL. Not fine if this ever has a third user — swap for magic links.
- **OAuth tokens are stored in plain text.** Encrypt them if this stops being
  just the two of you.
- **`state` in the OAuth flow carries the user id and isn't signed.** For two
  known users behind a login it's academic; sign it before anyone else uses this.
- **No UI yet.** The prototype HTML is the design; wiring it to these
  endpoints is the next piece.

## Next, in order of usefulness

1. Wire the prototype calendar to `planned_sessions` and `activities`.
2. Session actions: move, scale down, skip with reason.
3. Whoop OAuth — same shape as Strava, fills the `wellness` table.
4. Runna iCal feed → `planned_sessions` where `source = 'runna'`.
5. Template engine: materialise `horizon` weeks ahead, regenerate on rule change.
6. intervals.icu push, so programmed sessions land on the watch.
