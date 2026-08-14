import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { redirectingRoute } from "@/lib/http";
import { authorizeUrl } from "@/lib/strava";

export const GET = redirectingRoute(async () => {
  const user = await requireUser();
  // state carries the user id so the callback knows who came back
  return NextResponse.redirect(authorizeUrl(user.id));
});
