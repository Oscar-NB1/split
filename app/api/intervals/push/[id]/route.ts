import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { badRequest, notFound, route } from "@/lib/http";
import { isUuid } from "@/lib/plan";
import { pushSession } from "@/lib/intervals";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Send one session to the watch, on demand.
 *
 * The hourly cron already pushes everything in the next ten days, so this is not
 * the only path — it exists because a session you have just edited, or one you
 * want on the watch *now*, should not wait up to an hour.
 *
 * pushSession is a PUT-then-POST-on-404 against the intervals.icu event this
 * session already owns, so pressing it twice updates one workout rather than
 * creating a second.
 */
export const POST = route(async (_req: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) throw notFound("No such session.");
  try {
    // returns the intervals.icu event id, or null when the session is not a
    // structured run — only those reach the watch
    const eventId = await pushSession(id);
    return NextResponse.json(
      eventId
        ? { ok: true, event_id: eventId }
        : { ok: false, error: "Only structured runs can be sent to the watch." },
      eventId ? undefined : { status: 400 },
    );
  } catch (e) {
    // the common case is no intervals.icu key stored, which is a setup problem
    // rather than a bug — say which
    const msg = String(e instanceof Error ? e.message : e);
    throw badRequest(
      /key|not connected|401|403/i.test(msg)
        ? "intervals.icu isn't connected. Add your API key in Settings."
        : `Couldn't send it: ${msg.slice(0, 120)}`,
    );
  }
});
