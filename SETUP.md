# Setup — the parts only you can do

Everything else is written. This is the list of things that need your login.
Roughly an hour, most of it waiting on redirects.

## 1. Database

[neon.tech](https://neon.tech) → new project → copy the **pooled** connection string.

```bash
cp .env.example .env.local     # fill DATABASE_URL
npm install
npm run db:push
```

`db/schema.sql` is idempotent — `npm run db:push` is also how you apply schema
changes later, including the `intervals_event_id` columns the watch push needs.

Then check it holds together before you touch a browser:

```bash
npm run typecheck
npm test                       # 37 tests, runs in Europe/Berlin on purpose
```

## 2. Secrets

```bash
openssl rand -base64 32        # SESSION_SECRET
openssl rand -hex 16           # STRAVA_VERIFY_TOKEN
openssl rand -hex 16           # CRON_SECRET
```

Pick two long access codes for `USER_A_CODE` and `USER_B_CODE`. Set the two
names and emails. `USER_A` is whoever the app calls "You" by default.

Set `NEXT_PUBLIC_APP_TIMEZONE` to your timezone (`Europe/Berlin`). This one
matters: Vercel runs Node in UTC, and without it the server disagrees with the
phone about what day it is for the two hours after midnight — which is enough
to score a late Sunday session in the wrong week.

## 3. Deploy

```bash
npx vercel
npx vercel --prod
```

Set every variable from `.env.local` in the Vercel dashboard, set `APP_URL`
to the real URL **with no trailing slash**, redeploy, then:

```bash
npm run db:seed
```

Vercel picks up `vercel.json` and runs `/api/cron` hourly on its own.

## 4. Strava — 5 minutes

[strava.com/settings/api](https://www.strava.com/settings/api) → create app.

> **Authorization Callback Domain** is the bare domain: `split.vercel.app`.
> No scheme, no path, no slash. This field breaks more setups than anything else here.

Then each of you: sign in → Settings → **Connect Strava**. Leave every
permission box ticked; the callback rejects the connection without
`activity:read_all`.

## 5. Strava webhook — budget an hour, hope for ten minutes

```bash
npm run strava:subscribe create
```

Strava immediately GETs `/api/strava/webhook` to verify. If that fails:

| Message | Cause |
|---|---|
| callback url not verifiable | not deployed yet, or `APP_URL` wrong |
| already exists | one subscription per app — list, delete, recreate |
| 403 on verification | `STRAVA_VERIFY_TOKEN` differs between env and command |

```bash
npm run strava:subscribe                              # list
npx tsx scripts/subscribe-webhook.ts delete <id>      # remove
```

Test it properly: finish a run, watch it appear.

## 6. Backfill

```bash
npx tsx scripts/backfill-strava.ts you@example.com
npx tsx scripts/backfill-strava.ts her@example.com
```

Every activity Strava holds, paced under the rate limit. Safe to re-run.


## 7. Runna

Runna app → Profile → Sync to calendar → copy the subscription URL → paste it
into Settings. Swap `webcal://` for `https://` if it isn't done for you.
The hourly cron mirrors future runs in and never touches ones you've moved.

## 8. intervals.icu → watch

1. intervals.icu → Settings → Developer → athlete ID + API key → paste into Settings.
2. intervals.icu → Connections → Garmin → tick **Upload planned workouts**.

Programmed runs then reach Garmin Connect and sync to the watch. Note: write
recoveries as time or distance — rest-to-heart-rate degrades to a plain timer
on Garmin.

## 9. Install on both phones

Open the URL in Safari or Chrome → Share → **Add to Home Screen**. That's the
"download": full screen, own icon, no App Store.

---

## Verifying it works, in order

1. Log in with each code → two rows in `users`.
2. Connect Strava → row in `oauth_accounts`.
3. Backfill → rows in `activities`.
4. Add a session for today, finish a run → it pairs and the rail fills.
5. Skip a session with "tired" twice → next week's template volume drops.

## What's deliberately unfinished

- **Auth is two codes in env vars.** Fine behind a private URL for two people.
- **Tokens are stored unencrypted.** Encrypt before anyone else touches this.
- **`plan_templates` has no UI and no route.** The engine that reads it works
  and is tested; a template has to be inserted by hand for now.
- **An unplanned activity can't be paired to a session by hand.** It shows on
  the day marked "off plan"; the one-tap re-pair from the brief isn't built.
- **Zone 2 minutes** are approximated from average HR per activity, not from
  HR streams. Good enough for a weekly challenge, wrong for training analysis.
- **No push notifications.** The service worker is offline-shell only.
