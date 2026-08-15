"use client";
import { useEffect, useState } from "react";
import { fmt } from "@/lib/dates";
import { clock, secs, type Read } from "@/lib/signals";

type Data = {
  verdict: Read; goal: number; goalLabel: string;
  skipped: { title: string; why: string }[];
  volume: { n: number; start: string; planned: number; logged: number | null; note: string }[];
  history: { wk: string; km: number }[];
};

/**
 * Form: whether the block is working.
 *
 * Two things, kept apart on purpose. The verdict is about *pace against
 * prescription* on milestone sessions. The volume chart is about *kilometres
 * against plan*. The whole diagnosis behind this block was that those two failed
 * separately — volume collapsed, and quality sessions were run too fast — so
 * showing them as one number would hide exactly the thing worth seeing.
 */
export default function Form({ only }: { only?: "pace" | "volume" }) {
  const [d, setD] = useState<Data | null>(null);
  const [own, setOwn] = useState<"pace" | "volume">("pace");
  // hosted inside Plan's tabs, the screen shows one half and hides its own switch
  const tab = only ?? own;
  const setTab = setOwn;

  useEffect(() => {
    fetch("/api/form").then(async (r) => {
      if (r.status === 401) { location.href = "/"; return; }
      if (r.ok) setD(await r.json());
    });
  }, []);

  if (!d) return <div className="pad"><p className="empty">Loading…</p></div>;
  const v = d.verdict;

  const badge = v.state === "ahead" ? { t: "Ahead of plan", bg: "var(--teal-tint)", fg: "var(--teal)" }
    : v.state === "behind" ? { t: "Behind plan", bg: "rgba(192,122,62,.14)", fg: "#C07A3E" }
    : { t: "On plan", bg: "var(--off)", fg: "var(--ink-55)" };

  return (
    <div className={only ? "" : "pad"}
      style={only ? { display: "flex", flexDirection: "column", gap: 14 } : undefined}>
      {!only && (
        <div>
          <div className="eyebrow">Form</div>
          <h1 className="h2" style={{ marginTop: 5 }}>Is the block working?</h1>
        </div>
      )}

      {!only && (
        <div className="pillrow">
          <button aria-pressed={tab === "pace"} onClick={() => setTab("pace")}>Pace vs plan</button>
          <button aria-pressed={tab === "volume"} onClick={() => setTab("volume")}>Volume</button>
        </div>
      )}

      {tab === "pace" && (
        <>
          <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="rowsplit">
              <span className="caps">Milestone sessions</span>
              <span className="tag" style={{ background: badge.bg, color: badge.fg, fontWeight: 700 }}>
                {badge.t}
              </span>
            </div>
            <div className="h3">
              {v.points.length === 0
                ? "No milestone session has been run yet."
                : `${v.confidence} confidence — ${v.streak} in a row ${v.sideWord}.`}
            </div>
            {v.points.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10,
                borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                <Stat l="Trend" v={secs(v.trend)} s="recency-weighted" />
                <Stat l="Streak" v={String(v.streak)} s="consecutive" />
                <Stat l="Target shift" v={v.shift === 0 ? "none" : secs(v.shift)} s="on pace targets" />
              </div>
            )}
          </section>

          {v.points.length > 0 && <Chart points={v.points} />}

          <section className="vs" style={{ gap: 10 }}>
            <span className="caps-sm" style={{ color: "rgba(255,255,255,.55)" }}>Race projection</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
              <span className="disp" style={{ fontSize: 32, color: "var(--lime)", lineHeight: 1 }}>
                {clock(v.projected)}
              </span>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,.7)" }}>goal {d.goalLabel}</span>
            </div>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,.75)", lineHeight: 1.5 }}>
              {v.points.length === 0
                ? "Projected from the goal alone until a milestone session lands."
                : `From ${v.points.length} milestone session${v.points.length > 1 ? "s" : ""}, weighted toward the recent ones.`}
            </span>
          </section>

          {v.shift !== 0 && (
            <section className="card" style={{ background: "var(--cream)", display: "flex", flexDirection: "column", gap: 9 }}>
              <span className="eyebrow" style={{ fontSize: 10 }}>Recommended change</span>
              <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.35 }}>
                Move pace targets {secs(v.shift)}
              </span>
              <span className="muted">
                {v.streak} consecutive sessions {v.sideWord}, trend {secs(v.trend)}. Capped at 6 s/km
                and applied to pace targets only — never to volume.
              </span>
            </section>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="caps">The sessions behind it</span>
            {v.points.length === 0 && (
              <p className="empty">
                A milestone session needs a pace in its title and imported laps. Week 1&apos;s
                Tuesday is the first one.
              </p>
            )}
            {v.points.map((p, i) => (
              <div className="card" key={i} style={{ padding: "13px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="rowsplit">
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{p.label}</span>
                    <span style={{ fontSize: 11, color: "var(--ink-40)" }}>
                      {fmt(p.on, { day: "numeric", month: "short" })} · {p.type}
                    </span>
                  </span>
                  <span className="tag" style={{
                    background: p.delta <= -2 ? "var(--teal-tint)" : p.delta >= 2 ? "rgba(192,122,62,.14)" : "var(--off)",
                    color: p.delta <= -2 ? "var(--teal)" : p.delta >= 2 ? "#C07A3E" : "var(--ink-55)",
                    fontWeight: 700,
                  }}>{secs(p.delta)}</span>
                </div>
                <div style={{ height: 5, background: "var(--off)", borderRadius: 3, overflow: "hidden" }}>
                  <i style={{
                    display: "block", height: "100%",
                    width: `${Math.min(100, Math.abs(p.delta) * 8)}%`,
                    background: p.delta <= 0 ? "var(--teal)" : "#C07A3E",
                  }} />
                </div>
                <span style={{ fontSize: 11, color: "var(--ink-55)" }}>
                  prescribed {clock(p.prescribed)}/km · held {clock(p.achieved)}/km
                </span>
              </div>
            ))}
          </div>

          {d.skipped.length > 0 && (
            <p className="empty">
              {d.skipped.length} completed session{d.skipped.length > 1 ? "s" : ""} produced no
              signal: {[...new Set(d.skipped.map((s) => s.why))].join("; ")}. Skipped rather than
              guessed at — a signal invented from a whole-session average is worse than a
              missing one, because the engine acts on it.
            </p>
          )}
        </>
      )}

      {tab === "volume" && <Volume volume={d.volume} />}
    </div>
  );
}

const Stat = ({ l, v, s }: { l: string; v: string; s: string }) => (
  <div>
    <div className="caps-sm">{l}</div>
    <div className="disp" style={{ fontSize: 19, marginTop: 3 }}>{v}</div>
    <div style={{ fontSize: 10, color: "var(--ink-40)" }}>{s}</div>
  </div>
);

/** Each milestone's miss against prescription, oldest to newest. */
function Chart({ points }: { points: { delta: number; on: string }[] }) {
  const W = 306, H = 96;
  const max = Math.max(6, ...points.map((p) => Math.abs(p.delta)));
  const x = (i: number) => (points.length < 2 ? W / 2 : (i / (points.length - 1)) * W);
  const y = (d: number) => H / 2 - (d / max) * (H / 2 - 8);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.delta).toFixed(1)}`).join("");

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="rowsplit">
        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--teal)" }}>Faster than prescribed</span>
        <span className="caps-sm">Milestones</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, overflow: "visible" }}>
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="var(--ink-40)" strokeDasharray="3 3" />
        <path d={path} fill="none" stroke="#0A8FB0" strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.delta)} r={4}
            fill={p.delta <= -2 ? "#0A8FB0" : p.delta >= 2 ? "#C07A3E" : "#8B9BA8"} />
        ))}
      </svg>
      <div className="rowsplit">
        <span style={{ fontSize: 10, fontWeight: 700, color: "#C07A3E" }}>Slower</span>
        <span style={{ fontSize: 10, color: "var(--ink-40)" }}>Dashed line = prescription</span>
      </div>
    </div>
  );
}

function Volume({ volume }: { volume: Data["volume"] }) {
  const max = Math.max(...volume.map((v) => Math.max(v.planned, v.logged ?? 0)), 1);
  const doneWeeks = volume.filter((v) => v.logged != null);
  const hit = doneWeeks.filter((v) => (v.logged ?? 0) >= v.planned * 0.9).length;

  return (
    <>
      <div className="stat3">
        <div className="kpi">
          <div className="l">Weeks logged</div>
          <div className="v">{doneWeeks.length}<span style={{ fontSize: 13, color: "var(--ink-40)" }}>/15</span></div>
          <div className="s">of the block</div>
        </div>
        <div className="kpi">
          <div className="l">On target</div>
          <div className="v">{hit}</div>
          <div className="s">within 10% of plan</div>
        </div>
        <div className="kpi">
          <div className="l">Planned total</div>
          <div className="v">{volume.reduce((n, v) => n + v.planned, 0)}</div>
          <div className="s">km across 15 weeks</div>
        </div>
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span className="caps" style={{ color: "var(--ink)" }}>Planned vs logged</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {volume.map((v) => (
            <div key={v.n} style={{ display: "grid", gridTemplateColumns: "22px 1fr 58px",
              gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-40)" }}>{v.n}</span>
              <span style={{ position: "relative", height: 14, background: "var(--off)",
                borderRadius: 3, overflow: "hidden" }}>
                <i style={{ position: "absolute", inset: 0, width: `${(v.planned / max) * 100}%`,
                  background: "var(--teal-tint2)", display: "block" }} />
                {v.logged != null && (
                  <i style={{ position: "absolute", left: 0, top: 0, bottom: 0,
                    width: `${Math.min(100, (v.logged / max) * 100)}%`,
                    background: "var(--teal)", display: "block" }} />
                )}
              </span>
              <span className="mono" style={{ fontSize: 11, textAlign: "right",
                color: v.logged == null ? "var(--ink-40)" : "var(--ink)" }}>
                {v.logged == null ? `${v.planned}` : `${v.logged}/${v.planned}`}
              </span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 10, color: "var(--ink-55)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <i style={{ width: 14, height: 3, background: "var(--teal)", display: "block" }} />Logged
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <i style={{ width: 14, height: 3, background: "var(--teal-tint2)", display: "block" }} />Planned
          </span>
        </div>
      </div>

      <p className="empty">
        The block exists because running volume fell from 40–50 km/week to 14–20 for three
        months, costing about 7% in speed per heartbeat. This chart is the one that says
        whether that is being fixed.
      </p>
    </>
  );
}
