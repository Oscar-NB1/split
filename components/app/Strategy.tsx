"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { mmss } from "@/lib/prescription";
import { SEED, TARGET, type Segment, totals } from "@/lib/strategy";
import type { Forecast } from "@/lib/weather";

const TEAL = "#0A8FB0", LIME = "#C6FF5B", LIME_D = "#AAEA42", NAVY = "#12314D", NAVY_D = "#0E2740";
const TEAL_T2 = "var(--teal-tint2)";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const OFF = "var(--off)", PAPER = "var(--paper)", LINE = "var(--line)";

/**
 * The race, segment by segment.
 *
 * The numbers, and their bounds, are in lib/strategy.ts — shared with the route
 * that stores them and with the workout text that reaches the watch, so the plan
 * on this screen and the plan on the watch cannot drift apart.
 */
type Row = Segment;

export default function Strategy() {
  const [rows, setRows] = useState<Row[]>(SEED);
  const [roxEach, setRoxEach] = useState(30);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [exportState, setExportState] = useState<"idle" | "sending" | "sent">("idle");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [exportedAt, setExportedAt] = useState<string | null>(null);
  /*
   * The race this is for, from the athlete's own block.
   *
   * The header said "Race strategy · 28 Nov" and "Hyrox Doubles" in the markup, and
   * the target pill said 56:30 — one athlete's race, printed for everyone. All three
   * are properties of whose plan is open.
   */
  const [race, setRace] = useState<{
    date: string | null; goal: number | null; doubles: boolean; saved: boolean;
    conditions: Forecast | null;
  }>({ date: null, goal: null, doubles: true, saved: false, conditions: null });
  const [error, setError] = useState<string | null>(null);
  // nothing is written until the athlete actually changes something, so opening
  // the screen and leaving does not turn the plan's numbers into "their" plan
  const loaded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/strategy").then(async (r) => {
      if (r.status === 401) { location.href = "/"; return; }
      const j = await r.json();
      setRows(j.segments); setRoxEach(j.rox_seconds);
      setConnected(j.intervals_connected); setExportedAt(j.exported_at);
      setRace({
        date: j.race_date ?? null, goal: j.goal_seconds ?? null,
        doubles: j.doubles !== false, saved: !!j.saved,
        conditions: j.conditions ?? null,
      });
      loaded.current = true;
    });
  }, []);

  // Debounced: holding the minus button is a dozen taps, not a dozen saves.
  const save = useCallback((next: Row[], nextRox: number) => {
    if (!loaded.current) return;
    setSaving("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const res = await fetch("/api/strategy", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ segments: next, rox_seconds: nextRox }),
      });
      setSaving(res.ok ? "saved" : "idle");
      if (!res.ok) setError("Could not save that change.");
    }, 600);
  }, []);

  const { runs: runTotal, stations: stationTotal, rox, finish } = totals(rows, roxEach);
  /*
   * Measured against their goal, not against a number in the source.
   *
   * An athlete whose goal is 1:15 was being told they were "over the 56:30 target"
   * on a plan that hits their goal exactly.
   */
  const target = race.goal ?? TARGET;
  const inside = finish <= target;

  const bump = (i: number, by: number) =>
    setRows((rs) => {
      const next = rs.map((r, j) => (j === i ? { ...r, sec: Math.max(60, r.sec + by) } : r));
      save(next, roxEach);
      return next;
    });

  const setRox = (fn: (r: number) => number) =>
    setRoxEach((r) => { const next = fn(r); save(rows, next); return next; });

  async function exportPlan() {
    setExportState("sending"); setError(null);
    const res = await fetch("/api/strategy", { method: "POST" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setExportState("idle");
      setError(j.error ?? "Could not send the plan.");
      return;
    }
    setExportState("sent"); setExportedAt(new Date().toISOString());
  }

  // elapsed accumulates the transition after each station, as the race does
  let elapsed = 0;
  const withElapsed = rows.map((r) => {
    elapsed += r.sec;
    if (r.kind === "Station") elapsed += roxEach;
    return { ...r, elapsed };
  });

  return (
    <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em",
          textTransform: "uppercase", color: "var(--teal)" }}>
          Race strategy{race.date ? ` · ${new Date(`${race.date}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
        </div>
        <div style={{ fontFamily: "var(--display)", fontSize: 24, fontWeight: 700,
          lineHeight: 1.1, letterSpacing: "-.02em", marginTop: 5 }}>
          Hyrox {race.doubles ? "Doubles" : "Singles"}
        </div>
        {!race.saved && race.goal && (
          <div style={{ fontSize: 12, color: INK55, marginTop: 6, lineHeight: 1.5 }}>
            {/* Where the numbers came from, before the athlete has touched any of
                them. A plan that looks authored but was derived should say so. */}
            These are starting splits, built from your {mmss(race.goal)} goal and the
            shape of a Hyrox. Change any of them and they become yours.
          </div>
        )}
      </div>

      {race.conditions && (
        <div style={{ display: "flex", gap: 11, alignItems: "flex-start",
          background: race.conditions.cost_s >= 6 ? "#FBF3DE" : PAPER,
          border: `1px solid ${race.conditions.cost_s >= 6 ? "#E8C051" : LINE}`,
          borderRadius: "var(--r-card)", padding: "13px 15px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em",
              textTransform: "uppercase", color: INK55 }}>
              {/* Only ever a real forecast. This used to fall back to a five-year
                  average for the date, labelled as one — but the label does not
                  survive the glance, and what an athlete remembers is the number. The
                  card is simply absent until the race is inside the horizon. */}
              Race day forecast
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-70)" }}>
              {race.conditions.headline}
            </div>
            {race.conditions.cost_s >= 6 && (
              <div style={{ fontSize: 12, color: INK55, lineHeight: 1.5 }}>
                Worth planning the runs {race.conditions.cost_s} s/km slower than your
                fresh pace and holding the stations. Going out at a pace the air will
                not give back is the most common way a Hyrox falls apart.
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ background: NAVY, borderRadius: "var(--r-card)", padding: 16,
        display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em",
              textTransform: "uppercase", color: "rgba(255,255,255,.55)" }}>Projected finish</div>
            <div style={{ fontFamily: "var(--display)", fontSize: 34, fontWeight: 700,
              color: LIME, lineHeight: 1.05 }}>{mmss(finish)}</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, borderRadius: "var(--r-pill)",
            padding: "6px 12px", background: inside ? TEAL_T2 : NAVY_D,
            color: inside ? TEAL : LIME }}>
            {inside ? `Inside your ${mmss(target)} goal` : `Over your ${mmss(target)} goal`}
          </span>
        </div>
        <div style={{ display: "flex", gap: 18, borderTop: "1px solid rgba(255,255,255,.15)",
          paddingTop: 12 }}>
          {([["Runs", runTotal], ["Stations", stationTotal], ["Roxzone", rox]] as const).map(([l, v]) => (
            <div key={l}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em",
                textTransform: "uppercase", color: "rgba(255,255,255,.55)" }}>{l}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{mmss(v)}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: "var(--r-card)",
        padding: "15px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em",
              textTransform: "uppercase" }}>Roxzone</span>
            <span style={{ fontSize: 11, color: INK55 }}>
              8 transitions · {mmss(roxEach)} each
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={() => setRox((r) => Math.max(15, r - 5))} style={roxStep}>−</button>
            <span style={{ fontFamily: "var(--display)", fontSize: 19, fontWeight: 700,
              minWidth: 44, textAlign: "center" }}>{mmss(roxEach)}</span>
            <button onClick={() => setRox((r) => r + 5)} style={roxStep}>+</button>
          </div>
        </div>
        <div style={{ fontSize: 11, lineHeight: 1.5, color: roxEach > 32 ? NAVY_D : INK55 }}>
          {roxEach > 32
            ? "Heerenveen ran 0:38 average. Every 5 s here is 40 s on the clock."
            : "Inside the 4:00 roxzone target from your plan."}
        </div>
      </div>

      {withElapsed.map((r, i) => (
        <div key={r.name} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10,
            alignItems: "center", padding: "11px 13px", background: PAPER,
            border: `1px solid ${LINE}`,
            borderLeft: `3px solid ${r.kind === "Run" ? TEAL : LIME_D}`,
            borderRadius: "var(--r-card)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em",
                textTransform: "uppercase", color: INK40 }}>{r.kind}</span>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</span>
              {r.note && (
                <span style={{ fontSize: 11, color: INK55, lineHeight: 1.4 }}>{r.note}</span>
              )}
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em",
                color: INK40 }}>elapsed {mmss(r.elapsed)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => bump(i, -5)} style={step} aria-label="Five seconds faster">−</button>
              <span style={{ fontFamily: "var(--display)", fontSize: 17, fontWeight: 700,
                minWidth: 46, textAlign: "center" }}>{mmss(r.sec)}</span>
              <button onClick={() => bump(i, 5)} style={step} aria-label="Five seconds slower">+</button>
            </div>
          </div>
          {r.kind === "Station" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 13px 2px" }}>
              <span style={{ width: 3, height: 14, background: LINE, borderRadius: 2 }} />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em",
                textTransform: "uppercase", color: INK40 }}>
                Roxzone transition · {mmss(roxEach)}
              </span>
            </div>
          )}
        </div>
      ))}

      <button onClick={exportPlan} disabled={exportState !== "idle" || connected === false} style={{
        width: "100%", borderRadius: "var(--r-pill)", padding: 16, fontSize: 12, fontWeight: 800,
        letterSpacing: ".06em", textTransform: "uppercase",
        background: exportState === "sent" ? TEAL_T2 : connected === false ? OFF : LIME,
        color: exportState === "sent" ? TEAL : connected === false ? INK40 : NAVY_D,
        border: connected === false ? `1px solid ${LINE}` : "none",
      }}>
        {exportState === "sent" ? "Sent to your watch"
          : exportState === "sending" ? "Sending…"
          : connected === false ? "Connect intervals.icu to export"
          : "Export race plan to my watch"}
      </button>
      {error && (
        <div style={{ fontSize: 11, color: "#B4472F", lineHeight: 1.5 }}>{error}</div>
      )}
      <div style={{ fontSize: 11, color: INK40, lineHeight: 1.5 }}>
        {connected === false
          ? "The plan reaches your watch through intervals.icu. Add its key under Profile → Manage connections."
          : "Goes to intervals.icu as one step per segment with its target time, and syncs from there into Garmin Connect."}
        {" "}
        {saving === "saving" ? "Saving…"
          : saving === "saved" ? "Changes saved."
          : exportedAt ? `Last sent ${new Date(exportedAt).toLocaleDateString("en-GB",
              { day: "numeric", month: "short" })}.`
          : "Changes save as you make them."}
      </div>
    </div>
  );
}

const roxStep: React.CSSProperties = {
  width: 34, height: 34, borderRadius: "50%", border: `1px solid ${LINE}`,
  background: OFF, color: "var(--ink)", fontSize: 15, fontWeight: 700, flex: "none",
};
const step: React.CSSProperties = {
  width: 30, height: 30, borderRadius: "50%", border: `1px solid ${LINE}`,
  background: OFF, color: "var(--ink)", fontSize: 14, fontWeight: 700, flex: "none",
};
