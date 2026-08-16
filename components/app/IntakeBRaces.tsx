"use client";
import { useState } from "react";
import { fmt, iso } from "@/lib/dates";
import { divisionsFor } from "@/lib/intake";
import {
  B_KINDS, INTENTS, INTENT_COST, intentOptions, kindHasDivision, tooClose,
  type BKind, type Intent,
} from "@/lib/race/brace";

const TEAL = "#0A8FB0", TEAL_T = "var(--teal-tint)";
const GOLD = "#8A6D14", GOLD_T = "rgba(232,192,81,.14)";
const INK = "var(--ink)", INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const LINE = "var(--line)", PAPER = "var(--paper)", OFF = "var(--off)";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

export type BRace = {
  date: string; kind: BKind | null; division: string | null; intent: Intent;
};

/**
 * Races between now and the target.
 *
 * Two screens in one: the list of what is entered, and the editor for one race.
 * The list leads with the target so a second race is always read against the race
 * it is a second race to — the same reason the intent question sits under the date
 * rather than beside it.
 *
 * Each one costs training time, and how much depends on what the athlete wants
 * from it, so the intent is asked rather than assumed and the cost is shown next
 * to the choice. An intent the gap cannot afford stays visible and says why: an
 * athlete who wanted to race it should know what it would have cost.
 *
 * The gating is not duplicated. `intentOptions` from lib/race/brace.ts decides
 * what a gap can afford and this renders what it returns — two copies of a rule
 * is one copy too many, and this is the copy that would drift.
 */
export default function IntakeBRaces({
  races, targetDate, targetLabel, onChange, skipLabel, onSkip,
}: {
  races: BRace[];
  /** the target race; without one there is no gap to gate against */
  targetDate: string | null;
  /** what the target is, for the card the list leads with */
  targetLabel: string;
  onChange: (r: BRace[]) => void;
  skipLabel: string;
  onSkip: () => void;
}) {
  /** which race is open in the editor: an index, "new", or nothing */
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<BRace>(blank());
  const [month, setMonth] = useState<string | null>(null);

  if (!targetDate) {
    return (
      <span style={{ fontSize: 12, lineHeight: 1.6, color: INK55 }}>
        Set your target race first and this will know what a second one costs.
      </span>
    );
  }

  const openNew = () => { setDraft(blank()); setMonth(null); setEditing("new"); };
  const openRow = (i: number) => {
    setDraft(races[i]); setMonth(races[i].date.slice(0, 7)); setEditing(i);
  };
  const close = () => { setEditing(null); setDraft(blank()); };

  if (editing !== null) {
    const hasDate = !!draft.date;
    const tooLate = hasDate && draft.date >= targetDate
      ? "That is on or after your target race. A race after the one you are training for belongs in the next block."
      : null;
    const clash = races.find((r, i) =>
      i !== editing && hasDate && tooClose(r.date, draft.date));
    const opts = hasDate && !tooLate ? intentOptions(draft.date, targetDate) : null;
    const divisions = kindHasDivision(draft.kind)
      ? divisionsFor(draft.kind === "Hyrox doubles" ? "Hyrox doubles" : "Hyrox singles")
      : [];
    const ready = hasDate && !tooLate && !clash && !!draft.kind
      && (!divisions.length || !!draft.division)
      && !!opts?.allowed.includes(draft.intent);

    const save = () => {
      const next = [...races];
      if (editing === "new") next.push(draft); else next[editing] = draft;
      next.sort((x, y) => x.date.localeCompare(y.date));
      onChange(next);
      close();
    };

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Date">
          <div style={{ background: PAPER, border: `1px solid ${LINE}`,
            borderRadius: "var(--r-card)", padding: "12px 12px 8px",
            display: "flex", flexDirection: "column", gap: 8 }}>
            <Month value={draft.date} month={month} setMonth={setMonth}
              max={targetDate}
              onPick={(d) => setDraft({ ...draft, date: d })} />
          </div>
          {opts && (
            <span style={{ fontSize: 11, color: TEAL, fontWeight: 700 }}>
              {opts.gap_weeks} weeks before your target race.
            </span>
          )}
        </Field>

        <Field label="What is it">
          <Chips options={[...B_KINDS]} value={draft.kind}
            onPick={(k) => setDraft({
              ...draft, kind: k as BKind,
              // A division from the other discipline is not a division here.
              division: kindHasDivision(k as BKind) ? draft.division : null,
            })} />
        </Field>

        {divisions.length > 0 && (
          <Field label="Division">
            <Chips options={[...divisions]} value={draft.division}
              onPick={(d) => setDraft({ ...draft, division: d })} />
          </Field>
        )}

        {hasDate && (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <span style={caps}>What is this one to you?</span>

            {tooLate && <Warn>{tooLate}</Warn>}
            {!tooLate && clash && (
              <Warn>
                You already have a race on{" "}
                {fmt(clash.date, { day: "numeric", month: "short" })}, which is
                inside five days of this one.
              </Warn>
            )}
            {opts?.warning && <Warn>{opts.warning}</Warn>}

            {INTENTS.map((i) => {
              const locked = !opts?.allowed.includes(i);
              const on = draft.intent === i && !locked;
              const reason = opts?.blocked.find((b) => b.intent === i)?.reason;
              return (
                <button key={i} disabled={locked}
                  onClick={() => setDraft({ ...draft, intent: i })}
                  style={{
                    width: "100%", textAlign: "left", padding: "12px 13px",
                    borderRadius: "var(--r-card)", display: "flex",
                    flexDirection: "column", gap: 4,
                    border: `1px solid ${on ? TEAL : LINE}`,
                    background: on ? TEAL_T : locked ? OFF : PAPER,
                  }}>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                    <span style={{ fontSize: 13, fontWeight: 700,
                      textTransform: "capitalize",
                      color: locked ? INK55 : INK }}>{i}</span>
                    {locked && <span style={{ fontSize: 10, color: INK40 }}>locked</span>}
                  </span>
                  <span style={{ fontSize: 11, lineHeight: 1.5, color: INK55 }}>
                    Before: {INTENT_COST[i].before}. After: {INTENT_COST[i].after}.
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 700,
                    color: locked ? INK40 : TEAL,
                  }}>Costs {INTENT_COST[i].cost}</span>
                  {locked && reason && (
                    <span style={{ fontSize: 11, lineHeight: 1.5, color: INK40 }}>
                      {reason}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={close} style={{
            flex: "none", background: "none", border: `1px solid ${LINE}`,
            borderRadius: "var(--r-pill)", padding: "14px 16px", fontSize: 11,
            fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
            color: INK55,
          }}>Cancel</button>
          <button onClick={save} disabled={!ready} style={{
            flex: 1, border: 0, borderRadius: "var(--r-pill)", padding: 14,
            fontSize: 11, fontWeight: 800, letterSpacing: ".06em",
            textTransform: "uppercase",
            background: ready ? "var(--lime)" : OFF,
            color: ready ? "var(--on-lime)" : INK40,
          }}>Save race</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={caps}>Your races</span>

      <div style={{ background: PAPER, border: `1px solid ${TEAL}`,
        borderRadius: "var(--r-card)", padding: "14px 15px",
        display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{targetLabel}</span>
          <span style={{ fontSize: 11, color: INK55 }}>
            {fmt(targetDate, { weekday: "short", day: "numeric", month: "long" })}
          </span>
        </span>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".08em",
          textTransform: "uppercase", background: TEAL_T, color: TEAL,
          borderRadius: "var(--r-pill)", padding: "4px 9px" }}>Target</span>
      </div>

      {races.map((r, i) => (
        <div key={`${r.date}-${i}`} style={{ background: PAPER,
          border: `1px solid ${LINE}`, borderRadius: "var(--r-card)",
          padding: "14px 15px", display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => openRow(i)} style={{ flex: 1, textAlign: "left",
            display: "flex", flexDirection: "column", gap: 2, color: INK }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              {r.kind ?? "Race"}
              {r.division ? ` · ${r.division}` : ""}
            </span>
            <span style={{ fontSize: 11, color: INK55 }}>
              {fmt(r.date, { day: "numeric", month: "long" })} ·{" "}
              {gapOf(r.date, targetDate)} weeks out · {r.intent} ·{" "}
              costs {INTENT_COST[r.intent].cost}
            </span>
          </button>
          <button onClick={() => onChange(races.filter((_, n) => n !== i))}
            aria-label="Remove this race" style={{
              flex: "none", width: 24, height: 24, borderRadius: "50%",
              border: `1px solid ${LINE}`, background: PAPER, color: INK40,
              fontSize: 10,
            }}>✕</button>
        </div>
      ))}

      <button onClick={openNew} style={{
        width: "100%", background: "none", border: `1px dashed ${LINE}`,
        borderRadius: "var(--r-card)", padding: 14, fontSize: 12,
        fontWeight: 700, color: TEAL,
      }}>+ Add another race</button>

      <span style={{ fontSize: 11, lineHeight: 1.55, color: INK40 }}>
        {races.length
          ? "Each of these is built into the plan — the week before and the week after both change."
          : "Only races you have actually entered. Something you might do is not a race the plan should be built around."}
      </span>

      {races.length === 0 && skipLabel && (
        <button onClick={onSkip} style={{
          width: "100%", background: PAPER, border: `1px solid ${LINE}`,
          borderRadius: "var(--r-pill)", padding: 13, fontSize: 12,
          fontWeight: 600, color: INK55,
        }}>{skipLabel}</button>
      )}
    </div>
  );
}

const blank = (): BRace =>
  ({ date: "", kind: null, division: null, intent: "training" });

const gapOf = (secondary: string, target: string) =>
  Math.round(((Date.parse(`${target}T00:00:00Z`)
    - Date.parse(`${secondary}T00:00:00Z`)) / 604_800_000) * 10) / 10;

const caps: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: ".1em",
  textTransform: "uppercase", color: INK55,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={caps}>{label}</span>
      {children}
    </div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 12, lineHeight: 1.55, color: GOLD,
      background: GOLD_T, borderRadius: 10, padding: "11px 12px" }}>
      {children}
    </span>
  );
}

function Chips({ options, value, onPick }: {
  options: string[]; value: string | null; onPick: (o: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((o) => {
        const on = value === o;
        return (
          <button key={o} onClick={() => onPick(o)} style={{
            padding: "9px 13px", borderRadius: "var(--r-pill)", fontSize: 12,
            fontWeight: 700,
            border: `1px solid ${on ? TEAL : LINE}`,
            background: on ? TEAL : PAPER,
            color: on ? "#fff" : INK,
          }}>{o}</button>
        );
      })}
    </div>
  );
}

/**
 * The month grid.
 *
 * A native date field cannot show the two things that matter while picking: that
 * days after the target are not available, and that today is behind you.
 */
function Month({ value, month, setMonth, max, onPick }: {
  value: string; month: string | null; setMonth: (m: string) => void;
  max: string; onPick: (d: string) => void;
}) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const anchor = value ? new Date(`${value}T00:00:00`) : today;
  const shown = new Date(`${month
    ?? `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}`}-01T00:00:00`);
  const y = shown.getFullYear(), m = shown.getMonth();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const total = new Date(y, m + 1, 0).getDate();

  const cells: React.ReactNode[] = [];
  for (let k = 0; k < lead; k++) cells.push(<span key={`p${k}`} style={{ padding: "8px 0" }} />);
  for (let d = 1; d <= total; d++) {
    const day = iso(new Date(y, m, d));
    const on = value === day;
    const off = day < iso(today) || day >= max;
    cells.push(
      <button key={day} onClick={() => !off && onPick(day)} disabled={off} style={{
        padding: "8px 0", borderRadius: 10, border: 0, fontSize: 13,
        fontWeight: on ? 800 : 600,
        background: on ? TEAL : "transparent",
        color: on ? "#fff" : off ? INK40 : INK,
        opacity: off ? .45 : 1,
      }}>{d}</button>,
    );
  }
  const shift = (delta: number) => () => {
    const d = new Date(y, m + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: 10 }}>
        <button onClick={shift(-1)} aria-label="Earlier month" style={nav}>‹</button>
        <span style={{ fontFamily: "var(--display)", fontSize: 14, fontWeight: 700 }}>
          {MONTHS[m]} {y}
        </span>
        <button onClick={shift(1)} aria-label="Later month" style={nav}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, k) => (
          <span key={k} style={{ textAlign: "center", fontSize: 9, fontWeight: 800,
            color: INK40, paddingBottom: 3 }}>{d}</span>
        ))}
        {cells}
      </div>
    </>
  );
}

const nav: React.CSSProperties = {
  width: 28, height: 28, borderRadius: "50%", border: `1px solid ${LINE}`,
  background: PAPER, fontSize: 13, color: INK55,
};
