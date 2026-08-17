import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { route } from "@/lib/http";
import { mapboxTokenName } from "@/lib/map";

/**
 * What this deployment has configured, by name, never by value.
 *
 * Every integration in this app fails the same way when its key is missing or named
 * something else: silently and gracefully. The map falls back to drawing its own
 * outline, intervals.icu says it is not connected, the weather card does not appear.
 * That is the right behaviour for an athlete and the wrong behaviour for whoever is
 * trying to work out why a feature they just configured is not doing anything —
 * there is no way to tell "not set up" from "set up under a name the code does not
 * read" from outside.
 *
 * So: one authenticated endpoint that says which things are live, which environment
 * variable each was found under, and nothing else. Never a value, never a prefix of
 * a value — a token is either configured or it is not, and a diagnostics endpoint
 * that leaks the first eight characters of a secret is a diagnostics endpoint that
 * should not exist.
 *
 * Behind `requireUser` because the set of integrations an app has is itself
 * information, and this is a private app for two people.
 */
export const GET = route(async () => {
  await requireUser();

  const mapbox = mapboxTokenName();
  return NextResponse.json({
    mapbox: {
      configured: Boolean(mapbox),
      /*
       * The name it was found under, which is the whole point. `MAPBOX_TOKEN` is
       * what the code was written for, but a public key gets pasted into a dashboard
       * under whatever name is in the operator's head, and four are now accepted.
       */
      env: mapbox,
      note: mapbox
        ? "Recorded routes render as a Mapbox static image, clipped 200 m at each end."
        : "Not found under any name this app reads. Routes still draw as an outline.",
      /*
       * Every environment variable whose name mentions Mapbox, so "which name did I
       * use" is a fact rather than a guessing game. Names only — the value of a
       * secret must never come back from an endpoint, and the whole reason this
       * exists is that a token under an unread name is indistinguishable from no
       * token at all.
       */
      names_present: Object.keys(process.env).filter((k) => /mapbox/i.test(k)).sort(),
      names_read: ["MAPBOX_TOKEN", "MAPBOX_PUBLIC_KEY", "MAPBOX_ACCESS_TOKEN",
        "NEXT_PUBLIC_MAPBOX_TOKEN"],
      /*
       * A secret token is refused rather than used: this URL is fetched by the
       * athlete's browser, so an `sk.` key would be handed to the client on every
       * map. Reported so a rejected token does not read as a missing one.
       */
      rejected_secret: Object.keys(process.env)
        .some((k) => /mapbox/i.test(k) && (process.env[k] ?? "").startsWith("sk.")),
    },
    weather: {
      // No key, by design. Worth stating so nobody goes looking for one.
      configured: true,
      env: null,
      note: "Open-Meteo needs no key. Forecast to 15 days, and nothing beyond it.",
    },
    /*
     * The model that reads "what changed this week". Configured or not, never the key.
     *
     * Missing is a working state, not a broken one: the rule-based parser takes over and the
     * athlete sees no difference except on the sentences it cannot follow. Reported because
     * "my rebuild understood less than I expected" and "the key is not set" look identical
     * from the outside, which is the same problem the Mapbox block exists to solve.
     */
    model: {
      configured: Boolean(process.env.ANTHROPIC_API_KEY),
      env: process.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY" : null,
      note: process.env.ANTHROPIC_API_KEY
        ? "Rebuild my week reads your sentence with claude-opus-5, falling back to rules."
        : "Not set. Rebuild my week reads your sentence with rules only — which is tested, "
          + "just less forgiving of self-correcting speech.",
    },
    strava: {
      configured: Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET),
      env: "STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET",
      note: "Activity import, and the laps every pace target is checked against.",
    },
    push: {
      // The names lib/push.ts actually reads, not the ones a guess would produce.
      configured: Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
        && process.env.VAPID_PRIVATE_KEY),
      env: "NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY",
      note: "Web push for session reminders.",
    },
  });
});
