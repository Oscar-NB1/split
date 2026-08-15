"use client";
import { useEffect, useState } from "react";
import { fmt } from "@/lib/dates";
import { hms, pace } from "@/lib/analysis";
import { kindColour, kindLabel } from "@/lib/coach";

const TEAL = "#0A8FB0", NAVY = "#12314D";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const PAPER = "var(--paper)", LINE = "var(--line)";

type Row = {
  id: string; name: string | null; sport_type: string | null; local_date: string;
  start_time: string; moving_seconds: number | null; distance_m: number | null;
  avg_hr: number | null; max_hr: number | null; avg_speed_ms: number | null;
  has_detail: boolean;
};

/** The design's pill: filled in the kind's own colour when selected. */
const pill = (on: boolean, accent: string): React.CSSProperties => ({
  padding: "8px 13px", borderRadius: "var(--r-pill)", fontSize: 11, fontWeight: 600,
  border: `1px solid ${on ? accent : LINE}`,
  background: on ? accent : PAPER,
  color: on ? "#fff" : INK55,
  whiteSpace: "nowrap", flex: "none",
});

/**
 * Everything logged, by month.
 *
 * The three metrics per row change with the discipline, because the useful
 * numbers do: a run is distance / time / pace, a gym session is time / average
 * HR / peak. Showing "0.00 km" against a deadlift session is how a log stops
 * being read.
 */
function metrics(r: Row): [string, string, string] {
  const km = r.distance_m ? r.distance_m / 1000 : 0;
  if (km > 0.2) {
    return [
      `${km.toFixed(2)} km`,
      hms(r.moving_seconds),
      r.avg_speed_ms ? `${pace(r.avg_speed_ms)} /km` : "",
    ];
  }
  return [
    r.moving_seconds ? `${Math.round(r.moving_seconds / 60)} min` : "—",
    r.avg_hr ? `avg ${Math.round(r.avg_hr)}` : "",
    r.max_hr ? `peak ${Math.round(r.max_hr)}` : "",
  ];
}

export default function Past({ openActivity }: { openActivity: (id: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [kinds, setKinds] = useState<{ sport_type: string; n: number }[]>([]);
  const [filter, setFilter] = useState("All");

  useEffect(() => {
    fetch("/api/past").then(async (r) => {
      if (r.status === 401) { location.href = "/login"; return; }
      const j = await r.json();
      setRows(j.activities); setKinds(j.kinds);
    });
  }, []);

  if (!rows) return <div style={{ padding: 18 }}><p className="empty">Loading…</p></div>;

  // grouped in the client: the server already sorted, and a month header is a
  // rendering concern rather than a query
  const months: { key: string; label: string; rows: Row[] }[] = [];
  for (const r of rows) {
    const key = r.local_date.slice(0, 7);
    let m = months.find((x) => x.key === key);
    if (!m) { m = { key, label: fmt(`${key}-01`, { month: "long", year: "numeric" }), rows: [] }; months.push(m); }
    m.rows.push(r);
  }

  const filters = ["All", ...kinds.slice(0, 6).map((k) => k.sport_type)];

  return (
    <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em",
          textTransform: "uppercase", color: "var(--teal)" }}>Past activities</div>
        <div style={{ fontFamily: "var(--display)", fontSize: 24, fontWeight: 700,
          lineHeight: 1.1, letterSpacing: "-.02em", marginTop: 5 }}>
          Everything logged, by month.
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
        {filters.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            style={pill(filter === f, f === "All" ? NAVY : kindColour(f))}>
            {f === "All" ? `All ${rows.length}` : `${kindLabel(f)} ${kinds.find((k) => k.sport_type === f)?.n ?? 0}`}
          </button>
        ))}
      </div>

      {months.map((m) => {
        const shown = filter === "All" ? m.rows : m.rows.filter((r) => r.sport_type === filter);
        if (shown.length === 0) return null;
        // the month's totals describe the month, not the filter — a filtered
        // view that also rewrote the header would make August look like a
        // different month depending on which chip was pressed
        const km = m.rows.reduce((n, r) => n + (r.distance_m ?? 0), 0) / 1000;
        const secs = m.rows.reduce((n, r) => n + (r.moving_seconds ?? 0), 0);
        return (
          <div key={m.key} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline",
              justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontFamily: "var(--display)", fontSize: 17, fontWeight: 700 }}>
                  {m.label}
                </span>
                <span style={{ fontSize: 11, color: INK55 }}>
                  {m.rows.length} {m.rows.length === 1 ? "activity" : "activities"} · {hms(secs)}
                </span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: TEAL }}>
                {km >= 0.05 ? `${km.toFixed(1)} km` : "—"}
              </span>
            </div>

            {shown.map((r) => {
              const [a, b, c] = metrics(r);
              return (
                <button key={r.id} onClick={() => openActivity(r.id)} style={{
                  display: "flex", alignItems: "stretch", background: PAPER,
                  border: `1px solid ${LINE}`, borderRadius: "var(--r-card)",
                  overflow: "hidden", textAlign: "left", padding: 0, color: "var(--ink)",
                }}>
                  <span style={{ width: 4, flex: "none", alignSelf: "stretch",
                    background: kindColour(r.sport_type) }} />
                  <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8,
                    padding: "13px 14px" }}>
                    <span style={{ display: "flex", alignItems: "baseline",
                      justifyContent: "space-between", gap: 10 }}>
                      <span style={{ fontFamily: "var(--display)", fontSize: 16, fontWeight: 700 }}>
                        {r.name ?? "Activity"}
                      </span>
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em",
                        textTransform: "uppercase", color: INK40 }}>
                        {kindLabel(r.sport_type ?? "")}
                      </span>
                    </span>
                    <span style={{ fontSize: 11, color: INK55 }}>
                      {fmt(r.local_date, { weekday: "short", day: "numeric", month: "short" })}
                      {" · "}
                      {new Date(r.start_time).toLocaleTimeString("en-GB",
                        { hour: "2-digit", minute: "2-digit" })}
                      {!r.has_detail ? " · detail not imported" : ""}
                    </span>
                    <span style={{ display: "flex", gap: 18, fontSize: 13, fontWeight: 600 }}>
                      <span>{a}</span>
                      <span style={{ color: INK55, fontWeight: 500 }}>{b}</span>
                      <span style={{ color: INK55, fontWeight: 500 }}>{c}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}

      <div style={{ fontSize: 10, color: INK40 }}>Source: Strava · Garmin Forerunner 255</div>
    </div>
  );
}
