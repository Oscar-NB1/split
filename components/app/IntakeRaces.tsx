"use client";
import { useState } from "react";

const TEAL = "#0A8FB0", TEAL_T = "var(--teal-tint)";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const LINE = "var(--line)", PAPER = "var(--paper)";

export type PastRace = {
  event: string;
  division: string | null;
  finish: string;
  /** average of the eight run splits, mm:ss */
  run_avg: string;
  /** the eight stations added up, mm:ss */
  stations: string;
  /** total time in the roxzone, mm:ss */
  rox: string;
};

const EMPTY: PastRace = {
  event: "", division: null, finish: "", run_avg: "", stations: "", rox: "",
};

/** mm:ss or h:mm:ss, and nothing else — a race time is not free text. */
const looksLikeTime = (v: string) => /^\d{1,2}:[0-5]\d(:[0-5]\d)?$/.test(v.trim());

/**
 * Races already run, typed in.
 *
 * Not a lookup. Official results live behind mikatiming with no sanctioned way
 * to query them, and a screen that takes an event name and then guesses at
 * splits is worse than one that asks. So it asks — and what it asks for is the
 * three numbers that decide the block.
 *
 * Roxzone is the reason this step exists. Nothing in training measures the time
 * between finishing a station and starting the next run: not a benchmark, not a
 * key session, not a simulation in a gym. A previous race is the only place it
 * has ever been recorded, and without it the race planner falls back to a field
 * median it has to label as an estimate.
 */
export default function IntakeRaces({
  races, onChange, skipLabel, onSkip,
}: {
  races: PastRace[];
  onChange: (r: PastRace[]) => void;
  skipLabel: string;
  onSkip: () => void;
}) {
  const [draft, setDraft] = useState<PastRace | null>(null);

  const set = <K extends keyof PastRace>(k: K, v: PastRace[K]) =>
    setDraft((d) => ({ ...(d ?? EMPTY), [k]: v }));

  const complete = draft
    && draft.event.trim().length > 1
    && [draft.finish, draft.run_avg, draft.stations, draft.rox].every(looksLikeTime);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {races.map((r, i) => (
        <div key={i} style={{
          background: PAPER, border: `1px solid ${LINE}`, borderRadius: "var(--r-card)",
          padding: "13px 14px", display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{r.event}</span>
            <span style={{ fontSize: 11, color: INK55 }}>
              {r.finish} · runs {r.run_avg} /km · stations {r.stations} · roxzone {r.rox}
            </span>
          </span>
          <button onClick={() => onChange(races.filter((_, n) => n !== i))}
            style={{ background: "none", border: 0, padding: 0, fontSize: 11,
              fontWeight: 700, color: INK40 }}>Remove</button>
        </div>
      ))}

      {draft === null ? (
        <>
          <button onClick={() => setDraft(EMPTY)} style={{
            width: "100%", background: PAPER, border: `1px dashed ${TEAL}`,
            borderRadius: "var(--r-pill)", padding: 14, fontSize: 12, fontWeight: 800,
            letterSpacing: ".06em", textTransform: "uppercase", color: TEAL,
          }}>Add a race result</button>
          {races.length === 0 && skipLabel && (
            <button onClick={onSkip} style={{
              width: "100%", background: PAPER, border: `1px solid ${LINE}`,
              borderRadius: "var(--r-pill)", padding: 13, fontSize: 12,
              fontWeight: 600, color: INK55,
            }}>{skipLabel}</button>
          )}
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9,
          background: PAPER, border: `1px solid ${TEAL}`,
          borderRadius: "var(--r-card)", padding: 14 }}>
          <Field label="Event" placeholder="Hyrox Amsterdam 2026" value={draft.event}
            onChange={(v) => set("event", v)} />
          <div style={{ display: "flex", gap: 8 }}>
            <Field label="Finish" placeholder="1:02:45" value={draft.finish}
              onChange={(v) => set("finish", v)} />
            <Field label="Avg run /km" placeholder="4:41" value={draft.run_avg}
              onChange={(v) => set("run_avg", v)} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Field label="Stations total" placeholder="22:10" value={draft.stations}
              onChange={(v) => set("stations", v)} />
            <Field label="Roxzone total" placeholder="5:38" value={draft.rox}
              onChange={(v) => set("rox", v)} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { onChange([...races, draft]); setDraft(null); }}
              disabled={!complete} style={{
                flex: 1, background: complete ? TEAL_T : "var(--off)",
                border: `1px solid ${complete ? TEAL : LINE}`,
                borderRadius: "var(--r-pill)", padding: 12, fontSize: 12,
                fontWeight: 700, color: complete ? TEAL : INK40,
              }}>Save this race</button>
            <button onClick={() => setDraft(null)} style={{
              background: "none", border: 0, padding: "0 10px", fontSize: 12,
              fontWeight: 600, color: INK55,
            }}>Cancel</button>
          </div>
        </div>
      )}

      <span style={{ fontSize: 11, lineHeight: 1.55, color: INK55 }}>
        Average run split, station total and roxzone are the three numbers that
        decide what this block trains. Roxzone — the time between finishing a
        station and starting the next run — is recorded nowhere else, and it is
        usually where a minute and a half is sitting.
      </span>
    </div>
  );
}

function Field({
  label, value, placeholder, onChange,
}: {
  label: string; value: string; placeholder: string; onChange: (v: string) => void;
}) {
  const bad = value.trim().length > 0 && label !== "Event" && !looksLikeTime(value);
  return (
    <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".08em",
        textTransform: "uppercase", color: INK55 }}>{label}</span>
      <input value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{ background: "var(--off)", borderRadius: 10, fontSize: 14,
          padding: "10px 11px", border: `1px solid ${bad ? "#C07A3E" : LINE}` }} />
    </label>
  );
}
