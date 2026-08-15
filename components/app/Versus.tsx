"use client";
import type { User, WeekData } from "./Shell";

/**
 * The weekly head-to-head, scored on the metric that week rotates to.
 *
 * Deliberately shows the metric name and the raw scores rather than only a
 * winner: the point of the rotation is that a week you lose on distance you
 * might win on effort points, and hiding the metric hides that.
 */
export default function Versus({
  data, me, other,
}: { data: WeekData | null; me: User; other: User | null }) {
  if (!data) return <div className="pad"><p className="empty">Loading…</p></div>;
  if (!other) {
    return (
      <div className="pad">
        <p className="empty">
          Versus needs a second athlete. Only one account has been set up so far.
        </p>
      </div>
    );
  }

  const score = (uid: string) => data.challenge.scores.find((s) => s.user_id === uid)?.score ?? 0;
  const mine = score(me.id);
  const theirs = score(other.id);
  const total = mine + theirs || 1;
  const lead = mine === theirs ? "Level" : mine > theirs ? "You lead" : `${other.display_name} leads`;

  const rows = [
    { label: "Sessions", mine: data.sessions.filter((s) => s.user_id === me.id && ["done", "adjusted"].includes(s.status)).length,
      theirs: data.sessions.filter((s) => s.user_id === other.id && ["done", "adjusted"].includes(s.status)).length },
    { label: "Distance", suffix: " km",
      mine: +( [...data.sessions, ...data.unplanned].filter((s) => s.user_id === me.id)
        .reduce((n, s) => n + (Number(s.distance_m) || 0), 0) / 1000).toFixed(1),
      theirs: +( [...data.sessions, ...data.unplanned].filter((s) => s.user_id === other.id)
        .reduce((n, s) => n + (Number(s.distance_m) || 0), 0) / 1000).toFixed(1) },
    { label: "Minutes",
      mine: [...data.sessions, ...data.unplanned].filter((s) => s.user_id === me.id)
        .reduce((n, s) => n + (s.actual_minutes ?? 0), 0),
      theirs: [...data.sessions, ...data.unplanned].filter((s) => s.user_id === other.id)
        .reduce((n, s) => n + (s.actual_minutes ?? 0), 0) },
    { label: "Streak", suffix: " wks",
      mine: data.streaks[me.id] ?? 0, theirs: data.streaks[other.id] ?? 0 },
  ];

  return (
    <div className="pad">
      <div>
        <div className="eyebrow">Head to head</div>
        <h1 className="h2" style={{ marginTop: 5 }}>You vs {other.display_name}</h1>
      </div>

      <section className="vs">
        <div className="head">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="avatar">{me.display_name.slice(0, 1).toUpperCase()}</span>
            <span className="score" style={{ color: mine >= theirs ? "var(--lime)" : "#fff" }}>{mine}</span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,.6)" }}>You</span>
          </div>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", color: "rgba(255,255,255,.4)" }}>VS</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
            <span className="avatar" style={{ background: "rgba(255,255,255,.18)" }}>
              {other.display_name.slice(0, 1).toUpperCase()}
            </span>
            <span className="score" style={{ color: theirs > mine ? "var(--lime)" : "#fff" }}>{theirs}</span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,.6)" }}>{other.display_name}</span>
          </div>
        </div>
        <div className="tug">
          <i style={{ width: `${(mine / total) * 100}%`, background: "var(--lime)" }} />
          <i style={{ width: `${(theirs / total) * 100}%`, background: "rgba(255,255,255,.35)" }} />
        </div>
        <div className="rowsplit">
          <span className="lead">{lead}</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,.55)" }}>
            This week: {data.challenge.label}
          </span>
        </div>
      </section>

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {rows.map((r) => {
          const max = Math.max(r.mine, r.theirs, 1);
          const iWin = r.mine > r.theirs, theyWin = r.theirs > r.mine;
          return (
            <div className="vsrow" key={r.label}>
              <div className="top">
                <span style={{ fontSize: 15, fontWeight: iWin ? 800 : 600, color: iWin ? "var(--teal)" : "var(--ink-55)" }}>
                  {r.mine}{r.suffix ?? ""}
                </span>
                <span className="caps-sm">{r.label}</span>
                <span style={{ textAlign: "right", fontSize: 15, fontWeight: theyWin ? 800 : 600, color: theyWin ? "var(--teal)" : "var(--ink-55)" }}>
                  {r.theirs}{r.suffix ?? ""}
                </span>
              </div>
              <div className="bars">
                <div><i style={{ width: `${(r.mine / max) * 100}%`, background: iWin ? "var(--teal)" : "var(--ink-40)" }} /></div>
                <div><i style={{ width: `${(r.theirs / max) * 100}%`, background: theyWin ? "var(--teal)" : "var(--ink-40)" }} /></div>
              </div>
            </div>
          );
        })}
      </section>

      <p className="empty">
        Scored on this week&apos;s rotating metric — {data.challenge.label.toLowerCase()}. The
        metric changes each week, so a week lost on distance can be won on effort.
      </p>
    </div>
  );
}
