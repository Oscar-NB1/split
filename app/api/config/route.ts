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
        : "Not found under MAPBOX_TOKEN, MAPBOX_PUBLIC_KEY, MAPBOX_ACCESS_TOKEN or NEXT_PUBLIC_MAPBOX_TOKEN. Routes still draw as an outline.",
    },
    weather: {
      // No key, by design. Worth stating so nobody goes looking for one.
      configured: true,
      env: null,
      note: "Open-Meteo needs no key. Forecast to 16 days, climate averages beyond it.",
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
