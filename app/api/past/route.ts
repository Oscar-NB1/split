import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { route } from "@/lib/http";

/** Everything logged, newest first, grouped by month by the client. */
export const GET = route(async (req: NextRequest) => {
  const me = await requireUser();
  const p = new URL(req.url).searchParams;
  const mine = p.get("who") !== "them";
  const kind = p.get("kind");

  const rows = await sql`
    select a.id, a.name, a.sport_type, a.local_date::text as local_date,
           a.start_time, a.moving_seconds, a.distance_m, a.avg_hr, a.max_hr,
           a.avg_speed_ms, u.display_name,
           (a.detail_fetched_at is not null) as has_detail
      from activities a
      join users u on u.id = a.user_id
     where (${mine} = true and a.user_id = ${me.id}
            or ${mine} = false and a.user_id <> ${me.id})
       ${kind ? sql`and a.sport_type = ${kind}` : sql``}
     order by a.start_time desc
     limit 400
  `;

  // The filter list is built from what is actually there, so a sport nobody
  // does never appears as an empty filter.
  const kinds = await sql<{ sport_type: string; n: number }[]>`
    select sport_type, count(*)::int as n from activities
     where (${mine} = true and user_id = ${me.id}
            or ${mine} = false and user_id <> ${me.id})
     group by sport_type order by count(*) desc
  `;

  return NextResponse.json({
    activities: rows.map((r) => ({
      ...r,
      distance_m: r.distance_m == null ? null : Number(r.distance_m),
      avg_hr: r.avg_hr == null ? null : Number(r.avg_hr),
      max_hr: r.max_hr == null ? null : Number(r.max_hr),
      avg_speed_ms: r.avg_speed_ms == null ? null : Number(r.avg_speed_ms),
    })),
    kinds,
  });
});
