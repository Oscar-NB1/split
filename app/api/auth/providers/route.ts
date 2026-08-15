import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { availableProviders } from "@/lib/oauth";

/**
 * Which ways in exist. Public, because the screens that need it are the ones
 * nobody is signed in on.
 *
 * A sign-in button that cannot work is worse than one that is not there — it
 * fails after the tap, on someone's first impression of the app. The welcome
 * and sign-up screens render from this rather than from a hard-coded pair.
 */
export const GET = route(async () =>
  NextResponse.json({
    providers: availableProviders().map((id) => ({
      id,
      label: id === "google" ? "Google" : "Strava",
      /** Strava is the one that also connects the data, and says so. */
      grants: id === "strava"
        ? "Signs you in and connects your activities in one step."
        : "Signs you in. Strava is connected afterwards, from your profile.",
      start: `/api/auth/oauth/${id}/start`,
    })),
  }));
