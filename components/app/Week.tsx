"use client";
import { useCallback, useEffect, useState } from "react";
import { addDays, dow, fmt, mondayOf, today } from "@/lib/dates";
import { kindColour, kindLabel, weekDates } from "@/lib/coach";
import {
  GhostRow, RebuildBar, RebuildCard, RebuildNudge, RebuildSheet, type Proposal,
} from "./Rebuild";
import { beforeBlock as isBefore, intentFor, weekOf } from "@/lib/block";
import { prescribedPace } from "@/lib/signals";
import { parseStrength } from "@/lib/prescription";
import { summariseStrength } from "@/lib/plan/exercises";
import type { Session, User, WeekData } from "./Shell";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type DaySky = {
  date: string; sky: string; emoji: string; temp_c: number; feels_c: number;
  rain_mm: number; wind_kmh: number; cost_s: number;
};

/** The week's forecast, keyed by date. Empty until it arrives, and on failure. */
function useSky(from: string, to: string): Record<string, DaySky> {
  const [days, setDays] = useState<Record<string, DaySky>>({});
  useEffect(() => {
    let live = true;
    setDays({});
    fetch(`/api/weather?from=${from}&to=${to}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live) return;
        const out: Record<string, DaySky> = {};
        for (const d of (j?.days ?? []) as DaySky[]) out[d.date] = d;
        setDays(out);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [from, to]);
  return days;
}
/** Small numbers read better as words in a headline. */
const COUNT: Record<number, string> = {
  0: "No", 1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven",
};
const TEAL = "#0A8FB0", LIME = "#C6FF5B", NAVY = "#12314D";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const OFF = "var(--off)", PAPER = "var(--paper)", LINE = "var(--line)";

/** PM is the loud one: a second session in a day is worth noticing. */
const slotChip = (slot: string | null | undefined): React.CSSProperties => ({
  fontSize: 9, fontWeight: 800, letterSpacing: ".08em", padding: "3px 7px",
  borderRadius: "var(--r-pill)",
  background: slot === "PM" ? NAVY : OFF,
  color: slot === "PM" ? LIME : INK55,
});

const pc = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, "0")}`;

/**
 * The three numbers under a session card.
 *
 * Planned and completed sessions say different things: before, the useful figures
 * are the prescription and the alarm; after, they are what actually happened.
 */
/**
 * The line under a session's name, on the card.
 *
 * It was the first line of the prescription, which is the warm-up: "2km Z2 warm up
 * @ 5:26-5:52/km" over a session called 2 × 15 min. Nobody scanning their week
 * needs the warm-up — they need the work, and the pace it is at.
 */
function workLine(target: string | null | undefined): string {
  if (!target) return "";
  const lines = target.split("\n").map((l) => l.replace(/^[-•*]\s*/, "").trim());
  const reps = lines.findIndex((l) => /^\d+\s*x$/i.test(l));
  if (reps > -1 && lines[reps + 1]) {
    const n = lines[reps].replace(/x$/i, "").trim();
    const work = lines[reps + 1]
      .replace(/\bZ[1-5]\b/, "")
      .replace(/@\s*/, "at ")
      .replace(/\s+/g, " ")
      .trim();
    return `${n} × ${work}`;
  }
  /*
   * A strength session says what it trains and how big it is.
   *
   * Not its first line: "Back squat 3×8 rest 120s rpe 7" describes one sixth of the
   * session, and next to a set count it reads as though the whole thing were three sets
   * of a squat.
   */
  const lifts = parseStrength(target);
  if (lifts.length > 1) return summariseStrength(lifts);

  // A single-block session — an easy or long run — says itself.
  const first = lines.find((l) => l && !/warm up/i.test(l));
  return (first ?? "").replace(/\bZ[1-5]\b/, "").replace(/@\s*/, "at ")
    .replace(/\s+/g, " ").trim();
}

function metrics(s: Session): [string, string, string] {
  const done = ["done", "adjusted", "unplanned"].includes(s.status);
  const pace = prescribedPace(s.title);
  if (s.kind === "strength") {
    /*
     * Counted, not guessed.
     *
     * It said "3 lifts" on every strength session in the app — a literal, written when
     * a session had three movements in it. They have six now, and the card was reading
     * as "three sets" beside a lift line that says 3×5, which is two wrong numbers
     * agreeing with each other.
     */
    const lifts = parseStrength(s.target);
    const sets = lifts.reduce((n, l) => n + (l.sets || 0), 0);
    return [
      `${s.planned_minutes ?? 40} min`,
      // The counts are in the line above now, so this says what is left to say.
      done ? "logged" : sets ? `${sets} sets` : "",
      "",
    ];
  }
  const km = s.distance_m ? Number(s.distance_m) / 1000 : null;
  if (!s.kind.startsWith("run")) {
    return [
      s.actual_minutes ? `${s.actual_minutes} min` : `${s.planned_minutes ?? "—"} min`,
      done && s.avg_hr ? `avg ${Math.round(Number(s.avg_hr))} bpm` : "",
      "",
    ];
  }
  return [
    km ? `${km.toFixed(2)} km` : `${s.planned_minutes ?? "—"} min`,
    done && km && s.actual_minutes
      ? `${pc((s.actual_minutes * 60) / km)} /km`
      : pace ? `${pc(pace)} /km prescribed` : "",
    done && s.avg_hr ? `HR ${Math.round(Number(s.avg_hr))}` : pace ? `alert ${pc(pace - 3)}` : "",
  ];
}

export default function Week({
  data, me, monday, setMonday, openActivity, openSession, reload, openWeek, openForm,
  coaching,
}: {
  data: WeekData | null; me: User;
  monday: string;
  /** moving between the weeks of the block, from the strip above the days */
  setMonday: (m: string) => void;
  /** the athlete being coached, when the profile has opened someone else's week */
  coaching: string | null;
  openActivity: (id: string) => void; openSession: (s: Session) => void; reload: () => void;
  /** the whole week — the overview card is the way into it */
  openWeek: () => void;
  /** where the pace-change card goes: the screen that shows the sessions behind it */
  openForm: () => void;
}) {
  const [day, setDay] = useState(() => dow(today()));
  /*
   * A pending change to the pace targets.
   *
   * The engine has always been able to work this out and nothing ever told the
   * athlete: the recommendation sat on the Form tab, which you would only open if you
   * already suspected something. It is a card here, and it leads to the screen that
   * shows the sessions behind it — the decision stays the athlete's.
   */
  const [shift, setShift] = useState<{ pending: boolean; headline: string | null } | null>(null);
  useEffect(() => {
    fetch("/api/calibration").then(async (r) => r.ok && setShift(await r.json()));
  }, []);

  useEffect(() => {
    const t = today();
    setDay(t >= monday && t < addDays(monday, 7) ? dow(t) : 0);
  }, [monday]);

  /*
   * The week's weather, in one request — and above the loading guard, with every
   * other hook.
   *
   * It was below it, which is a hooks-order violation: on the first render `data` is
   * null, the component returns early and this hook never runs; when the week arrives
   * it does, React sees more hooks than last time, and the whole app dies with a
   * client-side exception. Hooks cannot sit after a conditional return, and the
   * argument here does not need `data` anyway — the dates come from `monday`, which
   * is a prop.
   */
  const sky = useSky(weekDates(monday)[0], weekDates(monday)[6]);
  /*
   * Rebuild my week. Three states: closed, describing, previewing.
   *
   * The preview replaces the week in place rather than opening a diff screen — they compare
   * it against the week they already have in their head, not against a list.
   */
  const [sheet, setSheet] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [applying, setApplying] = useState(false);
  const [nudged, setNudged] = useState(false);

  if (!data) return <div style={{ padding: 18 }}><p className="empty">Loading…</p></div>;

  const uid = coaching ?? me.id;
  const all = [...data.sessions, ...data.unplanned].filter((s) => s.user_id === uid);
  const dates = weekDates(monday);
  // Someone with no plan of their own is not "before the block" — there is no
  // block. Showing the other athlete's rebuild weeks and 55:00 goal as hers was
  // the bug this closes.
  const block = data?.block ?? null;
  const week = weekOf(block, monday);
  const intent = week ? intentFor(block, week.n) : null;
  const beforeBlock = isBefore(block, monday);

  const dayList = all
    .filter((s) => s.planned_date === dates[day])
    .sort((a, b) => Number(a.slot === "PM") - Number(b.slot === "PM"));



  /*
   * How far the arrows go.
   *
   * A week inside the block either way, plus the current week always — someone with
   * no block can still look at last week, and someone whose block has ended can
   * still get back to it.
   */
  const first = block?.weeks[0]?.start ?? null;
  const last = block?.weeks[block.weeks.length - 1]?.start ?? null;
  const thisMonday = mondayOf(today());
  const isThisWeek = monday === thisMonday;
  const canBack = !first || addDays(monday, -7) >= first || addDays(monday, -7) >= thisMonday;
  const canForward = !last || addDays(monday, 7) <= last || addDays(monday, 7) <= thisMonday;

  /*
   * The three lines above the week.
   *
   * What it used to say: the phase key ("BASE"), the volume, and the week's own
   * note ("Down week"). What an athlete opening the app wants first is which block
   * this is, how far into it they are, and what this particular week asks of them —
   * the hard days by name, and what everything else is doing there.
   *
   * "Two hard days" was hardcoded, as were Tuesday and Saturday; they are counted
   * off the sessions now, so they are right for whatever week is on screen.
   */
  const lead = (() => {
    const disciplineOf = (n: string) => n.split(" · ")[0];
    /*
     * Hard days, not key days.
     *
     * "Key" marks the sessions the plan reads to decide what to prescribe next —
     * which includes the strength day and the long run. Counting those as hard
     * produced "Five hard days" over a week with two interval sessions and a Hyrox
     * session in it, which is the number that matters and is three.
     */
    const HARD_KINDS = ["quality_run", "hyrox", "benchmark", "race"];
    const hardDays = [...new Set(all
      .filter((s) => HARD_KINDS.includes(s.kind) || s.significance === "hard"
        || s.significance === "benchmark" || s.significance === "race")
      .map((s) => s.planned_date))].sort();
    const names = hardDays.map((d) => fmt(d, { weekday: "long" }));
    const nHard = COUNT[names.length] ?? String(names.length);
    const list = names.length === 0 ? ""
      : names.length === 1 ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

    if (!block) {
      return {
        eyebrow: "No block",
        headline: "No block on your account.",
        sub: "Anything you log still appears here, and still counts in the head-to-head.",
      };
    }
    if (beforeBlock) {
      return {
        eyebrow: `${disciplineOf(block.name)} · starts ${fmt(block.start, { day: "numeric", month: "short" })}`,
        headline: "The block starts Monday.",
        sub: `${block.weeks.length} weeks to ${block.goal_label ?? block.race_name ?? "race day"}. Week 1 is ${(block.weeks[0]?.km ?? 0).toFixed(1)} km — bought with consistency, not intensity.`,
      };
    }
    if (!week) {
      return {
        eyebrow: `${disciplineOf(block.name)} · outside the block`,
        headline: "Nothing planned this week.",
        sub: "The block covers a different set of weeks. Anything you log still counts.",
      };
    }

    const race = all.some((s) => s.significance === "race");
    const km = `${week.km.toFixed(1)} km`;
    const headline = race ? "Race week."
      : names.length === 0 ? `${km}, all of it easy.`
      : `${nHard} hard day${names.length === 1 ? "" : "s"}. ${km}.`;

    /*
     * Why this week is not a normal one, where it is not. The note carries the
     * reason — a trip, a down week, the taper — and it belongs in the sentence
     * rather than instead of it.
     */
    const why = week.note ? `${week.note}.` : "";
    const sub = race
      ? `Everything this week is about arriving fresh. ${km} in total.`
      : names.length === 0
        ? `Nothing hard in it. ${why}`.trim()
        : `${list} ${names.length === 1 ? "is the hard day" : "are the hard days"}. Everything else protects them.${why ? ` ${why}` : ""}`;

    return {
      eyebrow: `${disciplineOf(block.name)} · week ${week.n} of ${block.weeks.length} · ${fmt(monday, { day: "numeric", month: "short" })}`,
      headline, sub,
    };
  })();

  /*
   * The sessions to protect in the week on screen.
   *
   * They came from the phase intent, which quotes the first week of the phase — so
   * week nine of a fifteen-week block listed week five's sessions, and every week of
   * a phase looked like the same week. The phase's purpose, what to drop and what to
   * watch are properties of the phase and still come from it; which sessions to
   * protect is a property of the week you are looking at.
   */
  const protectThese = all
    .filter((s) => !["easy_run", "run_easy"].includes(s.kind))
    .filter((s) => s.significance === "key" || s.significance === "benchmark"
      || s.significance === "race" || s.significance === "hard")
    .sort((a, b) => a.planned_date.localeCompare(b.planned_date))
    .slice(0, 4)
    .map((s) => `${fmt(s.planned_date, { weekday: "short" })} · ${s.title}`);

  const kmDone = all.filter((s) => ["done", "adjusted", "unplanned"].includes(s.status))
    .reduce((n, s) => n + (Number(s.distance_m) || 0), 0) / 1000;
  const doneCount = all.filter((s) => s.status === "done").length;

  return (
    <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
      {/* The day strip, pinned under the header. What you need first is first:
          the reordering the design asks for is sequence, not styling. */}
      <div style={{ margin: "-18px -18px 0", padding: "12px 18px", background: PAPER,
        borderBottom: `1px solid ${LINE}` }}>
        {/*
          * Which week this is, and the way to the ones either side.
          *
          * The screen could only ever show the current week: the state existed and
          * nothing on this screen set it, so an athlete could not look at what is
          * coming or at what they did last week without leaving for the plan.
          * Bounded by the block, so the arrows never walk off either end of it.
          */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 8, paddingBottom: 10 }}>
          <button onClick={() => setMonday(addDays(monday, -7))} disabled={!canBack}
            aria-label="The week before" style={{
              ...arrow, opacity: canBack ? 1 : .3, color: "var(--ink)",
            }}>‹</button>
          <button onClick={() => setMonday(mondayOf(today()))} style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
            gap: 1, color: "var(--ink)",
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, display: "flex",
              alignItems: "center", gap: 8 }}>
              {week ? `Week ${week.n} of ${block?.weeks.length ?? week.n}`
                : isThisWeek ? "This week" : "Outside the block"}
            </span>
            <span style={{ fontSize: 10, color: INK40 }}>
              {isThisWeek ? "This week"
                : `${fmt(monday, { day: "numeric", month: "short" })} – ${
                    fmt(addDays(monday, 6), { day: "numeric", month: "short" })}`}
            </span>
          </button>
          <button onClick={() => setMonday(addDays(monday, 7))} disabled={!canForward}
            aria-label="The week after" style={{
              ...arrow, opacity: canForward ? 1 : .3, color: "var(--ink)",
            }}>›</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3 }}>
          {dates.map((d, i) => {
            const has = all.filter((s) => s.planned_date === d);
            const active = i === day;
            return (
              <button key={d} onClick={() => setDay(i)} style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                padding: "8px 0 7px", borderRadius: 12,
                background: active ? NAVY : "transparent", color: active ? "#fff" : "var(--ink)",
              }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".06em",
                  color: active ? "rgba(255,255,255,.7)" : d === today() ? "var(--teal)" : INK40 }}>
                  {DAYS[i]}
                </span>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{fmt(d, { day: "numeric" })}</span>
                {/* One glyph per day. Reserved height whether or not the forecast
                    arrived, so the strip does not jump when it does. */}
                <span style={{ fontSize: 13, lineHeight: 1, height: 14 }}
                  title={sky[d] ? `${Math.round(sky[d].temp_c)}°C` : undefined}>
                  {sky[d]?.emoji ?? ""}
                </span>
                <span style={{ display: "flex", gap: 2, height: 5, alignItems: "center" }}>
                  {has.slice(0, 3).map((s) => (
                    <span key={s.id} style={{ width: 5, height: 5, borderRadius: "50%",
                      background: active ? LIME : kindColour(s.kind) }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/*
        * The reactive entry point, which is the better one: it arrives at the moment somebody
        * would want it rather than waiting to be remembered.
        */}
      {/*
        * Where the design puts it: under the day strip, above the day.
        *
        * Not shown on a past week — history is immutable — nor in race week, where it is too
        * late to be reorganising and the race-day view is what matters.
        */}
      {isThisWeek && !proposal && !sheet && week
        && week.n < (block?.weeks.length ?? 99) && (
        <RebuildCard onOpen={() => setSheet(true)} />
      )}

      {isThisWeek && !proposal && !nudged && !sheet && (
        <RebuildNudge
          empty={dates
            .filter((d, i) => d < today() && i < dow(today())
              && !all.some((s) => s.planned_date === d
                && ["done", "adjusted", "unplanned"].includes(s.status)))
            .map((d) => fmt(d, { weekday: "long" }))}
          onOpen={() => { setNudged(true); setSheet(true); }}
          onDismiss={() => setNudged(true)}
        />
      )}

      {sheet && (
        <RebuildSheet monday={monday} onClose={() => setSheet(false)}
          onProposal={(p) => { setSheet(false); setProposal(p); }} />
      )}

      {proposal && (
        <RebuildBar p={proposal} busy={applying}
          onDiscard={() => setProposal(null)}
          onApply={async () => {
            setApplying(true);
            const r = await fetch(`/api/weeks/${monday}/rebuild/apply`, {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ proposal_id: proposal.proposal_id }),
            });
            setApplying(false);
            if (r.ok) { setProposal(null); reload(); }
          }} />
      )}

      {/* ----------------------------------------------------------- the day */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          {/*
            * The date is the anchor of this screen, so it is set like one.
            *
            * It was an 11px uppercase caption — "MONDAY 17 AUGUST" — which ranks the day
            * below the session titles under it and makes the eye land on the wrong thing.
            * The design has it at display size with the weather inline, and it reads far
            * better: you know which day you are looking at before you have read a word.
            */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--display)", fontSize: 23, fontWeight: 700,
              letterSpacing: "-.02em", lineHeight: 1.1 }}>
              {fmt(dates[day], { weekday: "short", day: "numeric", month: "short" })}
            </span>
            {sky[dates[day]] && (
              <span style={{ fontSize: 15, fontWeight: 600, color: INK55,
                display: "flex", alignItems: "baseline", gap: 5 }}>
                <span style={{ fontSize: 16 }}>{sky[dates[day]].emoji}</span>
                {Math.round(sky[dates[day]].temp_c)}°
              </span>
            )}
          </div>
          {/* Right-aligned and quiet: "Double day" over "feels 30°", as the design has it. */}
          <span style={{ fontSize: 12.5, color: INK55, textAlign: "right", lineHeight: 1.5 }}>
            {dayList.length === 0 ? "Rest day"
              : dayList.length > 1 ? "Double day"
              : "1 session"}
            {/* Said only when it differs enough to matter — "feels 19°" beside 19° is
                noise, and the number that changes how you dress is the second one. */}
            {sky[dates[day]] && Math.abs(sky[dates[day]].feels_c - sky[dates[day]].temp_c) >= 2 && (
              <><br />feels {Math.round(sky[dates[day]].feels_c)}°</>
            )}
          </span>
        </div>

        {/*
          * Dropped sessions stay visible as ghost rows while a proposal is on screen.
          *
          * Removing them outright makes the week look thinner than the change actually was,
          * and hides what was given up — which is the thing to see before agreeing to it.
          */}
        {proposal?.dropped
          .filter((d) => d.day === DAYS[day])
          .map((d) => <GhostRow key={d.id} label={d.label} why={d.why} />)}

        {dayList.length === 0 && !proposal && <p className="empty">Nothing written for this day.</p>}

        {dayList.map((s) => {
          const [m1, m2, m3] = metrics(s);
          const isDone = s.status === "done" || s.status === "unplanned";
          return (
            <button key={s.id} onClick={() => openSession(s)} style={{
              textAlign: "left", width: "100%", padding: 0, background: PAPER,
              border: `1px solid ${LINE}`, borderRadius: "var(--r-card)", overflow: "hidden",
              display: "flex", alignItems: "stretch", color: "var(--ink)",
            }}>
              <span style={{ width: 4, flex: "none", alignSelf: "stretch",
                background: kindColour(s.kind) }} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7,
                padding: "14px 14px 13px 16px" }}>
                <div style={{ display: "flex", alignItems: "center",
                  justifyContent: "space-between", gap: 8 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    {s.slot && <span style={slotChip(s.slot)}>{s.slot}</span>}
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
                      textTransform: "uppercase", color: INK55 }}>{kindLabel(s.kind)}</span>
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: ".08em",
                    textTransform: "uppercase", padding: "4px 9px", borderRadius: "var(--r-pill)",
                    background: isDone ? "var(--teal-tint2)" : OFF,
                    color: isDone ? TEAL : INK55,
                  }}>
                    {s.status === "done" ? "Completed" : s.status === "adjusted" ? "Adjusted"
                      : s.status === "skipped" ? "Skipped"
                      : s.status === "unplanned" ? "Off plan" : "Planned"}
                  </span>
                </div>
                {/*
                  * The purpose is the headline, where the plan wrote one.
                  *
                  * "3 × 8 min" is an accurate name and a useless one: it says what you
                  * are about to do and nothing about why, so the only sessions with
                  * meaning are the ones you already understood. The prescription drops to
                  * the line underneath, where it is still exactly as checkable.
                  */}
                <div style={{ fontFamily: "var(--display)", fontSize: 18, fontWeight: 700,
                  lineHeight: 1.2, letterSpacing: "-.01em" }}>{s.purpose || s.title}</div>
                {(s.purpose || s.target) && (
                  <div style={{ fontSize: 12, color: INK55, lineHeight: 1.45 }}>
                    {[s.purpose ? s.title : null, workLine(s.target)]
                      .filter(Boolean).join(" · ")}
                  </div>
                )}
                <div style={{ display: "flex", gap: 12, fontSize: 12, fontWeight: 600 }}>
                  <span>{m1}</span>
                  <span style={{ color: INK55, fontWeight: 500 }}>{m2}</span>
                  <span style={{ color: INK55, fontWeight: 500 }}>{m3}</span>
                </div>
                {s.significance && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: NAVY,
                    background: "var(--teal-tint2)", borderRadius: "var(--r-pill)",
                    padding: "4px 10px", alignSelf: "flex-start", textTransform: "capitalize" }}>
                    {s.significance}
                  </span>
                )}
                {/*
                  * A "with Olivier" line used to hang off every Hyrox session — a
                  * name hardcoded from the first athlete this app was written for,
                  * shown to everyone else. Whether a session is done with a partner
                  * is not something the plan knows, and inventing it is worse than
                  * leaving it out.
                  */}
              </div>
            </button>
          );
        })}
      </div>
      {/* The week at a glance, and the way into the whole of it. Two bars rather
          than three tiles: sessions done and distance run are the week's shape,
          and the third tile was a metric nobody navigated by. */}
      <button onClick={openWeek} style={{
        width: "100%", textAlign: "left", background: PAPER, border: `1px solid ${LINE}`,
        borderRadius: "var(--r-card)", padding: "15px 16px", color: "var(--ink)",
        display: "flex", flexDirection: "column", gap: 11,
      }}>
        <span style={{ display: "flex", alignItems: "center",
          justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>
            {week ? `Week ${week.n} · ${week.km.toFixed(1)} km target` : "This week"}
          </span>
          <span style={{ fontSize: 13, color: INK40 }}>›</span>
        </span>
        <span style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <span style={{ height: 5, background: OFF, borderRadius: 3, overflow: "hidden" }}>
            <span style={{ display: "block", height: 5, background: "var(--teal)",
              width: `${all.length ? Math.round((doneCount / all.length) * 100) : 0}%` }} />
          </span>
          <span style={{ height: 5, background: OFF, borderRadius: 3, overflow: "hidden" }}>
            <span style={{ display: "block", height: 5, background: LIME,
              width: `${week?.km ? Math.min(100, Math.round((kmDone / week.km) * 100)) : 0}%` }} />
          </span>
        </span>
        <span style={{ display: "flex", alignItems: "baseline",
          justifyContent: "space-between", gap: 10, fontSize: 12, fontWeight: 600 }}>
          <span>{doneCount}/{all.length} sessions</span>
          <span>{kmDone.toFixed(kmDone < 10 ? 1 : 0)}{week?.km ? ` / ${week.km}` : ""} km</span>
        </span>
      </button>

      {shift?.pending && shift.headline && (
        <button onClick={openForm} style={{
          width: "100%", textAlign: "left", display: "flex", alignItems: "center",
          gap: 12, background: "var(--cream)", border: `1px solid #C9A227`,
          borderRadius: "var(--r-card)", padding: "14px 15px", color: "var(--ink)",
        }}>
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".1em",
              textTransform: "uppercase", color: "#8A6D14" }}>
              Your paces can move
            </span>
            <span style={{ fontSize: 13, lineHeight: 1.5 }}>{shift.headline}</span>
            <span style={{ fontSize: 11, color: INK55 }}>
              Nothing changes until you say so.
            </span>
          </span>
          <span style={{ fontSize: 13, color: INK40 }}>›</span>
        </button>
      )}

      {/*
        * The block, as context rather than the lead.
        *
        * The plan-state strip used to sit here, above every week of the plan for as
        * long as the plan was estimated — the same sentence, fifteen times, saying
        * something that changes once. It lives on the plan screen, which is where
        * you go to ask what kind of plan this is.
        */}
      <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 16,
        display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em",
          textTransform: "uppercase", color: "var(--teal)" }}>{lead.eyebrow}</div>
        <div style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700,
          lineHeight: 1.15, letterSpacing: "-.02em" }}>{lead.headline}</div>
        <div style={{ fontSize: 12, color: INK55, lineHeight: 1.5 }}>{lead.sub}</div>
      </div>

      {/* ------------------------------------------- what the week is for */}
      {intent && (
        <div style={{ background: PAPER, border: `1px solid ${LINE}`,
          borderRadius: "var(--r-card)", padding: 16,
          display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--teal)" }} />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em",
              textTransform: "uppercase", color: "var(--teal)" }}>
              {intent.phase}
              {block && intent.from ? ` · weeks ${intent.from}–${intent.to}` : ""}
            </span>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--ink-70)" }}>{intent.purpose}</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 7,
            borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
              textTransform: "uppercase", color: INK55 }}>Protect these</span>
            {protectThese.map((p) => (
              <div key={p} style={{ display: "flex", alignItems: "center", gap: 9,
                background: "var(--teal-tint)", border: "1px solid var(--teal-tint2)",
                borderRadius: 10, padding: "10px 12px" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0A8FB0"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z" />
                </svg>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{p}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8,
            borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
            {([["Drop first", intent.sacrifice], ["Watch for", intent.watch]] as const).map(([k, v]) => (
              <div key={k} style={{ display: "grid", gridTemplateColumns: "78px 1fr",
                gap: 10, alignItems: "start" }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em",
                  textTransform: "uppercase", whiteSpace: "nowrap", color: INK40 }}>{k}</span>
                <span style={{ fontSize: 12, lineHeight: 1.5, color: "var(--ink-70)" }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

const arrow: React.CSSProperties = {
  width: 40, height: 40, flex: "none", borderRadius: "var(--r-pill)",
  border: `1px solid ${LINE}`, background: PAPER, color: INK55, fontSize: 15,
};
