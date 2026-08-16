"use client";
import { useEffect, useMemo, useState } from "react";
import IntakeConnect from "./IntakeConnect";
import IntakeKm from "./IntakeKm";
import IntakeGoal from "./IntakeGoal";
import IntakeStart from "./IntakeStart";
import IntakeRaces, { type PastRace } from "./IntakeRaces";
import IntakeBRaces, { type BRace } from "./IntakeBRaces";
import { GEAR_ASSUMED, filled, liveSteps, subFor, type Answers as StepAnswers } from "@/lib/intake-steps";
import { divisionsFor } from "@/lib/intake";

/**
 * Nothing is filtered out any more.
 *
 * pastRaces was dropped when it looked like a lookup against official results,
 * which there is no sanctioned way to query. Typed in by hand it is a different
 * proposition entirely — and it is the only source of a roxzone anywhere in the
 * app, so leaving it out cost the race planner its one real number.
 */
const PENDING = new Set<string>();

const TEAL = "var(--teal)", LIME = "var(--lime)", NAVY = "var(--navy)";
const INK = "var(--ink)", INK40 = "var(--ink-40)", INK55 = "var(--ink-55)", INK70 = "var(--ink-70)";
const OFF = "var(--off)", PAPER = "var(--paper)", LINE = "var(--line)", LINE2 = "var(--line-2)";
const CREAM = "var(--cream)", TEAL_T = "var(--teal-tint)", TEAL_T2 = "var(--teal-tint2)";

/**
 * Building a block: the questions, the scaffold, the benchmark offer, the plan.
 *
 * Ported from Coach.dc.html. One component rather than five screens because it
 * is one flow with one draft — the answers have to survive going back a step,
 * seeing the scaffold, and deciding about the benchmark, and splitting that
 * across routes would mean persisting a half-finished intake nobody asked to
 * save.
 *
 * The generator lives on the server (lib/generate.ts). This asks it twice: once
 * to resolve the answers into a scaffold and an offer without writing anything,
 * and once to commit. A user who abandons the flow leaves nothing behind.
 */

type Options = {
  hasRace: string[]; discipline: string[]; raceDistance: string[]; role: string[];
  division: { solo: string[]; doubles: string[] };
  base: string[]; runningSelf: string[]; runningCeilings: Record<string, number>;
  days: string[]; commitments: string[];
  commitmentEffects: Record<string, { why: string; volume_multiplier: number }>;
  equipment: { default: string[]; running: string[] };
  sled: string[]; volume: string[]; difficulty: string[];
};

type Answers = {
  hasRace: string; discipline: string; raceDistance: string | null; raceDate: string | null;
  role: string | null; division: string | null; base: string; runningSelf: string;
  paceMin: number; paceSec: number; paceUnknown: boolean;
  days: string[]; commitments: string[];
  freq: Record<string, number>; commitDay: Record<string, string[]>;
  equipment: string[]; sled: string | null; injuries: string;
  volume: string; difficulty: string; benchmark: string;
  /** the two recent-volume answers, and where they came from */
  longestRun: number; peakWeek: number;
  longestRunUnknown: boolean; peakWeekUnknown: boolean;
  volumeSource: "strava" | "self" | null;
  hyroxExp: string | null; targetSessions: string;
  allowDoubles: string | null; wantRestDay: string | null; sessionPref: string | null;
  runDelta: string | null; stationDelta: string | null;
  goal: string | null; goalMin: number; startDate: string | null;
  pastRaces: PastRace[];
  bRaces: BRace[];
};

const EMPTY: Answers = {
  hasRace: "", discipline: "", raceDistance: null, raceDate: null,
  role: null, division: null, base: "", runningSelf: "",
  paceMin: 32, paceSec: 0, paceUnknown: false,
  days: [], commitments: [], freq: {}, commitDay: {},
  // Pre-ticked: see GEAR_ASSUMED. Deselectable like anything else.
  equipment: [...GEAR_ASSUMED], sled: null, injuries: "",
  volume: "Progressive", difficulty: "Challenging", benchmark: "offered",
  longestRun: 0, peakWeek: 0, longestRunUnknown: false, peakWeekUnknown: false,
  volumeSource: null,
  hyroxExp: null, targetSessions: "", allowDoubles: null, wantRestDay: null,
  sessionPref: null, runDelta: null, stationDelta: null,
  goal: null, goalMin: 60, startDate: null, pastRaces: [], bRaces: [],
};

/** The questions, in order, with the copy from the design. */
const Q: Record<string, { q: string; sub: string; kind: string; skip?: string }> = {
  hasRace: { kind: "choice", q: "Do you have your next race planned?",
    sub: "A date changes everything downstream — plan length, phases, when the taper lands." },
  discipline: { kind: "choice", q: "What are you training for?",
    sub: "This sets how the week is split between running, stations and strength." },
  raceDistance: { kind: "choice", q: "Which distance?",
    sub: "The goal time and the long run are built from this." },
  raceDate: { kind: "date", q: "When is race day?", sub: "The plan is built backwards from here." },
  role: { kind: "choice", q: "Which partner are you?",
    sub: "Doubles is not an even split. Say which side of it you are on." },
  division: { kind: "choice", q: "Which standards apply?",
    sub: "Sled, wall ball and sandbag weights come from this." },
  base: { kind: "choice", q: "How long have you trained consistently?",
    sub: "Sets the volume your body already knows." },
  runningSelf: { kind: "choice", q: "How would you describe your running?",
    sub: "Answer honestly. This caps week 1, whatever the rest says. A 5 km time on the next step can lift it." },
  pace: { kind: "time", q: "What can you currently run 5 km in?",
    sub: "Current fitness, not a personal best or a goal.", skip: "No idea — test me in week 1" },
  days: { kind: "chips", q: "Which days can you train?",
    sub: "Rest days are part of the plan, not a failure." },
  commitments: { kind: "chips", q: "Anything locked in your week?",
    sub: "Classes and other sports still cost your legs. Name them and the plan works around them." },
  equipment: { kind: "chips", q: "What can you get to?",
    sub: "Anything missing gets substituted rather than skipped." },
  sled: { kind: "choice", q: "Sled experience?",
    sub: "The most common place a first race falls apart." },
  injuries: { kind: "text", q: "Anything to train around?",
    sub: "Read before any volume increase is proposed." },
  prefs: { kind: "prefs", q: "Volume and difficulty",
    sub: "Both can be changed later without rebuilding the block." },
};

/** The sub-labels the design shows under each option. */
const SUBS: Record<string, Record<string, string>> = {
  hasRace: { Yes: "I have picked my race", No: "Help me find a goal to work towards" },
  discipline: {
    "Hyrox doubles": "Shared stations with a partner",
    "Hyrox singles": "Every station yourself",
    "Running race": "5K through marathon",
    "General fitness": "No race, just build",
  },
  role: {
    Protected: "Your partner is faster and stronger",
    Engine: "You take the sled, lunges and burpees",
    "Even split": "Similar levels, share everything",
  },
  division: { "Mixed doubles": "One man, one woman" },
  runningSelf: {
    "I do not run": "Walking, or no running yet",
    "Runs with walk breaks": "Not yet 5 km continuous",
    "5 km nonstop": "Comfortable at 5 km, no structure",
    "Runs regularly": "10 km comfortably, some intervals",
    "Half marathon fit": "15–20 km long runs, structured weeks",
    "Marathon runner": "30 km long runs, years of mileage",
    Competitive: "Racing for time, coached or self-coached to a plan",
  },
};

const PREF_TEXT: Record<string, Record<string, string>> = {
  volume: {
    Conservative: "Volume climbs about 5% a week with a down week every third. Fewer kilometres, more room to absorb them. Pick this if life is busy or you are coming back from injury.",
    Progressive: "Volume climbs at the ramp resolved from your answers, with a down week every fourth. The default, and what most blocks should be.",
    Aggressive: "Volume climbs about 12% a week and down weeks come later. Only worth it if your history says your legs tolerate it — this is where injuries come from.",
  },
  difficulty: {
    Steady: "One quality session a week, the rest by effort. Long runs have no pace target. You finish sessions feeling you could do more.",
    Challenging: "One hard session plus a tempo, long runs often carry a pace target. Sessions ask something of you without wrecking the next day.",
    Hard: "Two hard sessions plus pace on the long run. Faster progress and a smaller margin for a bad night of sleep.",
  },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

type Correction = { title: string; body: string };

/** What PUT /api/intake returns: the scaffold and the offer, nothing written. */
type Resolved = {
  resolved: {
    weeks: number; start: string; race_date: string | null;
    base_km: number; ceiling: number; raw_start: number; start_km: number;
    base_ramp: number; run_ramp: number; ramp: number;
    allocation: { run: number; station: number; strength: number };
    pace_known: boolean; goal_seconds: number | null;
    plan_state: string; phase_split: number[];
  };
  corrections: Correction[];
  offer: {
    label: string; kit: string; stations: readonly string[]; rounds: number;
    gated: boolean; gate: string | null; suppressed: boolean; weeks_to_race: number;
  };
  flags: string[];
};

/** And what POST returns once it has been committed. */
type Built = {
  plan: {
    name: string; weeks: number; start: string; race_date: string | null;
    total_km: number; plan_state: string;
    volume: { km: number; note: string }[];
    intents: { from: number; to: number; phase: string; purpose: string }[];
  };
  corrections: Correction[];
  flags: string[];
};

type Stage = "questions" | "ready" | "offer" | "generating" | "live";

export default function PlanBuilder({ onDone }: { onDone: () => void }) {
  const [opts, setOpts] = useState<Options | null>(null);
  const [a, setA] = useState<Answers>(EMPTY);
  const [step, setStep] = useState(0);
  /**
   * Whether Strava is connected, and what it says about their recent running.
   *
   * Read once when the flow opens and again on return from the OAuth round
   * trip, which lands back on this screen. Prefilling the two distance
   * questions is the whole reason the connect step sits before them.
   */
  const [connected, setConnected] = useState(false);
  const [stage, setStage] = useState<Stage>("questions");
  const [calMonth, setCalMonth] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [built, setBuilt] = useState<Built | null>(null);
  const [problems, setProblems] = useState<{ field: string; why: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/intake/recent").then(async (r) => {
      if (!r.ok) return;
      const j = await r.json();
      setConnected(!!j.connected);
      if (!j.recent) return;
      // Prefilled, not answered: the athlete still sees and confirms them, and
      // an edit replaces the source so the number stops claiming to be measured.
      setA((p) => ({
        ...p,
        volumeSource: "strava",
        peakWeek: j.recent.peak_week_km ?? p.peakWeek,
        longestRun: j.recent.long_run_km ?? p.longestRun,
      }));
    });
    fetch("/api/intake").then(async (r) => {
      if (r.status === 401) { location.href = "/"; return; }
      const j = await r.json();
      setOpts(j.options);
      // retaking it starts from the last answers rather than from blank
      if (j.intake) {
        const i = j.intake;
        // Merged over EMPTY rather than replacing it, so a field the stored
        // intake predates arrives as its default instead of undefined.
        setA((p) => ({
          ...p,
          hasRace: i.has_race, discipline: i.discipline, raceDistance: i.race_distance,
          raceDate: i.race_date, role: i.role, division: i.division, base: i.base,
          runningSelf: i.running_self, paceMin: i.pace_min ?? 32, paceSec: i.pace_sec ?? 0,
          paceUnknown: i.pace_unknown, days: i.days ?? [], commitments: i.commitments ?? [],
          freq: i.freq ?? {}, commitDay: i.commit_day ?? {},
          equipment: (i.equipment?.length ? i.equipment : [...GEAR_ASSUMED]),
          sled: i.sled, injuries: i.injuries ?? "", volume: i.volume,
          difficulty: i.difficulty, benchmark: "offered",
          // stored answers win over a Strava prefill: they were confirmed once
          peakWeek: i.peak_week_km ?? p.peakWeek,
          longestRun: i.longest_run_km ?? p.longestRun,
          volumeSource: i.volume_source ?? p.volumeSource,
        }));
      }
    });
  }, []);

  const set = <K extends keyof Answers>(k: K, v: Answers[K]) => {
    setA((p) => ({ ...p, [k]: v }));
    // Changing an answer clears the complaint about it: a message that outlives
    // the thing it described is worse than no message.
    setProblems((ps) => ps.filter((p) => p.field !== k));
  };

  /**
   * The steps this athlete is actually asked, from lib/intake-steps.ts.
   *
   * Three of the form's steps are composite controls that do not exist yet — a
   * goal picker, a past-race lookup and a start-date-plus-absences calendar.
   * They are filtered out rather than rendered blank: a step that shows nothing
   * is worse than a step that is not there.
   */
  const live = useMemo(
    () => liveSteps(a as unknown as StepAnswers, connected)
      .filter((s2) => !PENDING.has(s2.id)),
    [a, connected],
  );

  if (!opts) return <div style={{ padding: 18 }}><p className="empty">Loading…</p></div>;

  const i = Math.min(step, live.length - 1);
  const s = live[i];
  const id = s.id;
  const q = { kind: s.kind === "gear" ? "chips" : s.kind, q: s.q, sub: subFor(s, a as unknown as StepAnswers), skip: s.skip };

  /**
   * Options come from the step spec, which is the same list the design shows.
   * Equipment is the exception: what is worth offering depends on the
   * discipline, and only the server knows the running-only variant.
   */
  const optionsFor = (): string[] => {
    if (id === "equipment") {
      return a.discipline === "Running race" ? opts.equipment.running : opts.equipment.default;
    }
    /*
     * Divisions are a different list per discipline, not a modifier — and the
     * doubles list is where Mixed lives. The step spec carried a flat solo list,
     * so a doubles athlete was asked to pick between Men and Women and Mixed was
     * missing entirely, even though the loads table has carried
     * "Mixed doubles" -> men's open all along.
     */
    if (id === "division") return [...divisionsFor(a.discipline as never)];
    if (s.opts) return s.opts.map(([label]) => label);
    return s.chips ?? [];
  };
  const subOf = (label: string) => s.opts?.find(([l]) => l === label)?.[1] ?? SUBS[id]?.[label];

  const value = (id === "pace" ? null : (a as unknown as Record<string, unknown>)[id]);
  const ready = filled(s, a as unknown as StepAnswers);
  /** The problems that belong to this step. */
  const here = problems.filter((p) => p.field === s.id);

  /** "Nothing fixed" is not additive — it is the absence of everything else. */
  const toggle = (k: "days" | "commitments" | "equipment", v: string) => {
    const cur = a[k] ?? [];
    if (v === "Nothing fixed") return set(k, cur.includes(v) ? [] : ["Nothing fixed"]);
    const next = (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v])
      .filter((x) => x !== "Nothing fixed");
    set(k, next);
  };

  const pick = (v: string) => {
    // changing discipline clears the answers it invalidates, so a road-race plan
    // can never inherit a doubles split or a Hyrox gym
    if (id === "discipline") {
      setA((p) => ({ ...p, discipline: v, role: v.includes("doubles") ? p.role ?? "Protected" : null,
        division: null, sled: null, equipment: [] }));
      return;
    }
    set(id as keyof Answers, v as never);
  };

  async function resolveAnswers() {
    setBusy(true); setProblems([]);
    const r = await fetch("/api/intake", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(a),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) {
      setProblems(j.problems ?? [{ field: "", why: j.error ?? "That did not resolve." }]);
      /*
       * Jump to the step that is actually wrong.
       *
       * This searched `live` with indexOf for a field name, and `live` became an
       * array of step objects when the flow went data-driven — so it always
       * returned -1 and never moved. The athlete was told at step 24 that step 7
       * was wrong, with nothing naming which step that was.
       */
      const first = j.problems?.[0]?.field;
      const at = live.findIndex((st) => st.id === first);
      if (at > -1) setStep(at);
      return;
    }
    setResolved(j);
    setStage("ready");
  }

  async function commit(benchmark: string) {
    setStage("generating");
    const r = await fetch("/api/intake", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...a, benchmark }),
    });
    const j = await r.json();
    if (!r.ok) {
      setProblems(j.problems ?? [{ field: "", why: j.error ?? "That did not save." }]);
      setStage("questions");
      return;
    }
    setBuilt(j);
    setStage("live");
  }

  // ------------------------------------------------------------------ stages

  if (stage === "generating") {
    return (
      <div style={{ padding: "120px 26px", display: "flex", flexDirection: "column",
        alignItems: "center", gap: 16, textAlign: "center" }}>
        <span style={{ width: 46, height: 46, borderRadius: "50%",
          border: `3px solid ${TEAL_T2}`, borderTopColor: "#0A8FB0",
          animation: "spin 1s linear infinite" }} />
        <span style={{ fontFamily: "var(--display)", fontSize: 21, fontWeight: 700 }}>
          Building your block
        </span>
        <span style={{ fontSize: 13, lineHeight: 1.6, color: INK55 }}>
          Resolving volume, phases and pace targets from your answers.
        </span>
      </div>
    );
  }

  if (stage === "live" && built) return <PlanLive built={built} onStart={onDone} />;
  if (stage === "offer" && resolved) {
    return <Offer resolved={resolved} onAccept={() => commit("scheduled")}
      onSkip={() => commit("skipped")} />;
  }
  if (stage === "ready" && resolved) {
    return <Ready a={a} resolved={resolved} onGenerate={() => setStage("offer")}
      onEdit={() => { setStage("questions"); setStep(0); }} />;
  }

  // ------------------------------------------------------------- the questions

  return (
    <div style={{ padding: "16px 18px 26px", display: "flex", flexDirection: "column",
      gap: 16, minHeight: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => (i === 0 ? onDone() : setStep(i - 1))} style={{
          width: 28, height: 28, flex: "none", borderRadius: "50%", background: OFF,
          border: 0, fontSize: 13, color: INK,
        }}>←</button>
        <div style={{ flex: 1, height: 4, background: OFF, borderRadius: 2, overflow: "hidden" }}>
          <div style={{ height: 4, borderRadius: 2, background: "#0A8FB0",
            width: `${Math.round(((i + 1) / live.length) * 100)}%` }} />
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color: INK40, whiteSpace: "nowrap" }}>
          Step {i + 1} of {live.length}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <span style={{ fontFamily: "var(--display)", fontSize: 25, fontWeight: 700,
          lineHeight: 1.15, letterSpacing: "-.02em" }}>{q.q}</span>
        <span style={{ fontSize: 13, lineHeight: 1.6, color: INK55 }}>{q.sub}</span>
      </div>

      {q.kind === "choice" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {optionsFor().map((o) => {
            const on = value === o;
            const sub = subOf(o);
            return (
              <button key={o} onClick={() => pick(o)} style={{
                width: "100%", textAlign: "left", display: "flex", alignItems: "center",
                gap: 13, padding: "15px 16px", borderRadius: "var(--r-card)", color: INK,
                background: on ? TEAL_T : PAPER, border: `1px solid ${on ? "#0A8FB0" : LINE}`,
              }}>
                <span style={{ width: 20, height: 20, flex: "none", borderRadius: "50%",
                  border: `2px solid ${on ? "#0A8FB0" : "rgba(18,49,77,.22)"}`,
                  background: on ? "#0A8FB0" : "transparent" }} />
                <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{o}</span>
                  {sub && <span style={{ fontSize: 12, lineHeight: 1.45, color: INK55 }}>{sub}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Two shortcuts, because seven taps for "every day" is seven taps. The
          individual chips stay — these only ever set them. */}
      {id === "days" && (
        <div style={{ display: "flex", gap: 6 }}>
          {([["Weekdays", ["Mon", "Tue", "Wed", "Thu", "Fri"]],
             ["Every day", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]]] as const)
            .map(([label, set2]) => {
              const on = set2.length === a.days.length
                && set2.every((d) => a.days.includes(d));
              return (
                <button key={label} onClick={() => set("days", on ? [] : [...set2])}
                  style={{
                    flex: 1, padding: "10px 0", borderRadius: "var(--r-pill)",
                    border: `1px solid ${on ? TEAL : LINE}`, fontSize: 12,
                    fontWeight: 700, background: on ? TEAL_T : PAPER,
                    color: on ? TEAL : INK55,
                  }}>{label}</button>
              );
            })}
        </div>
      )}

      {q.kind === "chips" && (
        <>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {optionsFor().map((o) => {
              const on = ((value as string[]) ?? []).includes(o);
              return (
                <button key={o} onClick={() => toggle(id as "days", o)} style={{
                  padding: "10px 14px", borderRadius: "var(--r-pill)", fontSize: 12,
                  fontWeight: 700, border: `1px solid ${on ? "#0A8FB0" : LINE}`,
                  background: on ? TEAL_T : PAPER, color: on ? "#0A8FB0" : INK55,
                }}>{o}</button>
              );
            })}
          </div>
          {id === "commitments" && a.commitments.filter((c) => c !== "Nothing fixed").length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {a.commitments.filter((c) => c !== "Nothing fixed").map((c) => {
                const n = a.freq[c] ?? 1;
                const picked = a.commitDay[c] ?? [];
                const setDays = (arr: string[]) => set("commitDay", { ...a.commitDay, [c]: arr });
                return (
                  <div key={c} style={{ background: PAPER, border: `1px solid ${LINE}`,
                    borderRadius: "var(--r-card)", padding: "13px 14px",
                    display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{c}</span>
                      <button onClick={() => {
                        const m = Math.max(1, n - 1);
                        set("freq", { ...a.freq, [c]: m });
                        if (picked.length > m) setDays(picked.slice(0, m));
                      }} style={stepBtn}>−</button>
                      <span style={{ fontSize: 12, fontWeight: 700, minWidth: 76, textAlign: "center" }}>
                        {n}× a week
                      </span>
                      <button onClick={() => set("freq", { ...a.freq, [c]: Math.min(7, n + 1) })}
                        style={stepBtn}>+</button>
                    </div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {opts.days.map((d) => {
                        const on = picked.includes(d);
                        const full = !on && picked.length >= n;
                        return (
                          <button key={d} onClick={() => setDays(
                            on ? picked.filter((x) => x !== d)
                              : full ? [...picked.slice(1), d] : [...picked, d],
                          )} style={{
                            padding: "6px 10px", borderRadius: "var(--r-pill)", fontSize: 10,
                            fontWeight: 700, border: `1px solid ${on ? "#0A8FB0" : LINE}`,
                            background: on ? TEAL_T : PAPER,
                            color: on ? "#0A8FB0" : full ? INK40 : INK55,
                          }}>{d}</button>
                        );
                      })}
                    </div>
                    <span style={{ fontSize: 10, color: INK40, lineHeight: 1.45 }}>
                      {picked.length
                        ? picked.length >= n
                          ? `Fixed to ${picked.join(" and ")}`
                          : `${picked.join(" and ")} fixed · ${n - picked.length} placed for you`
                        : "Any day — placed away from your key sessions"}
                    </span>
                  </div>
                );
              })}
              <span style={{ fontSize: 11, lineHeight: 1.5, color: INK40 }}>
                Each session counts at 0.3× aerobic volume and is placed away from your key days.
              </span>
            </div>
          )}
        </>
      )}

      {q.kind === "date" && (
        <Calendar value={a.raceDate} month={calMonth} setMonth={setCalMonth}
          onPick={(d) => set("raceDate", d)} />
      )}

      {q.kind === "time" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ borderRadius: "var(--r-card)", padding: 22, textAlign: "center",
            background: a.paceUnknown ? OFF : PAPER, border: `1px solid ${LINE}` }}>
            <span style={{ fontFamily: "var(--display)", fontWeight: 700, letterSpacing: "-.02em",
              fontSize: a.paceUnknown ? 20 : 42, color: a.paceUnknown ? INK55 : INK }}>
              {a.paceUnknown ? "Test in week 1" : `${a.paceMin}:${String(a.paceSec).padStart(2, "0")}`}
            </span>
          </div>
          {!a.paceUnknown && (
            <div style={{ display: "flex", gap: 6 }}>
              {/*
                * Stepped as one number of seconds, then split for display.
                * Nudging the seconds used to wrap 00 -> 45 within the same
                * minute, so −15 s from 21:00 gave 21:45 — the time went up when
                * the button said down, and minutes could not be reached by
                * pressing seconds.
                */}
              {([["−1 min", -60], ["+1 min", 60], ["−15 s", -15], ["+15 s", 15]] as const)
                .map(([l, d]) => [l, () => {
                  const total = Math.max(12 * 60, Math.min(60 * 60,
                    a.paceMin * 60 + a.paceSec + d));
                  set("paceMin", Math.floor(total / 60));
                  set("paceSec", total % 60);
                }] as const).map(([l, fn]) => (
                <button key={l} onClick={fn} style={{ flex: 1, padding: "12px 0",
                  borderRadius: "var(--r-pill)", border: `1px solid ${LINE}`, background: PAPER,
                  fontSize: 12, fontWeight: 700, color: INK }}>{l}</button>
              ))}
            </div>
          )}
          <button onClick={() => set("paceUnknown", !a.paceUnknown)} style={{
            alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 8,
            background: a.paceUnknown ? TEAL_T : "transparent",
            border: `1px solid ${a.paceUnknown ? "#0A8FB0" : LINE}`,
            borderRadius: "var(--r-pill)", padding: "10px 14px", fontSize: 12, fontWeight: 700,
            color: a.paceUnknown ? "#0A8FB0" : INK55,
          }}>
            <span style={{ width: 16, height: 16, borderRadius: 4,
              border: `2px solid ${a.paceUnknown ? "#0A8FB0" : "rgba(18,49,77,.25)"}`,
              background: a.paceUnknown ? "#0A8FB0" : "transparent" }} />
            {q.skip}
          </button>
          <span style={{ fontSize: 11, lineHeight: 1.5, color: INK40 }}>
            {a.paceUnknown
              ? "Week 1 is a baseline test. Every pace target is written from its result instead."
              : "All pace targets are derived from this."}
          </span>
        </div>
      )}

      {q.kind === "connect" && (
        <IntakeConnect connected={connected}
          onConnect={() => {
            // Strava's callback redirects to a URL and cannot know it was
            // reached from inside the plan builder, so the intent is left here
            // for the shell to pick up on the way back.
            sessionStorage.setItem("split-after-strava", "build");
            location.href = "/api/strava/connect";
          }}
          skipLabel={s.skip ?? ""} onSkip={() => setStep(step + 1)} />
      )}

      {q.kind === "km" && (
        <IntakeKm step={s}
          value={Number((a as unknown as Record<string, unknown>)[id]) || 0}
          unknown={(a as unknown as Record<string, unknown>)[`${id}Unknown`] === true}
          pulled={a.volumeSource === "strava" && Number((a as unknown as Record<string, unknown>)[id]) > 0}
          onChange={(v) => set(id as keyof Answers, v as never)}
          onUnknown={(v) => set(`${id}Unknown` as keyof Answers, v as never)} />
      )}

      {q.kind === "goal" && (
        <IntakeGoal goal={a.goal} minutes={a.goalMin}
          onGoal={(g) => set("goal", g)} onMinutes={(m) => set("goalMin", m)} />
      )}

      {q.kind === "bRaces" && (
        <IntakeBRaces races={a.bRaces} targetDate={a.raceDate}
          onChange={(r) => set("bRaces", r)}
          skipLabel={s.skip ?? ""} onSkip={() => setStep(step + 1)} />
      )}

      {q.kind === "races" && (
        <IntakeRaces races={a.pastRaces} onChange={(r) => set("pastRaces", r)}
          skipLabel={s.skip ?? ""} onSkip={() => setStep(step + 1)} />
      )}

      {q.kind === "start" && (
        <IntakeStart startDate={a.startDate}
          onStart={(d) => set("startDate", d)} />
      )}

      {q.kind === "text" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <textarea rows={5} value={a.injuries} onChange={(e) => set("injuries", e.target.value)}
            placeholder="Old injuries, niggles, anything you are managing…"
            style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 12,
              padding: 14, fontSize: 14, lineHeight: 1.55, resize: "vertical" }} />
          <span style={{ fontSize: 11, color: INK40 }}>
            Read before any volume increase is proposed, and it downgrades the benchmark to the
            submaximal version.
          </span>
        </div>
      )}

      {q.kind === "prefs" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {([["volume", "Training volume", opts.volume],
             ["difficulty", "Difficulty", opts.difficulty]] as const).map(([k, label, list]) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <span style={caps}>{label}</span>
              <div style={{ display: "flex", gap: 3, background: OFF,
                borderRadius: "var(--r-pill)", padding: 3 }}>
                {list.map((o) => {
                  const on = a[k] === o;
                  return (
                    <button key={o} onClick={() => set(k, o)} style={{
                      flex: 1, borderRadius: "var(--r-pill)", padding: "10px 6px", fontSize: 11,
                      fontWeight: 700, background: on ? NAVY : "transparent",
                      color: on ? "#fff" : INK55,
                    }}>{o}</button>
                  );
                })}
              </div>
            </div>
          ))}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {([["Training volume", PREF_TEXT.volume[a.volume]],
               ["Difficulty", PREF_TEXT.difficulty[a.difficulty]]] as const).map(([l, t]) => (
              <div key={l} style={{ background: PAPER, border: `1px solid ${LINE}`,
                borderRadius: "var(--r-card)", padding: "13px 14px",
                display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ ...caps, color: "#0A8FB0" }}>{l}</span>
                <span style={{ fontSize: 12, lineHeight: 1.6, color: INK70 }}>{t}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Only the problems for the step being looked at. A message about the
          division shown under the volume dials is noise, and it was what made
          the end-of-flow error impossible to act on. */}
      {here.length > 0 && (
        <div style={{ fontSize: 11, color: "#8E3521", lineHeight: 1.5 }}>
          {here.map((p) => p.why).join(" ")}
        </div>
      )}
      {here.length === 0 && problems.length > 0 && (
        <button onClick={() => {
          const at = live.findIndex((st) => st.id === problems[0].field);
          if (at > -1) setStep(at);
        }} style={{ fontSize: 11, color: "#8E3521", lineHeight: 1.5, textAlign: "left",
          textDecoration: "underline" }}>
          {problems.length === 1 ? "One answer needs" : `${problems.length} answers need`} another
          look — tap to go back to {problems.length === 1 ? "it" : "the first"}.
        </button>
      )}

      <button
        onClick={() => (i === live.length - 1 ? resolveAnswers() : setStep(i + 1))}
        disabled={!ready || busy}
        style={{
          width: "100%", borderRadius: "var(--r-pill)", padding: 17, fontSize: 12, fontWeight: 800,
          letterSpacing: ".06em", textTransform: "uppercase", border: 0,
          background: !ready || busy ? OFF : LIME,
          color: !ready || busy ? INK40 : "var(--on-lime)",
        }}>
        {busy ? "Resolving…" : i === live.length - 1 ? "See my plan" : "Continue"}
      </button>
    </div>
  );
}

const stepBtn: React.CSSProperties = {
  width: 30, height: 30, flex: "none", borderRadius: "50%", border: `1px solid ${LINE}`,
  background: PAPER, fontSize: 14, fontWeight: 700, color: INK,
};
const caps: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: INK55,
};

/**
 * The race-day calendar.
 *
 * A native date field could not show what the design needs beside the choice:
 * past dates unclickable, and the plan length visible while picking, because
 * "10 weeks from Monday" is the thing the date actually decides.
 */
function Calendar({
  value, month, setMonth, onPick,
}: {
  value: string | null; month: string | null;
  setMonth: (m: string) => void; onPick: (d: string) => void;
}) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const sel = value ? new Date(`${value}T00:00:00`) : today;
  const shown = new Date(`${month ?? `${sel.getFullYear()}-${String(sel.getMonth() + 1).padStart(2, "0")}`}-01T00:00:00`);
  const y = shown.getFullYear(), m = shown.getMonth();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const total = new Date(y, m + 1, 0).getDate();

  const cells: React.ReactNode[] = [];
  for (let k = 0; k < lead; k++) cells.push(<span key={`p${k}`} style={{ padding: "9px 0" }} />);
  for (let d = 1; d <= total; d++) {
    const date = new Date(y, m, d);
    const day = iso(date);
    const on = value === day;
    const past = date < today;
    cells.push(
      <button key={day} onClick={() => !past && onPick(day)} style={{
        padding: "9px 0", borderRadius: 10, border: 0, cursor: past ? "default" : "pointer",
        fontSize: 13, fontWeight: on ? 800 : 600,
        background: on ? "#0A8FB0" : "transparent",
        color: on ? "#fff" : past ? INK40 : INK,
      }}>{d}</button>,
    );
  }
  const step = (delta: number) => () => {
    const d = new Date(y, m + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const weeks = value
    ? Math.max(1, Math.ceil((new Date(`${value}T00:00:00`).getTime() - today.getTime())
        / 604800000))
    : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: "var(--r-card)",
        padding: "14px 14px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <button onClick={step(-1)} style={nav}>‹</button>
          <span style={{ fontFamily: "var(--display)", fontSize: 15, fontWeight: 700 }}>
            {MONTHS[m]} {y}
          </span>
          <button onClick={step(1)} style={nav}>›</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
          {["M", "T", "W", "T", "F", "S", "S"].map((d, k) => (
            <span key={k} style={{ textAlign: "center", fontSize: 9, fontWeight: 800,
              letterSpacing: ".06em", color: INK40, paddingBottom: 4 }}>{d}</span>
          ))}
          {cells}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>
          {value
            ? new Date(`${value}T00:00:00`).toLocaleDateString("en-GB",
                { weekday: "long", day: "numeric", month: "long", year: "numeric" })
            : "Pick a date"}
        </span>
        {value && (
          <span style={{ fontSize: 12, color: "#0A8FB0", fontWeight: 600 }}>
            {weeks} weeks from Monday
          </span>
        )}
      </div>
    </div>
  );
}

const nav: React.CSSProperties = {
  width: 30, height: 30, borderRadius: "50%", border: `1px solid ${LINE}`,
  background: PAPER, fontSize: 13, color: INK,
};

/** The scaffold: what the answers resolve to, before anything is written. */
function Ready({
  a, resolved, onGenerate, onEdit,
}: {
  a: Answers; resolved: Resolved;
  onGenerate: () => void; onEdit: () => void;
}) {
  const { resolved: r, corrections, flags } = resolved;
  const alloc = r.allocation;

  const rows: [string, string][] = [
    ["Plan length", `${r.weeks} weeks · from ${r.start}`],
    ["Phases", `${r.phase_split.join(" / ")} weeks`],
    ["Week 1 volume", `${r.start_km} km${r.start_km !== r.raw_start ? ` (of ${r.raw_start} km)` : ""}`],
    ["Ramp", `${r.ramp}% a week`],
    ["Split", `${alloc.run}% run · ${alloc.station}% station · ${alloc.strength}% strength`],
    ["Pace anchor", r.pace_known ? `5 km in ${a.paceMin}:${String(a.paceSec).padStart(2, "0")}` : "None — week 1 sets it"],
    ["Goal time", r.goal_seconds ? mmss(r.goal_seconds) : "Set after the baseline"],
    ["Training days", a.days.join(", ") || "—"],
  ];

  return (
    <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <span style={{ ...caps, color: "#0A8FB0", letterSpacing: ".1em" }}>{r.weeks} weeks</span>
        <span style={{ fontFamily: "var(--display)", fontSize: 25, fontWeight: 700,
          lineHeight: 1.15, letterSpacing: "-.02em" }}>{a.discipline}</span>
        <span style={{ fontSize: 12, lineHeight: 1.55, color: INK55 }}>
          This is the shape of your plan. Paces and volumes marked conservative firm up once there
          are real numbers behind them.
        </span>
      </div>

      <div style={{ background: PAPER, border: `1px solid ${LINE}`,
        borderRadius: "var(--r-card)", padding: "6px 16px" }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "flex", alignItems: "baseline",
            justifyContent: "space-between", gap: 14, padding: "12px 0",
            borderBottom: `1px solid ${LINE2}` }}>
            <span style={{ fontSize: 12, color: INK55 }}>{k}</span>
            <span style={{ fontSize: 13, fontWeight: 700, textAlign: "right" }}>{v}</span>
          </div>
        ))}
      </div>

      {corrections.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ ...caps }}>What I changed and why</span>
          {corrections.map((c) => (
            <div key={c.title} style={{ background: CREAM, border: `1px solid ${LINE}`,
              borderRadius: "var(--r-card)", padding: "14px 16px",
              display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>{c.title}</span>
              <span style={{ fontSize: 12, lineHeight: 1.6, color: INK70 }}>{c.body}</span>
            </div>
          ))}
        </div>
      )}

      {flags.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {flags.map((f) => (
            <div key={f} style={{ display: "flex", gap: 9, alignItems: "baseline" }}>
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#0A8FB0",
                flex: "none", marginTop: 7 }} />
              <span style={{ fontSize: 12, lineHeight: 1.55, color: INK55 }}>{f}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <button onClick={onGenerate} style={{ width: "100%", background: LIME, border: 0,
          borderRadius: "var(--r-pill)", color: "var(--on-lime)", padding: 17, fontSize: 12,
          fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase" }}>
          Generate my plan
        </button>
        <button onClick={onEdit} style={{ width: "100%", background: "none",
          border: `1px solid ${LINE}`, borderRadius: "var(--r-pill)", color: INK55, padding: 15,
          fontSize: 12, fontWeight: 700 }}>Change my answers</button>
      </div>
    </div>
  );
}

/** The benchmark offer. "Not now" is a first-class button. */
function Offer({
  resolved, onAccept, onSkip,
}: { resolved: Resolved; onAccept: () => void; onSkip: () => void }) {
  const o = resolved.offer;

  return (
    <div style={{ padding: "20px 18px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ ...caps, color: "#0A8FB0", letterSpacing: ".1em" }}>Optional · session 1</span>
        <span style={{ fontFamily: "var(--display)", fontSize: 26, fontWeight: 700,
          lineHeight: 1.12, letterSpacing: "-.02em" }}>Want me to be precise?</span>
        <span style={{ fontSize: 14, lineHeight: 1.6, color: INK70 }}>
          A 25-minute session tells me your running pace, which of your stations will limit you,
          and how you handle fatigue. Your plan gets built from those numbers instead of estimates.
        </span>
      </div>

      <div style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: "var(--r-card)",
        padding: "15px 16px", display: "flex", flexDirection: "column", gap: 11 }}>
        <div style={{ display: "flex", alignItems: "baseline",
          justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>{o.label} · {o.kit}</span>
          <span style={{ fontSize: 11, color: INK55 }}>
            {o.rounds} rounds · about {o.rounds === 3 ? 18 : 25} minutes
          </span>
        </div>
        {o.stations.map((s, k) => (
          <div key={s} style={{ display: "grid", gridTemplateColumns: "26px 1fr", gap: 10,
            alignItems: "center", borderTop: `1px solid ${LINE2}`, paddingTop: 9 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: INK40 }}>R{k + 1}</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>400 m run → {s}</span>
          </div>
        ))}
        <span style={{ fontSize: 11, lineHeight: 1.55, color: INK40 }}>
          Four run splits give a fade curve. That curve is what separates an aerobic limiter from a
          strength one — a single all-out effort cannot.
        </span>
      </div>

      {o.gated && (
        <div style={{ background: CREAM, border: `1px solid ${LINE}`, borderRadius: "var(--r-card)",
          padding: "14px 16px", display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: NAVY }}>Submaximal version</span>
          <span style={{ fontSize: 12, lineHeight: 1.6, color: INK70 }}>
            {o.gate}, so this is the submaximal version: RPE 7 rather than all out, and one round
            fewer.
          </span>
        </div>
      )}

      {o.suppressed && (
        <div style={{ background: CREAM, border: `1px solid ${LINE}`,
          borderRadius: "var(--r-card)", padding: "14px 16px" }}>
          <span style={{ fontSize: 12, lineHeight: 1.6, color: INK70 }}>
            Your race is {o.weeks_to_race} weeks away. Too close to spend a session testing — I am
            generating from your answers.
          </span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <button onClick={o.suppressed ? onSkip : onAccept} style={{ width: "100%", background: LIME,
          border: 0, borderRadius: "var(--r-pill)", color: "var(--on-lime)", padding: 17,
          fontSize: 12, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase" }}>
          {o.suppressed ? "Build it from my answers" : "Schedule it as session 1"}
        </button>
        {!o.suppressed && (
          <button onClick={onSkip} style={{ width: "100%", background: PAPER,
            border: `1px solid ${LINE}`, borderRadius: "var(--r-pill)", color: INK, padding: 16,
            fontSize: 12, fontWeight: 700 }}>Not now</button>
        )}
        <span style={{ fontSize: 11, lineHeight: 1.55, color: INK40, textAlign: "center" }}>
          Skip it and I start you conservatively. The retest is already on week 5 — run it whenever
          and I rebuild from there.
        </span>
      </div>
    </div>
  );
}

/** The generated plan, with its own screen rather than a button on the review. */
function PlanLive({ built, onStart }: { built: Built; onStart: () => void }) {
  const { plan: p, corrections } = built;

  const peak = Math.max(...p.volume.map((v) => v.km), 1);
  const stats: [string, string][] = [
    ["Weeks", String(p.weeks)],
    ["Week 1", `${p.volume[0]?.km ?? 0} km`],
    ["Peak", `${peak} km`],
    ["Total", `${p.total_km} km`],
  ];

  const groups = p.intents.map((it) => ({
    label: it.phase.split(" · ")[0],
    span: `Weeks ${it.from}–${it.to}`,
    total: `${p.volume.slice(it.from - 1, it.to).reduce((n, v) => n + v.km, 0)} km`,
    weeks: p.volume.slice(it.from - 1, it.to).map((v, k) => ({ ...v, n: it.from + k })),
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ background: NAVY, padding: "24px 20px 22px",
        display: "flex", flexDirection: "column", gap: 14 }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".14em",
          textTransform: "uppercase", color: LIME }}>Your plan is live</span>
        <span style={{ fontFamily: "var(--display)", fontSize: 26, fontWeight: 700,
          lineHeight: 1.12, letterSpacing: "-.02em", color: "#fff" }}>{p.name}</span>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,.7)" }}>
          {p.start}{p.race_date ? ` to ${p.race_date}` : ""}
        </span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8,
          borderTop: "1px solid rgba(255,255,255,.16)", paddingTop: 14 }}>
          {stats.map(([k, v]) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".08em",
                textTransform: "uppercase", color: "rgba(255,255,255,.5)" }}>{k}</span>
              <span style={{ fontFamily: "var(--display)", fontSize: 17, fontWeight: 700,
                color: "#fff" }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ background: CREAM, border: `1px solid ${LINE}`, borderRadius: "var(--r-card)",
          padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 13, lineHeight: 1.6, color: INK70 }}>
            {corrections.length
              ? `"${corrections[0].title.charAt(0).toLowerCase()}${corrections[0].title.slice(1)}" is the decision I made for you. Week 1 is a test, not a workout — run it honestly and every pace target after it comes from real numbers rather than a guess.`
              : "Week 1 is a test, not a workout. Run it honestly and every pace target after it comes from real numbers rather than a guess."}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={caps}>How the block runs</span>
          {p.intents.map((it) => (
            <div key={it.from} style={{ display: "flex", gap: 11, alignItems: "flex-start",
              background: PAPER, border: `1px solid ${LINE}`, borderRadius: "var(--r-card)",
              padding: "14px 16px" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", flex: "none",
                marginTop: 6, background: "#0A8FB0" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{it.phase}</span>
                <span style={{ fontSize: 12, lineHeight: 1.55, color: INK55 }}>{it.purpose}</span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={caps}>Every week</span>
          {groups.map((g) => (
            <div key={g.label + g.span} style={{ background: PAPER, border: `1px solid ${LINE}`,
              borderRadius: "var(--r-card)", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "baseline",
                justifyContent: "space-between", gap: 10, padding: "12px 14px", background: OFF }}>
                <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".04em" }}>{g.label}</span>
                <span style={{ fontSize: 10, color: INK55 }}>{g.span} · {g.total}</span>
              </div>
              <div style={{ padding: "4px 14px 10px" }}>
                {g.weeks.map((w) => {
                  const milestone = /benchmark/i.test(w.note);
                  const easy = /down|taper|race week/i.test(w.note);
                  return (
                    <div key={w.n} style={{ display: "flex", alignItems: "center", gap: 10,
                      padding: "9px 0", borderBottom: `1px solid ${LINE2}` }}>
                      <span style={{ width: 22, flex: "none", fontFamily: "var(--display)",
                        fontSize: 13, fontWeight: 700,
                        color: milestone ? "#0A8FB0" : INK40 }}>{w.n}</span>
                      <span style={{ display: "flex", flexDirection: "column", gap: 5,
                        flex: 1, minWidth: 0 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ flex: 1, height: 8, background: OFF, borderRadius: 4,
                            overflow: "hidden" }}>
                            <span style={{ display: "block", height: 8, borderRadius: 4,
                              background: milestone ? "#AAEA42" : easy ? "rgba(18,49,77,.22)" : "#0A8FB0",
                              width: `${Math.max(8, Math.min(100, (w.km / peak) * 100))}%` }} />
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 700, width: 48,
                            flex: "none", textAlign: "right" }}>{w.km} km</span>
                        </span>
                        {w.note && (
                          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".04em",
                            padding: "3px 8px", borderRadius: "var(--r-pill)",
                            alignSelf: "flex-start",
                            background: milestone ? LIME : easy ? OFF : TEAL_T,
                            color: milestone ? "var(--on-lime)" : easy ? INK55 : "#0A8FB0" }}>
                            {w.note}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <button onClick={onStart} style={{ width: "100%", background: LIME, border: 0,
          borderRadius: "var(--r-pill)", color: "var(--on-lime)", padding: 17, fontSize: 12,
          fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase" }}>
          Start week 1
        </button>
      </div>
    </div>
  );
}
