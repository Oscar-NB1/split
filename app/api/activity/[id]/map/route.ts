import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { notFound, route } from "@/lib/http";
import { isUuid } from "@/lib/plan";
import { decodePolyline } from "@/lib/analysis";
import { staticMapUrl } from "@/lib/map";

type Ctx = { params: Promise<{ id: string }> };

/** The two athlete colours from globals.css, so the route matches its owner. */
const COLOUR = { a: "E8A13A", b: "45B6A6" };

/**
 * The route as a rendered PNG, proxied.
 *
 * Proxied rather than linked directly from the page for one reason: the Mapbox
 * token stays on the server. A `pk.` token in an <img src> is readable by anyone
 * who views source, and while Mapbox public tokens are designed to be public,
 * there is no reason to publish one for a two-person private app.
 *
 * Cached `private` rather than `public`: the line colour depends on who is
 * looking (their own activities are amber, the other athlete's teal), so a
 * shared CDN must not serve one viewer's copy to the other.
 */
export const GET = route(async (_req: Request, { params }: Ctx) => {
  const me = await requireUser();
  const { id } = await params;
  if (!isUuid(id)) throw notFound("No such activity.");

  const [row] = await sql<{ user_id: string; polyline: string | null }[]>`
    select user_id, raw #>> '{map,summary_polyline}' as polyline
      from activities where id = ${id} limit 1
  `;
  if (!row?.polyline) throw notFound("No route recorded for this activity.");

  const url = staticMapUrl(
    decodePolyline(row.polyline),
    row.user_id === me.id ? COLOUR.a : COLOUR.b,
  );
  // no token configured: the client falls back to drawing the outline itself
  if (!url) throw notFound("No basemap configured.");

  const upstream = await fetch(url, { cache: "no-store" });
  if (!upstream.ok) {
    // surfaced as a 502 so the difference between "no route" and "Mapbox said
    // no" is visible in the log rather than both looking like a missing map
    console.error("mapbox", upstream.status, await upstream.text().catch(() => ""));
    return NextResponse.json({ error: "Basemap unavailable." }, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "image/png",
      // a recorded route never changes
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
});
