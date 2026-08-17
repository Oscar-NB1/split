"use client";
import { useEffect, useState } from "react";
import { fmt } from "@/lib/dates";
import type { Change, Reading, Severity } from "@/lib/plan/findings";

const TEAL = "#0A8FB0", LIME = "#C6FF5B", GOLD = "#E8C051";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)", INK70 = "var(--ink-70)";
const LINE = "var(--line)", PAPER = "var(--paper)", NAVY = "var(--navy)";

const DOT: Record<Severity, string> = { good: LIME, neutral: TEAL, attention: GOLD };

export type Attempt = {
  id: string; completed_at: string; variant: string; submaximal: boolean;
  aborted: boolean; label: string;
  rounds: { run_s: number; distance_m?: number; station_s?: number }[];
  readings: Reading[];
  changes: Change[];
  applied: boolean;
};

/**
 * What the test found, and what it changed.
 *
 * Two halves, and the order between them is the point: the findings are what
 * the athlete did, the changes are what the plan did about it. Showing the
 * changes first would make the plan the subject, and then a number moving is
 * something that happened to them rather than something they caused.
 */
export default function Bench({ athleteId }: { athleteId?: string }) {
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [at, setAt] = useState(0);
  const [openFinding, setOpenFinding] = useState<number | null>(null);
  const [openChange, setOpenChange] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const url = `/api/benchmarks${athleteId ? `?athlete=${athleteId}` : ""}`;
  const [rounds, setRounds] = useState(0);
  useEffect(() => {
    fetch(url).then(async (r) => {
      const j = r.ok ? await r.json() : { attempts: [] };
      setAttempts(j.attempts ?? []);
      setRounds(j.protocol?.legs ? Math.round(j.protocol.legs.length / 2) : 4);
    });
  }, [url]);

  if (!attempts) return null;
  /* A coach reads results; they do not log them. */
  const mine = !athleteId;

  if (attempts.length === 0) {
    return (
      <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 14 }}>
        <span style={{ fontFamily: "var(--display)", fontSize: 24, fontWeight: 700,
          lineHeight: 1.15, letterSpacing: "-.02em" }}>No test logged yet</span>
        <span style={{ fontSize: 13, lineHeight: 1.6, color: INK55 }}>
          A benchmark is optional and offered once, at the start of a block. Without
          one the volume is unchanged — it comes from what you said about your
          training and your running — but the paces are worked out from your answers
          rather than measured, and they are labelled that way wherever they appear.
        </span>
        {mine && <LogTest rounds={rounds} url={url}
          onSaved={(a) => setAttempts(a)} />}
      </div>
    );
  }

  const a = attempts[Math.min(at, attempts.length - 1)];
  const shown = all ? a.readings : a.readings.slice(0, 4);
  const runs = a.rounds.map((r) => r.run_s);
  const best = Math.min(...runs), worst = Math.max(...runs);

  async function apply() {
    setBusy(true);
    const r = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "apply", id: a.id }),
    });
    setBusy(false);
    if (r.ok) setAttempts((await r.json()).attempts);
  }

  return (
    <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ ...caps, color: TEAL }}>
            {a.submaximal ? "Submaximal" : a.aborted ? "Stopped early" : "Full test"}
          </span>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em",
            textTransform: "uppercase", color: INK40 }}>{a.variant}</span>
        </div>
        <span style={{ fontFamily: "var(--display)", fontSize: 25, fontWeight: 700,
          lineHeight: 1.15, letterSpacing: "-.02em" }}>Benchmark results</span>
        <span style={{ fontSize: 12, color: INK55 }}>
          {fmt(a.completed_at.slice(0, 10), { day: "numeric", month: "long", year: "numeric" })}
        </span>
      </div>

      {attempts.length > 1 && (
        <div style={{ display: "flex", gap: 3, background: "var(--off)",
          borderRadius: "var(--r-pill)", padding: 3 }}>
          {attempts.map((x, i) => (
            <button key={x.id} onClick={() => { setAt(i); setOpenFinding(null); setOpenChange(null); }}
              style={{
                flex: 1, borderRadius: "var(--r-pill)", padding: "9px 12px", fontSize: 11,
                fontWeight: 700, background: i === at ? "#12314D" : "transparent",
                color: i === at ? "#fff" : INK55,
              }}>{x.label}</button>
          ))}
        </div>
      )}

      {/* The rounds, as they were run. A bar per round rather than a line,
          because four points is not a curve and drawing one implies a trend
          that four numbers cannot support. */}
      <div style={{ background: NAVY, borderRadius: "var(--r-card)", padding: "18px 18px 16px",
        display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 96 }}>
          {a.rounds.map((r, i) => {
            const h = worst === best ? 100 : 42 + ((worst - r.run_s) / (worst - best)) * 58;
            return (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column",
                justifyContent: "flex-end", gap: 6, height: "100%" }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", textAlign: "center" }}>
                  {mmss(r.run_s)}
                </span>
                <div style={{ height: `${h}%`, borderRadius: 6,
                  background: r.run_s === best ? LIME : "rgba(255,255,255,.34)" }} />
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".06em",
                  color: "rgba(255,255,255,.6)", textAlign: "center" }}>R{i + 1}</span>
              </div>
            );
          })}
        </div>
        <span style={{ fontSize: 12, lineHeight: 1.5, color: "rgba(255,255,255,.7)" }}>
          Lime is the quickest round. The shape across the four is the finding —
          a single fast one says less than four that hold together.
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <span style={caps}>What it found</span>
        {shown.map((f, i) => (
          <button key={f.dim} onClick={() => setOpenFinding(openFinding === i ? null : i)}
            style={{
              width: "100%", textAlign: "left", background: PAPER, border: `1px solid ${LINE}`,
              borderRadius: "var(--r-card)", padding: "14px 16px", color: "var(--ink)",
              display: "flex", flexDirection: "column", gap: 6,
            }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: 3, background: DOT[f.severity] }} />
              <span style={{ ...caps, fontSize: 10, flex: 1 }}>{f.dim} · {f.band}</span>
              <span style={{ fontSize: 13, color: INK40 }}>›</span>
            </span>
            <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35 }}>{f.headline}</span>
            {openFinding === i && (
              <span style={{ display: "flex", flexDirection: "column", gap: 7, paddingTop: 3 }}>
                <span style={{ fontSize: 12, lineHeight: 1.6, color: INK70 }}>{f.body}</span>
                <span style={{ fontSize: 11, lineHeight: 1.55, color: TEAL, fontWeight: 600 }}>
                  {f.effect}
                </span>
              </span>
            )}
          </button>
        ))}
        {a.readings.length > 4 && (
          <button onClick={() => setAll(!all)} style={{
            width: "100%", background: "none", border: `1px solid ${LINE}`,
            borderRadius: "var(--r-pill)", padding: 13, fontSize: 11, fontWeight: 700,
            letterSpacing: ".06em", textTransform: "uppercase", color: INK55,
          }}>{all ? "Show fewer" : `All ${a.readings.length} findings`}</button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
          <span style={caps}>What changed in your plan</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: a.changes.length ? TEAL : INK40 }}>
            {a.changes.length === 0 ? "Nothing" : `${a.changes.length} line${a.changes.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {a.changes.length === 0 && (
          <span style={{ fontSize: 12, lineHeight: 1.6, color: INK55 }}>
            The test confirmed what the plan already assumed, so nothing moved. That
            is a result, not a failure to find one.
          </span>
        )}

        {a.changes.map((c, i) => (
          <div key={c.label} style={{ display: "flex", flexDirection: "column" }}>
            <button onClick={() => setOpenChange(openChange === i ? null : i)} style={{
              width: "100%", background: PAPER, border: `1px solid ${LINE}`,
              borderRadius: openChange === i ? "var(--r-card) var(--r-card) 0 0" : "var(--r-card)",
              padding: "13px 16px", color: "var(--ink)",
              display: "flex", alignItems: "center", gap: 9,
            }}>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 600, textAlign: "left" }}>
                {c.label}
              </span>
              <span style={{ fontSize: 12, color: INK40, textDecoration: "line-through" }}>
                {c.before}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: TEAL }}>{c.after}</span>
              <span style={{ fontSize: 12, color: INK40 }}>›</span>
            </button>
            {openChange === i && (
              <div style={{ background: "var(--off)", border: `1px solid ${LINE}`, borderTop: 0,
                borderRadius: "0 0 var(--r-card) var(--r-card)", padding: "13px 16px",
                display: "flex", flexDirection: "column", gap: 6 }}>
                {/*
                  * The band and the headline only where a reading produced them.
                  *
                  * Not every line that moves has a finding behind it: easy pace follows from
                  * measured speed, and the Recovery reading it is filed under needs heart-rate
                  * data that a hand-timed test does not have. Rendered unconditionally it read
                  * "Because · Recovery —" above an empty line, which is worse than the rule on
                  * its own.
                  */}
                <span style={{ ...caps, fontSize: 9, color: TEAL }}>
                  Because · {c.dim}{c.band && c.band !== "—" ? ` ${c.band}` : ""}
                </span>
                {c.headline && (
                  <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.45 }}>
                    {c.headline}
                  </span>
                )}
                <span style={{ fontSize: 12, lineHeight: 1.6, color: INK70 }}>{c.rule}</span>
                <span style={{ fontSize: 11, lineHeight: 1.55, color: INK55 }}>
                  In training · {c.feel}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {mine && <LogTest rounds={rounds} url={url} onSaved={(x) => { setAttempts(x); setAt(x.length - 1); }} />}

      {a.changes.length > 0 && (
        <>
          <button onClick={apply} disabled={busy || a.applied} style={{
            width: "100%", background: a.applied ? "var(--off)" : LIME, border: 0,
            borderRadius: "var(--r-pill)", color: a.applied ? INK55 : "#12314D",
            padding: 16, fontSize: 12, fontWeight: 800, letterSpacing: ".06em",
            textTransform: "uppercase",
          }}>{a.applied ? "Applied to the block" : "Apply to the block"}</button>
          <span style={{ fontSize: 11, lineHeight: 1.55, color: INK55 }}>
            Weeks you have already trained are left as they were. Only the ones
            ahead of you are rewritten.
          </span>
        </>
      )}
    </div>
  );
}

/**
 * Logging a test, by hand.
 *
 * The preflight page has always promised this — "every number below can be recorded by hand"
 * — and there was no way to do it: no screen wrote a benchmark, and the table had never held
 * a row. Four run times is the whole measurement, because fade across the rounds is what
 * changes the plan; the station times are taken where somebody has them and left alone where
 * they do not, since a missing station time costs one finding and a guessed one corrupts
 * three.
 *
 * mm:ss, because that is how a stopwatch reads and asking somebody to convert 1:47 into 107
 * is asking them to make a mistake.
 */
function LogTest({ rounds, url, onSaved }: {
  rounds: number; url: string; onSaved: (attempts: Attempt[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<string[]>(() => Array(rounds || 4).fill(""));
  const [stations, setStations] = useState<string[]>(() => Array(rounds || 4).fill(""));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const parsed = runs.map(secondsOf);
  const enough = parsed.filter((n) => n != null).length >= 2;

  async function save() {
    setBusy(true); setErr(null); setProblems([]);
    const body = {
      action: "record",
      rounds: parsed.map((run, i) => ({
        run_s: run, station_s: secondsOf(stations[i]) ?? undefined,
      })).filter((r) => r.run_s != null),
    };
    const r = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error ?? "That did not save."); return; }
    setProblems(j.problems ?? []);
    setOpen(false);
    onSaved(j.attempts ?? []);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{
        width: "100%", background: "none", border: `1px solid ${LINE}`,
        borderRadius: "var(--r-pill)", padding: 14, fontSize: 11, fontWeight: 700,
        letterSpacing: ".06em", textTransform: "uppercase", color: INK55,
      }}>Log a test I have done</button>
    );
  }

  return (
    <div style={{ border: `1px solid ${TEAL}`, borderRadius: "var(--r-card)",
      padding: "15px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={{ fontSize: 14, fontWeight: 700 }}>Your four rounds</span>
      <span style={{ fontSize: 11.5, lineHeight: 1.55, color: INK55 }}>
        The run time from each round, as mm:ss. Station times if you have them — they add a
        finding, and a guess at them would take three away.
      </span>

      <div style={{ display: "grid", gridTemplateColumns: "26px 1fr 1fr", gap: 7,
        alignItems: "center" }}>
        <span />
        <span style={{ ...caps, fontSize: 9 }}>Run</span>
        <span style={{ ...caps, fontSize: 9 }}>Station</span>
        {runs.map((v, i) => (
          <Row key={i} n={i + 1} run={v} station={stations[i]}
            onRun={(x) => setRuns(runs.map((y, j) => (j === i ? x : y)))}
            onStation={(x) => setStations(stations.map((y, j) => (j === i ? x : y)))} />
        ))}
      </div>

      {err && <div className="errbox" role="alert">{err}</div>}
      {problems.map((pb) => (
        <span key={pb} style={{ fontSize: 11.5, color: GOLD, lineHeight: 1.5 }}>{pb}</span>
      ))}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => setOpen(false)} style={{ padding: "12px 14px", fontSize: 12,
          fontWeight: 700, color: INK55 }}>Cancel</button>
        <button onClick={save} disabled={!enough || busy} style={{
          flex: 1, background: enough ? LIME : "var(--off)", border: 0,
          borderRadius: "var(--r-pill)", color: enough ? "#12314D" : INK55, padding: 13,
          fontSize: 12, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
          opacity: busy ? .6 : 1,
        }}>{busy ? "Reading it…" : "Save the test"}</button>
      </div>
      <span style={{ fontSize: 11, color: INK40, lineHeight: 1.5 }}>
        Nothing changes in your plan until you have seen what it would do and agreed to it.
      </span>
    </div>
  );
}

const Row = ({ n, run, station, onRun, onStation }: {
  n: number; run: string; station: string;
  onRun: (v: string) => void; onStation: (v: string) => void;
}) => (
  <>
    <span style={{ fontSize: 11, fontWeight: 700, color: INK40 }}>R{n}</span>
    <input className="mono" inputMode="numeric" value={run} onChange={(e) => onRun(e.target.value)}
      placeholder="1:47" aria-label={`Round ${n} run time`}
      style={{ padding: "9px 0", textAlign: "center", borderRadius: 9, fontSize: 14,
        fontWeight: 700 }} />
    <input className="mono" inputMode="numeric" value={station}
      onChange={(e) => onStation(e.target.value)}
      placeholder="—" aria-label={`Round ${n} station time`}
      style={{ padding: "9px 0", textAlign: "center", borderRadius: 9, fontSize: 14,
        fontWeight: 700 }} />
  </>
);

/**
 * mm:ss, or bare seconds where somebody typed those instead.
 *
 * A stopwatch reads 1:47 and asking for 107 is asking for a mistake — but somebody who types
 * 107 anyway means 107 seconds, and a parser that rejects it is being pedantic about a number
 * it understood perfectly well.
 */
function secondsOf(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

const caps: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase",
  color: INK55,
};

const mmss = (s: number) => `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;
