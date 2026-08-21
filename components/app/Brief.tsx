"use client";
import { useCallback, useEffect, useState } from "react";
import { fmt } from "@/lib/dates";
import { kindColour, kindLabel } from "@/lib/coach";
import type { Forecast } from "@/lib/weather";
import { warmupFor } from "@/lib/warmup";
import { classGuideFor } from "@/lib/class-guide";
import { humanDose, prescribedKm, repeatedReps, type StepGroup } from "@/lib/prescription";
import { prescribedPace } from "@/lib/signals";
import Thread from "./Thread";

export type SessionDetail = {
  session: {
    id: string; user_id: string; planned_date: string; title: string; kind: string;
    planned_minutes: number | null; target: string | null; coach_note: string | null;
    status: string; actual_minutes: number | null; significance: string | null;
    slot: string | null; activity_id: string | null; display_name: string;
    effort_points: number | null; purpose?: string | null;
    /** who programmed it — the note it carries is a message from them */
    author_name?: string | null; author_avatar?: string | null;
  };
  steps: StepGroup[];
  reps: number;
  lifts: {
    name: string; sets: number; reps: number; load: number | null;
    /** seconds between sets, where the plan prescribed them */
    rest: number | null;
  }[];
  /**
   * What each lift is, what effort to take it to, and where its number came from.
   *
   * Sent with the session since the loads were pre-filled and never displayed, so the
   * screen showed an estimated weight with nothing to say it was an estimate — which is
   * the one thing an athlete needs to know about a number nobody has earned yet.
   */
  guidance?: {
    name: string;
    what: string | null; how: string | null;
    rpe: number | null; rpe_means: string | null;
    source: "your last session" | "your bodyweight" | null;
    estimated_load: number | null;
    progression: { verdict: string; why: string } | null;
    note: string | null;
  }[];
  /**
   * Recorded workouts this session could be.
   *
   * Sent only when nothing is attached. The button here used to say "Link Strava" and do
   * nothing at all; these are the athlete's own unattached activities either side of the
   * day, so it can offer them instead of naming a service.
   */
  pairable?: {
    id: string; name: string | null; sport_type: string | null; local_date: string;
    moving_seconds: number | null; distance_m: number | null; avg_hr: number | null;
  }[];
  /** so the screen can ask for a bodyweight rather than showing empty boxes */
  needs_bodyweight?: boolean;
  sets: SetRow[];
  feedback: { rpe: number | null; length_feel: string | null; note: string | null } | null;
  comments: { id: string; body: string; created_at: string; author_id: string; display_name: string }[];
  activity: { id: string; name: string; moving_seconds: number; distance_m: string; avg_hr: string } | null;
};
export type SetRow = {
  id: string; exercise: string; ord: number; set_no: number;
  prescribed_load: number | null; prescribed_reps: number | null;
  load_kg: number | null; reps: number | null; done: boolean; note: string | null;
};

/** Everything both session screens need to load and write. */
export function useSession(id: string) {
  const [d, setD] = useState<SessionDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/session/${id}`);
    if (r.status === 401) { location.href = "/"; return; }
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Couldn't load it."); return; }
    setD(await r.json());
  }, [id]);
  useEffect(() => { load(); }, [load]);

  /**
   * PATCH the session, and hand back what the server said.
   *
   * It returned a bare boolean, which was enough while every write was
   * fire-and-forget. The length report is not: the server decides whether two
   * matching answers have changed the next session, and the athlete has to be told.
   */
  const send = useCallback<Send>(async (body) => {
    const r = await fetch(`/api/session/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error ?? "That didn't save."); return null; }
    return j as Record<string, unknown>;
  }, [id]);

  return { d, setD, err, load, send };
}

/**
 * The forecast for the day this session is on.
 *
 * Loaded separately from the session rather than joined into it, for two reasons: it
 * comes from a third party that can be slow or down, and a session screen must open
 * instantly whether or not the weather answered. A null forecast renders nothing at
 * all — no skeleton, no "unavailable" — because a training app has nothing useful to
 * say about the weather it could not fetch.
 */
function useForecast(date: string | null | undefined) {
  const [f, setF] = useState<Forecast | null>(null);
  useEffect(() => {
    if (!date) return;
    let live = true;
    fetch(`/api/weather?date=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live) setF(j?.forecast ?? null); })
      .catch(() => {});
    return () => { live = false; };
  }, [date]);
  return f;
}

/**
 * What the day looks like, drawn rather than typed.
 *
 * These were text glyphs — ☀ ❄ ☂ ≋ — and at least one of them (U+224B, the wave)
 * is missing from Inter and from most system fallbacks, so the icon rendered as an
 * empty box or nothing at all. Every other icon in this app is an inline SVG for
 * exactly that reason; the weather card had no business being the exception.
 */
function WeatherMark({ verdict, colour }: { verdict: string; colour: string }) {
  const common = {
    width: 20, height: 20, viewBox: "0 0 24 24", fill: "none",
    stroke: colour, strokeWidth: 1.9,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (verdict) {
    case "hot":
    case "warm":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
        </svg>
      );
    case "cold":
      return (
        <svg {...common}>
          <path d="M12 2v20M4 7l16 10M20 7L4 17" />
        </svg>
      );
    case "wet":
      return (
        <svg {...common}>
          <path d="M17.5 15.5a4 4 0 0 0-1.2-7.8 5.5 5.5 0 0 0-10.5 1.6A3.5 3.5 0 0 0 6 15.5z" />
          <path d="M8 19l-.6 1.6M12 19l-.6 1.6M16 19l-.6 1.6" />
        </svg>
      );
    case "windy":
      return (
        <svg {...common}>
          <path d="M3 8h11a3 3 0 1 0-3-3" />
          <path d="M3 13h8" />
          <path d="M3 18h13a3 3 0 1 1-3 3" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.2" />
        </svg>
      );
  }
}

/**
 * What a session write hands back: the server's own answer, or null if it failed.
 *
 * Not a boolean. The server decides things the screen cannot — whether two matching
 * length reports have changed the next session — and it has to be able to say so.
 */
export type Send = (b: Record<string, unknown>) => Promise<Record<string, unknown> | null>;

const TEAL = "#0A8FB0";
const INK55 = "var(--ink-55)";
/** "4:10/km" back to seconds, so a prescribed pace can be restated as a belt speed. */
const secondsOf = (pace: string): number | null => {
  const m = /^(\d{1,2}):([0-5]\d)/.exec(pace.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * A prescribed pace, in the units of the mode.
 *
 * A treadmill is set in kilometres per hour, so a screen that prints 4:10 /km in
 * treadmill mode is asking the athlete to do the arithmetic on the belt. The
 * prescription carries minutes per kilometre; this is where it becomes a speed.
 */
const sayPace = (pace: string, mode: string): string => {
  const sec = secondsOf(pace);
  if (!sec) return pace;
  // A range — "5:45-6:06/km" — converts at both ends.
  const range = /^(\d{1,2}:[0-5]\d)\s*[-–]\s*(\d{1,2}:[0-5]\d)/.exec(pace.trim());
  if (range) {
    const a = secondsOf(range[1])!, b = secondsOf(range[2])!;
    return mode === "Treadmill"
      ? `${say(b, mode)} to ${say(a, mode)}`
      : `${range[1]} to ${range[2]} /km`;
  }
  return say(sec, mode);
};

const say = (sec: number, mode: string) =>
  mode === "Treadmill"
    ? `${(3600 / sec).toFixed(1)} kph`
    : `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, "0")} /km`;

/**
 * A band between two paces, written in the order the mode reads it.
 *
 * Slower is a bigger number in minutes per kilometre and a smaller one in km/h, so a
 * band built as "easy, to easier still" comes out descending on a treadmill — 11.3 kph
 * to 10.3 kph, which reads as a mistake rather than a range. Same rule the prescribed
 * ranges already follow; this is for the ones derived from the session's pace.
 */
const band = (fastSec: number, slowSec: number, mode: string) =>
  mode === "Treadmill"
    ? `${say(slowSec, mode)} to ${say(fastSec, mode)}`
    : `${say(fastSec, mode)} to ${say(slowSec, mode)}`;

type Item = {
  main: string; sub: string; work: boolean;
  /**
   * What this step is done on, where it is not running.
   *
   * The right-hand column said "Run" on every row, which on a Hyrox session put it
   * beside twenty-five wall balls. A station is not a run and the row should not
   * claim it is.
   */
  tag?: string;
};
type Group = {
  label: string; color: string; items: Item[]; note: string;
  /** how many times the pair repeats; 1 for a block that runs once */
  repeat: number;
  /** the whole set in one line, above the two rows it is made of */
  summary: string;
};

/** What to call the station in the modality column, in three letters or so. */
const stationTag = (label: string): string => {
  const l = label.toLowerCase();
  if (/ski/.test(l)) return "Ski";
  if (/row/.test(l)) return "Row";
  if (/sled/.test(l)) return "Sled";
  if (/carry/.test(l)) return "Carry";
  if (/lunge/.test(l)) return "Lunge";
  if (/burpee|jump/.test(l)) return "BBJ";
  if (/wall/.test(l)) return "WB";
  if (/spin|walk/.test(l)) return "Easy";
  return "Station";
};

/**
 * The prescription as the design renders it: every rep its own numbered row.
 *
 * The parser groups a session as `5 × (work, recovery)` because that is how
 * intervals.icu writes it and how it reaches the watch. The screen shows the
 * reps expanded — six rows, numbered 2 to 7 — because that is what you read
 * standing on a track, one line per thing you are about to do.
 */
function groupsFor(
  steps: StepGroup[], prescribed: number | null, mode: string, kind: string,
): Group[] {
  const out: Group[] = [];
  const cap = prescribed
    ? mode === "Treadmill"
      ? `Set the belt to ${say(prescribed, mode)} and leave it. The alarm equivalent is ${say(prescribed - 3, mode)} — do not touch the speed up.`
      : `Watch alert at ${say(prescribed - 3, "Outdoor")} — prescribed minus 3 s. Not a target, an alarm.`
    : "";

  for (const g of steps) {
    const isWarm = g.label === "Warm-up";
    const isCool = g.label === "Cool-down";

    if (isWarm || isCool) {
      const it = g.items[0];
      out.push({
        label: isWarm ? "Warm-up" : "Cool down", color: INK55, note: "",
        repeat: 1, summary: "",
        items: [{
          main: `${humanDose(it?.dose ?? "")} ${isWarm ? "conversational" : "easy"}`.trim(),
          sub: it?.pace
            ? `${sayPace(it.pace, mode)}${isWarm ? " — no faster" : " or slower"}`
            : prescribed
              ? isWarm
                ? `${band(prescribed + 60, prescribed + 90, mode)} — no faster`
                : `${say(prescribed + 90, mode)} or slower`
              : isWarm ? "Conversational" : "or slower",
          work: false,
        }],
      });
      continue;
    }

    /*
     * A Hyrox session is a list, not a rep and a count.
     *
     * Everything else in the app is a rep repeated: eight minutes at a pace, six
     * times. A Hyrox session is eight different things in a fixed order — four
     * hundred metres, then wall balls, then four hundred metres, then the ski — so
     * summarising it as "1 × 400 m" and showing the first row would throw away every
     * station in it. Each step gets its own numbered row, in order, and there is
     * nothing to repeat.
     */
    const stations = g.items.filter((i) => !i.rest && !i.pace && !/^\d+(\.\d+)?km/.test(i.dose));
    if (stations.length >= 1 && g.items.filter((i) => !i.rest).length >= 2) {
      /*
       * Rounds, where the prescription says rounds.
       *
       * A self-written Hyrox session is a short block repeated, so the count matters as
       * much as the contents — "× 3" above the list, and the rest between rounds at the
       * bottom of it, which the parser already carries as the group's rest step.
       */
      out.push({
        label: g.repeat > 1 ? "The round" : "The session",
        color: kindColour(kind), repeat: g.repeat,
        note: g.repeat > 1
          ? "Work down the round in order, then go again. Time your transitions — the roxzone is where a race quietly goes."
          : "Work down the list in order. Time your transitions — the roxzone is where a race quietly goes.",
        summary: g.repeat > 1
          ? `${g.items.filter((i) => !i.rest).length} things to do, ${g.repeat} rounds`
          : `${g.items.filter((i) => !i.rest).length} things to do, in this order`,
        items: g.items.map((it) => ({
          // A station is a dose and a movement: "25 reps · Wall balls". A run keeps
          // its pace, because running off a station is the one thing being trained.
          main: it.pace
            ? `${humanDose(it.dose)} at ${sayPace(it.pace, mode)}`
            // A station has no pace, so its "25m" is metres — see humanDose.
            : `${humanDose(it.dose, "distance")} ${it.label}`.trim(),
          sub: it.rest ? "Recover, then go again." : "",
          work: !it.rest,
          tag: it.pace ? undefined : stationTag(it.label),
        })),
      });
      continue;
    }

    // the repeat block, expanded
    const work = g.items.find((i) => !i.rest);
    const rest = g.items.find((i) => i.rest);
    /*
     * The rep and its recovery are two rows, not one row with a caption.
     *
     * A watch executes them as separate steps, and an athlete reads them that way:
     * eight minutes at a pace, then a hundred and fifty seconds walking. Hiding the
     * recovery under the rep made a session that could not be sent anywhere.
     */
    /*
     * One pair and a count, not the pair written out six times.
     *
     * Six identical rows is six chances to lose your place, and it is not how the
     * session is executed or how a watch stores it: a rep, its recovery, and the
     * number of times round. The set is summarised above the pair so the whole
     * session is legible in one line.
     */
    const items: Item[] = [];
    for (let i = 0; i < 1; i++) {
      /*
       * The pace the prescription states, where it states one. The screen used to
       * derive it from the plan's easy pace, which meant it could differ from what
       * a watch would be sent — and could appear on a step that has no pace at all.
       */
      items.push({
        main: work?.pace
          ? `${humanDose(work.dose)} at ${sayPace(work.pace, mode)}`
          : `${humanDose(work?.dose ?? "")}${prescribed ? ` at ${say(prescribed, mode)}` : ""}`,
        sub: "",
        work: true,
      });
      if (rest) {
        const walking = /walk/i.test(rest.label);
        items.push({
          main: `${humanDose(rest.dose)} ${walking ? "walking recovery" : "easy recovery"}`,
          // A jog recovery has a pace; a walk does not, and pretending otherwise
          // gives the watch a target nobody can hold.
          sub: walking
            ? "Walk it. No pace target."
            : rest.pace ? `${sayPace(rest.pace, mode)} or slower`
            : prescribed ? `${say(prescribed + 90, mode)} or slower` : "Easy.",
          work: false,
        });
      }
    }
    /*
     * The work block wears the session's own colour.
     *
     * It was teal for everything, so an interval session — the only red on every
     * other screen in the app — turned blue the moment you opened it. The colour is
     * how a week is read at a glance; it cannot mean one thing in the list and
     * another inside.
     */
    const restDose = rest ? humanDose(rest.dose) : "";
    out.push({
      label: "Session",
      color: kindColour(kind),
      items,
      note: cap,
      repeat: g.repeat,
      summary: [
        `${g.repeat} × ${humanDose(work?.dose ?? "")}`,
        work?.pace ? `at ${sayPace(work.pace, mode)}` : null,
        rest ? `${restDose} rest between` : null,
      ].filter(Boolean).join(" "),
    });
  }
  return out;
}

export default function Brief({
  id, meId, openActivity, onChanged, openStrategy,
}: {
  id: string; meId: string; openActivity: (a: string) => void; onChanged: () => void;
  /** the race builder, which a race session is the one place anybody wants it from */
  openStrategy?: () => void;
}) {
  const { d, err, load, send } = useSession(id);
  const [warmOpen, setWarmOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [mode, setMode] = useState("Outdoor");
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const weather = useForecast(d?.session.planned_date);

  if (err) return <div className="pad"><div className="errbox" role="alert">{err}</div></div>;
  if (!d) return <div className="pad"><p className="empty">Loading…</p></div>;

  const s = d.session;
  const done = s.status === "done" || s.status === "adjusted";
  const noteLines = s.coach_note?.split("\n").filter(Boolean) ?? [];
  const why = noteLines[0];
  const pace = prescribedPace(s.title);
  const pairable = d.pairable ?? [];
  /*
   * A Hyrox session's toggle is self-workout against class, not outdoor against
   * treadmill: nobody does compromised running on a treadmill, and everybody has to
   * choose between writing it and booking it.
   */
  const guide = classGuideFor(s.kind, s.title);
  const MODES = guide ? ["Self-workout", "Class"] : ["Outdoor", "Treadmill"];
  /*
   * A mode that belongs to the other kind of session shows neither button as
   * selected, which happens the moment somebody opens a Hyrox session after a run.
   * The first option is the default for whichever pair applies.
   */
  const active = MODES.includes(mode) ? mode : MODES[0];
  const asClass = guide != null && active === "Class";
  const groups = groupsFor(d.steps, pace, active, s.kind);
  const accent = kindColour(s.kind);

  async function skip() {
    setBusy(true);
    await fetch(`/api/sessions/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "skip", reason: "no_time" }),
    });
    setBusy(false);
    await load(); onChanged();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{
        padding: "20px 18px 20px",
        background: `linear-gradient(165deg, color-mix(in srgb, ${accent} 14%, var(--off)) 0%, var(--off) 80%)`,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em",
          textTransform: "uppercase", color: "var(--teal)" }}>
          {fmt(s.planned_date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
          {s.slot ? ` · ${s.slot}` : ""}
          {s.user_id !== meId ? ` · ${s.display_name}` : ""}
        </div>
        {/*
          * The purpose is the headline. "3 × 8 min" tells an athlete what they are about
          * to do and nothing about why — and the prescription is a line away, where it is
          * still exactly as checkable.
          */}
        <div style={{ fontFamily: "var(--display)", fontSize: 27, fontWeight: 700,
          lineHeight: 1.1, letterSpacing: "-.02em", marginTop: 8 }}>
          {s.purpose || s.title}
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-55)", marginTop: 6 }}>
          {/* The kind, in the app's words. It said "Hyrox" for anything that was
              not a run or a lift, so an interval session read as Hyrox. */}
          {/*
            * Reps where the session repeats something, distance where it does not.
            *
            * `d.reps` counts every work step, so an 8 km easy run with six strides on the end
            * read as "7 reps" and an 18 km long run with three tempo blocks as "5 reps" — a
            * number that describes neither session. A continuous run has no reps; it has a
            * distance, and that is the thing worth putting beside its name.
            */}
          {[s.purpose ? s.title : null, kindLabel(s.kind),
            repeatedReps(s.target) > 0 ? `${repeatedReps(s.target)} × reps`
              : prescribedKm(s.target) > 0 ? `${prescribedKm(s.target)} km`
              : null].filter(Boolean).join(" · ")}
        </div>

        {s.planned_minutes && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 18 }}>
            <span style={{ fontFamily: "var(--display)", fontSize: 25, fontWeight: 700 }}>
              {s.planned_minutes} min
            </span>
            <span style={{ fontSize: 11, color: "var(--ink-55)" }}>
              {/*
                * In the units of the mode, like every other pace on the screen.
                *
                * This one was pinned to Outdoor, so switching to Treadmill converted every
                * step of the session to a belt speed and left the prescribed pace at the top
                * in minutes per kilometre — the one number an athlete reads first, and the
                * only one still asking them to do the arithmetic.
                */}
              {pace ? `at ${say(pace, active)} prescribed` : ""}
            </span>
          </div>
        )}
        <div style={{ fontSize: 11, color: "var(--ink-40)", marginTop: 8 }}>
          From your plan · Strava matches it automatically
        </div>
      </div>

      {why && (
        <div style={{ padding: "16px 18px 0" }}>
          {/*
            * A message from whoever programmed the week, and it looks like one.
            *
            * It was an information icon over "WHY THIS SESSION MATTERS" and three
            * sentences — a block of text arriving above the session, at the moment an
            * athlete is least inclined to read a block of text. A face, a name and two
            * sentences is a note from a coach, which is what it actually is.
            */}
          <div style={{ background: "var(--paper)", border: "1px solid var(--line)",
            borderRadius: "var(--r-card)", padding: "14px 16px",
            display: "flex", gap: 11, alignItems: "flex-start" }}>
            {s.author_avatar
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={s.author_avatar} alt="" width={30} height={30}
                style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover",
                  flex: "none" }} />
              : <span style={{ width: 30, height: 30, borderRadius: "50%", flex: "none",
                background: "var(--teal)", color: "#fff", fontSize: 12, fontWeight: 800,
                display: "flex", alignItems: "center", justifyContent: "center" }}>
                {(s.author_name ?? "C").trim().charAt(0).toUpperCase()}
              </span>}
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em",
                textTransform: "uppercase", color: "var(--ink-40)" }}>
                {s.author_name ? `${s.author_name.split(" ")[0]} · your coach` : "Your coach"}
              </span>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--ink-70)" }}>{why}</div>
            </div>
          </div>
        </div>
      )}

      {weather && !done && (
        <div style={{ padding: "14px 18px 0" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start",
            background: weather.cost_s >= 6 ? "var(--gold-tint, #FBF3DE)" : "var(--paper)",
            border: `1px solid ${weather.cost_s >= 6 ? "#E8C051" : "var(--line)"}`,
            borderRadius: "var(--r-card)", padding: "13px 15px" }}>
            <span style={{ display: "flex", flex: "none", paddingTop: 1 }}>
              <WeatherMark verdict={weather.verdict}
                colour={weather.cost_s >= 6 ? "#B08A1E" : "var(--ink-40)"} />
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em",
                textTransform: "uppercase", color: "var(--ink-55)" }}>
                {/* The numbers, so the advice underneath is checkable. */}
                {Math.round(weather.temp_c)}°C · {weather.humidity}% · {weather.wind_kmh} km/h
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-70)" }}>
                {weather.headline}
              </div>
              {weather.cost_s >= 6 && (
                <div style={{ fontSize: 11, color: "var(--ink-55)" }}>
                  {/* Said out loud, because an athlete who misses a target in a
                      heatwave should know the plan already knows why. */}
                  Missing the target in this does not count against you — the plan
                  discounts conditions like these before it recommends anything.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", padding: "14px 10px", margin: "14px 18px 0",
        background: "var(--paper)", border: "1px solid var(--line)", borderRadius: "var(--r-card)" }}>
        <Action label="Warm-up" active={warmOpen} onClick={() => setWarmOpen(!warmOpen)}>
          <circle cx="12" cy="4.5" r="2" /><path d="M8 21l2.5-5 3.5-2-1-4" />
          <path d="M6 11l3-2h4l4 3" /><path d="M15 21l-1.5-4" />
        </Action>
        {/*
          * Attached: open it. Not attached: offer the workouts it could be.
          *
          * This said "Link Strava" and its handler was `s.activity_id && openActivity(...)`
          * — dead in precisely the case the label promised, and the label named a service
          * rather than the thing you wanted, which is this session pointing at that workout.
          */}
        <Action label={s.activity_id ? "Open activity" : pairable.length ? "Link a workout" : "Nothing to link"}
          active={!!s.activity_id}
          onClick={() => (s.activity_id
            ? openActivity(s.activity_id)
            : pairable.length && setPicking(true))}>
          <path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1" />
          <path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />
        </Action>
        <Action label={s.status === "skipped" ? "Skipped" : "Skip"} danger onClick={skip}>
          <path d="M5 5l9 7-9 7z" /><path d="M19 5v14" />
        </Action>
      </div>

      {warmOpen && <WarmupCard kind={s.kind} title={s.title} onHide={() => setWarmOpen(false)} />}

      {/*
        * Which workout this was.
        *
        * Listed rather than searched: there are never many, and the athlete recognises
        * their own run by its time and distance faster than by any label we could write.
        * A day either side, because an evening session syncs after midnight.
        */}
      {picking && (
        <div style={{ margin: "14px 18px 0", padding: "14px 16px", background: "var(--paper)",
          border: "1px solid var(--line)", borderRadius: "var(--r-card)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
            marginBottom: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em",
              textTransform: "uppercase", color: INK55 }}>Which workout was this?</span>
            <button onClick={() => setPicking(false)}
              style={{ fontSize: 11, fontWeight: 700, color: INK55 }}>Close</button>
          </div>
          {pairable.map((a) => {
            const mins = Math.round(Number(a.moving_seconds ?? 0) / 60);
            const km = Number(a.distance_m ?? 0) / 1000;
            return (
              <button key={a.id} onClick={async () => {
                await send({ action: "pair", activity_id: a.id });
                setPicking(false);
                await load();
                onChanged();
              }} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start",
                gap: 2, width: "100%", textAlign: "left", padding: "9px 0",
                borderTop: "1px solid var(--line)", color: "var(--ink)" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{a.name || a.sport_type || "Workout"}</span>
                <span style={{ fontSize: 11, color: INK55 }}>
                  {[
                    fmt(a.local_date, { weekday: "short", day: "numeric", month: "short" }),
                    a.sport_type,
                    mins ? `${mins} min` : null,
                    km >= 0.1 ? `${km.toFixed(2)} km` : null,
                    a.avg_hr ? `${Math.round(Number(a.avg_hr))} bpm` : null,
                  ].filter(Boolean).join(" · ")}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/*
        * A race session leads to the race builder.
        *
        * The builder exists — every segment, the roxzone, the projection, and a push to
        * the watch — and there was no way to reach it from the one screen where an
        * athlete would look for it. A race day showed "Mark it done" and a feedback
        * form, as though the plan had nothing to say about the race it was built for.
        */}
      {s.kind === "race" && openStrategy && (
        <div style={{ padding: "16px 18px 0" }}>
          <button onClick={openStrategy} style={{
            width: "100%", textAlign: "left", background: "var(--navy)", color: "#fff",
            borderRadius: "var(--r-card)", padding: "15px 16px",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".1em",
                textTransform: "uppercase", color: "rgba(255,255,255,.6)" }}>
                Race builder
              </span>
              <span style={{ fontSize: 14, fontWeight: 700 }}>
                Set your splits, station by station
              </span>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,.7)", lineHeight: 1.45 }}>
                Eight runs, eight stations and the roxzone, built from your goal — then
                sent to your watch as a workout.
              </span>
            </span>
            <span aria-hidden="true" style={{ fontSize: 20, color: "var(--lime)" }}>›</span>
          </button>
        </div>
      )}

      {(groups.length > 0 || guide) && (
        <div style={{ padding: "20px 18px 8px", display: "flex", flexDirection: "column", gap: 12 }}>
          {/*
            * Two different questions, depending on the session.
            *
            * A run asks where you are running it, because a treadmill needs km/h. A
            * Hyrox session asks something else entirely: are you writing this session
            * yourself, or are you going to a class? The plan can say exactly what to do
            * in the first case and only what to look for in the second — and it used to
            * pretend it could do both, printing "1. Hyrox class, 2. 2 km running inside
            * it" as though that were a set of instructions.
            */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em",
              textTransform: "uppercase", color: "var(--ink-55)" }}>What to do</span>
            <div style={{ display: "flex", gap: 3, background: "var(--paper)",
              border: "1px solid var(--line)", borderRadius: "var(--r-pill)", padding: 3 }}>
              {MODES.map((m) => (
                <button key={m} onClick={() => setMode(m)} style={{
                  borderRadius: "var(--r-pill)", padding: "7px 13px", fontSize: 11, fontWeight: 700,
                  background: active === m ? "var(--navy)" : "transparent",
                  color: active === m ? "#fff" : "var(--ink-55)",
                }}>{m}</button>
              ))}
            </div>
          </div>

          {asClass && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10,
              background: "var(--paper)", border: "1px solid var(--line)",
              borderRadius: "var(--r-card)", padding: "15px 16px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em",
                  textTransform: "uppercase", color: "var(--ink-40)" }}>Look for</span>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{guide.looking_for}</span>
                <span style={{ fontSize: 12, color: "var(--ink-55)", lineHeight: 1.5 }}>
                  {guide.why} About {guide.minutes} minutes.
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {guide.must.map((m) => (
                  <span key={m} style={{ display: "flex", gap: 8, fontSize: 12.5, lineHeight: 1.5 }}>
                    <b style={{ color: "var(--teal)", flex: "none" }}>✓</b>{m}
                  </span>
                ))}
                {guide.avoid.map((a) => (
                  <span key={a} style={{ display: "flex", gap: 8, fontSize: 12.5,
                    lineHeight: 1.5, color: "var(--ink-55)" }}>
                    <b style={{ color: "#C07A3E", flex: "none" }}>✕</b>{a}
                  </span>
                ))}
              </div>
              {/* What to do when the only class available is the wrong shape, which is
                  most weeks for most people. */}
              <span style={{ fontSize: 12, lineHeight: 1.5, color: "var(--ink-70)",
                borderTop: "1px dashed var(--line)", paddingTop: 10 }}>
                {guide.fallback}
              </span>
            </div>
          )}

          <div style={{ display: asClass ? "none" : "flex", flexDirection: "column", gap: 12 }}>
            {groups.map((g, gi) => {
              let n = groups.slice(0, gi).reduce((a, x) => a + x.items.length, 0);
              return (
                <div key={gi} style={{ display: "flex", flexDirection: "column",
                  border: "1px solid var(--line)", borderRadius: "var(--r-card)", overflow: "hidden" }}>
                  <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".12em",
                    textTransform: "uppercase", color: "#fff", background: g.color,
                    padding: "9px 14px", display: "flex", alignItems: "center",
                    justifyContent: "space-between", gap: 10 }}>
                    {g.label}
                    {g.repeat > 1 && (
                      <span style={{ background: "rgba(255,255,255,.22)", borderRadius: "var(--r-pill)",
                        padding: "3px 10px", fontSize: 11, letterSpacing: ".02em" }}>
                        × {g.repeat}
                      </span>
                    )}
                  </div>
                  <div style={{ background: "var(--paper)" }}>
                    {g.summary && (
                      <div style={{ fontSize: 12, color: "var(--ink-55)", padding: "11px 14px 0" }}>
                        {g.summary}
                      </div>
                    )}
                    {g.items.map((it, ii) => {
                      n += 1;
                      return (
                        <div key={ii} style={{ display: "grid", gridTemplateColumns: "22px 1fr auto",
                          gap: 12, alignItems: "center", padding: "12px 14px",
                          borderTop: ii ? "1px solid var(--line-2)" : "none" }}>
                          <span style={{ fontFamily: "var(--display)", fontSize: 15, fontWeight: 700,
                            color: it.work ? "var(--ink-40)" : "var(--ink-40)" }}>{n}</span>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>{it.main}</span>
                            <span style={{ fontSize: 11, color: "var(--ink-55)" }}>{it.sub}</span>
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em",
                            textTransform: "uppercase", color: "var(--ink-40)" }}>
                            {it.tag ?? (active === "Treadmill" ? "TM" : "Run")}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {/* Said once, under the pair it applies to. */}
                  {g.repeat > 1 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8,
                      background: "var(--paper)", padding: "11px 14px",
                      borderTop: "1px dashed var(--line)", color: "var(--teal)",
                      fontSize: 12, fontWeight: 700 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                        <path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" />
                        <path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" />
                      </svg>
                      Repeat × {g.repeat}
                    </div>
                  )}
                  {g.note && (
                    <div style={{ fontSize: 11, lineHeight: 1.5, color: "var(--ink-55)",
                      background: "var(--paper)", padding: "12px 14px 13px",
                      borderTop: "1px solid var(--line-2)" }}>{g.note}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ padding: "16px 18px 8px", display: "flex", flexDirection: "column", gap: 10 }}>
        <button onClick={async () => { await send({ action: "complete", done: !done }); await load(); onChanged(); }}
          style={{ width: "100%", background: "var(--lime)", borderRadius: "var(--r-pill)",
            color: "var(--on-lime)", padding: 17, fontSize: 13, fontWeight: 800,
            letterSpacing: ".06em", textTransform: "uppercase" }}>
          {/* Not "start session": nothing in this app times a session live, and a
              button that says start is a promise of a stopwatch that never arrives.
              What it does is mark the session done. */}
          {done ? "Mark not done" : "Mark it done"}
        </button>
        {groups.length > 0 && (
          <button disabled={busy} onClick={async () => {
            setSent("Sending…");
            const r = await fetch(`/api/intervals/push/${id}`, { method: "POST" });
            const j = await r.json().catch(() => ({}));
            setSent(r.ok ? "Sent — it will appear on your watch." : (j.error ?? "Couldn't send it."));
          }} style={{ width: "100%", borderRadius: "var(--r-pill)", padding: 14, fontSize: 11,
            fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
            border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)" }}>
            {sent ?? "Send to Garmin watch"}
          </button>
        )}
        <div style={{ fontSize: 11, textAlign: "center", color: "var(--ink-40)", lineHeight: 1.5 }}>
          {/*
            * The watch is set in minutes per kilometre whatever you run on, so that number
            * stays as it is — with the belt equivalent beside it in treadmill mode, which is
            * the number you actually have to dial in. The card above says the same thing
            * about the alarm; this is the line that says what was pushed.
            */}
          {pace
            ? `Watch alert set at ${say(pace - 3, "Outdoor")}${
              active === "Treadmill" ? ` — ${say(pace - 3, active)} on the belt` : ""
            }. If rep 1 is the fastest, the session logs as failed.`
            : "Logged against the plan, not against feel."}
        </div>
      </div>

      <Rpe d={d} send={send} reload={load} />
      <Thread comments={d.comments} meId={meId} send={send} reload={load} />
    </div>
  );
}

function Action({ label, onClick, active, danger, children }: {
  label: string; onClick: () => void; active?: boolean; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} style={{ flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", gap: 7, padding: "4px 0", color: "var(--ink)" }}>
      <span style={{ width: 40, height: 40, borderRadius: "50%",
        background: active ? "var(--teal-tint2)" : "var(--off)",
        display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none"
          stroke={danger ? "#C07A3E" : active ? "#0A8FB0" : "#12314D"}
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
      </span>
      <span style={{ fontSize: 11, fontWeight: 600 }}>{label}</span>
    </button>
  );
}

/**
 * The warm-up, for the session it sits under.
 *
 * Exported because the strength screen is a different component and had no warm-up at
 * all — an athlete opening a squat session got nothing, and one opening a run got a
 * runner's warm-up whether they were running or not.
 */
export function WarmupCard({ kind, title, onHide }: {
  kind: string; title: string; onHide: () => void;
}) {
  const warmup = warmupFor(kind, title);
  return (
    <div style={{ margin: "14px 18px 0", background: "var(--paper)",
      border: "1px solid var(--teal)", borderRadius: "var(--r-card)",
      padding: "15px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em",
          textTransform: "uppercase", color: "var(--teal)" }}>Warm-up</span>
        <button onClick={onHide} style={{ color: "var(--ink-40)", fontSize: 11,
          fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>Hide</button>
      </div>
      {/* What this warm-up is for, which changes with what follows it. There was one
          warm-up in the app and it was a runner's: eight minutes of jogging and two
          stride drills, prescribed before a back squat. */}
      <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--ink-55)", paddingBottom: 4 }}>
        {warmup.purpose}
      </div>
      {warmup.steps.map((w, i) => (
        <div key={w.name} style={{ display: "grid", gridTemplateColumns: "22px 1fr auto",
          gap: 12, alignItems: "center", padding: "10px 0",
          borderTop: i ? "1px solid var(--line-2)" : "none" }}>
          <span style={{ fontFamily: "var(--display)", fontSize: 15, fontWeight: 700,
            color: "var(--ink-40)" }}>{i + 1}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{w.name}</span>
            <span style={{ fontSize: 11, color: "var(--ink-55)", lineHeight: 1.4 }}>{w.cue}</span>
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--teal)",
            whiteSpace: "nowrap" }}>{w.dose}</span>
        </div>
      ))}
    </div>
  );
}

/** RPE and how long it felt. Both are the athlete's report, not the watch's. */
export function Rpe({
  d, send, reload,
}: { d: SessionDetail; send: Send; reload: () => void }) {
  const rpe = d.feedback?.rpe ?? null;
  const feel = d.feedback?.length_feel ?? null;
  /*
   * What the answer did, said back.
   *
   * "Too long" was stored and read by nobody. A question with no visible consequence
   * stops being answered in about three weeks, and this is the only signal the app
   * has about a session a watch cannot measure.
   */
  const [said, setSaid] = useState<string | null>(null);
  return (
    <div className="band">
      <span className="caps" style={{ color: "var(--ink)" }}>How did it feel?</span>
      <div style={{ display: "flex", gap: 4 }}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button key={n} onClick={async () => { await send({ action: "feedback", rpe: n }); reload(); }}
            style={{ flex: 1, height: 34, borderRadius: 8, fontSize: 12, fontWeight: 700,
              background: rpe === n ? "var(--navy)" : "var(--off)",
              color: rpe === n ? "#fff" : "var(--ink-55)" }}>{n}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {["short", "right", "long"].map((f) => (
          <button key={f} onClick={async () => {
            const r = await send({ action: "feedback", length_feel: f });
            setSaid((r?.said as string | null) ?? null);
            reload();
          }}
            style={{ flex: 1, padding: "9px 0", borderRadius: "var(--r-pill)", fontSize: 11,
              fontWeight: 700, border: "1px solid",
              background: feel === f ? "var(--teal-tint)" : "transparent",
              color: feel === f ? "var(--teal)" : "var(--ink-55)",
              borderColor: feel === f ? "var(--teal)" : "var(--line)" }}>
            {f === "short" ? "Too short" : f === "right" ? "About right" : "Too long"}
          </button>
        ))}
      </div>
      {said && (
        <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--teal)",
          background: "var(--teal-tint2)", borderRadius: 8, padding: "10px 12px" }}>
          {said}
        </div>
      )}
    </div>
  );
}
