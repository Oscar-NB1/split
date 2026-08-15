import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { badRequest, route } from "@/lib/http";
import {
  isResultUrl, parseHyroxResult, resultIdOf, validationError,
} from "@/lib/hyrox";

/** Every race in the household, splits included, newest first. */
export const GET = route(async () => {
  await requireUser();

  const races = await sql`
    select r.*, r.race_date::text as race_date, u.display_name,
           a.name as activity_name, a.local_date::text as activity_date,
           a.moving_seconds as activity_seconds
      from races r
      join users u on u.id = r.user_id
      left join activities a on a.id = r.activity_id
     order by coalesce(r.race_date, r.imported_at::date) desc
  `;
  const splits = races.length
    ? await sql`
        select race_id, ord, label, kind, seconds, place
          from race_splits where race_id in ${sql(races.map((r) => r.id as string))}
         order by ord
      `
    : [];

  return NextResponse.json({
    races: races.map((r) => ({
      ...r,
      splits: splits.filter((s) => s.race_id === r.id),
    })),
  });
});

/**
 * Import a race by pasting the result URL.
 *
 * The page is fetched server-side, so the host is pinned to results.hyrox.com —
 * fetching an arbitrary user-supplied URL from the server is a request-forgery
 * hole, and the interesting targets (cloud metadata endpoints, internal
 * services) are exactly the ones a browser could not reach itself.
 */
export const POST = route(async (req: NextRequest) => {
  const me = await requireUser();
  const body = await req.json();
  const url = String(body?.url ?? "").trim();

  if (!url) throw badRequest("Paste the link to your result page.");
  if (!isResultUrl(url)) {
    throw badRequest(
      "That is not a results.hyrox.com link. Open your result on results.hyrox.com and copy the address bar.",
    );
  }
  if (!resultIdOf(url)) {
    throw badRequest(
      "That link has no result id — it looks like a results list rather than one athlete's result. Click your own name first.",
    );
  }

  let html: string;
  try {
    const res = await fetch(url, {
      // A browser user-agent, and it has to be: results.hyrox.com answers 403 to
      // anything that identifies itself as a script. Verified both ways — an
      // honest "split/1.0" UA is refused, this one is served. Do not "tidy" this
      // into something more truthful without re-checking, or every import 403s.
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-GB,en;q=0.9",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    html = await res.text();
  } catch (e) {
    throw badRequest(`Could not read that page (${String(e instanceof Error ? e.message : e)}).`);
  }

  const parsed = parseHyroxResult(html, url);
  // A parse failure must say so rather than storing a race with no splits —
  // this is HTML parsing, and the whole point is that it breaks loudly.
  const invalid = validationError(parsed);
  if (invalid) throw badRequest(invalid);

  // Which recorded activity is this race? The result page has no date, so the
  // link is what supplies one. Matched on duration among the athlete's own
  // Hyrox-named activities: a watch runs before the gun and after the line, so
  // it reads long — the Mechelen entry is 3758s against an official 3645s.
  //
  // The window is asymmetric on purpose. A watch is started before the gun and
  // stopped after the line, so it reads LONGER than the chip time — never
  // meaningfully shorter, because you cannot finish faster than you finished.
  // A symmetric +/-25% band let a 52:00 race match a 46:14 session, which is a
  // confidently wrong link; those are worse than no link at all.
  const [match] = await sql<{ id: string; local_date: string }[]>`
    select id, local_date::text as local_date
      from activities
     where user_id = ${me.id}
       and name ilike '%hyrox%'
       and moving_seconds is not null
       and ${parsed.overall_seconds}::int is not null
       and moving_seconds >= ${parsed.overall_seconds}::int - 60
       and moving_seconds <= ${parsed.overall_seconds}::int * 1.15
     order by abs(moving_seconds - ${parsed.overall_seconds}::int)
     limit 1
  `;

  const [race] = await sql<{ id: string }[]>`
    insert into races (
      user_id, activity_id, source_url, external_id, athlete_name, bib,
      event_name, division, age_group, race_date, overall_seconds,
      rank_overall, rank_age_group
    ) values (
      ${me.id}, ${match?.id ?? null}, ${url}, ${parsed.external_id!},
      ${parsed.athlete_name}, ${parsed.bib}, ${parsed.event_name},
      ${parsed.division}, ${parsed.age_group}, ${match?.local_date ?? null},
      ${parsed.overall_seconds}, ${parsed.rank_overall}, ${parsed.rank_age_group}
    )
    on conflict (user_id, external_id) do update set
      activity_id     = excluded.activity_id,
      source_url      = excluded.source_url,
      athlete_name    = excluded.athlete_name,
      bib             = excluded.bib,
      event_name      = excluded.event_name,
      division        = excluded.division,
      age_group       = excluded.age_group,
      race_date       = excluded.race_date,
      overall_seconds = excluded.overall_seconds,
      rank_overall    = excluded.rank_overall,
      rank_age_group  = excluded.rank_age_group,
      imported_at     = now()
    returning id
  `;

  // Replaced wholesale rather than upserted row by row: a re-import of a
  // corrected result should not leave orphan splits from the old version.
  await sql`delete from race_splits where race_id = ${race.id}`;
  for (const s of parsed.splits) {
    await sql`
      insert into race_splits (race_id, ord, label, kind, seconds, place)
      values (${race.id}, ${s.order}, ${s.label}, ${s.kind}, ${s.seconds}, ${s.place})
    `;
  }

  return NextResponse.json({
    id: race.id,
    event_name: parsed.event_name,
    division: parsed.division,
    overall_seconds: parsed.overall_seconds,
    splits: parsed.splits.length,
    linked_activity: match?.id ?? null,
    race_date: match?.local_date ?? null,
  });
});
