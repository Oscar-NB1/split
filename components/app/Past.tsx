"use client";
import { useEffect, useState } from "react";
import { fmt } from "@/lib/dates";
import { hms, pace } from "@/lib/analysis";
import { kindColour, kindLabel } from "@/lib/coach";

type Row = {
  id: string; name: string | null; sport_type: string | null; local_date: string;
  moving_seconds: number | null; distance_m: number | null; avg_hr: number | null;
  max_hr: number | null; avg_speed_ms: number | null; has_detail: boolean;
};

export default function Past({ openActivity }: { openActivity: (id: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [kinds, setKinds] = useState<{ sport_type: string; n: number }[]>([]);
  const [filter, setFilter] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/past").then(async (r) => {
      if (r.status === 401) { location.href = "/login"; return; }
      const j = await r.json();
      setRows(j.activities); setKinds(j.kinds);
    });
  }, []);

  if (!rows) return <div className="pad"><p className="empty">Loading…</p></div>;

  const shown = filter ? rows.filter((r) => r.sport_type === filter) : rows;

  // Grouped in the client because the server already sorted: the month header
  // is a rendering concern, not a query.
  const months: { key: string; label: string; rows: Row[] }[] = [];
  for (const r of shown) {
    const key = r.local_date.slice(0, 7);
    let m = months.find((x) => x.key === key);
    if (!m) {
      m = { key, label: fmt(`${key}-01`, { month: "long", year: "numeric" }), rows: [] };
      months.push(m);
    }
    m.rows.push(r);
  }

  return (
    <div className="pad">
      <div>
        <div className="eyebrow">Past activities</div>
        <h1 className="h2" style={{ marginTop: 5 }}>Everything logged, by month.</h1>
      </div>

      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
        <button className="chip" onClick={() => setFilter(null)}
          style={filter === null ? { background: "var(--navy)", color: "#fff", borderColor: "var(--navy)" } : undefined}>
          All {rows.length}
        </button>
        {kinds.map((k) => (
          <button key={k.sport_type} className="chip" onClick={() => setFilter(k.sport_type)}
            style={filter === k.sport_type ? { background: "var(--navy)", color: "#fff", borderColor: "var(--navy)" } : undefined}>
            {kindLabel(k.sport_type)} {k.n}
          </button>
        ))}
      </div>

      {months.map((m) => {
        const km = m.rows.reduce((n, r) => n + (r.distance_m ?? 0), 0) / 1000;
        const secs = m.rows.reduce((n, r) => n + (r.moving_seconds ?? 0), 0);
        return (
          <div key={m.key} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="monthhead">
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span className="m">{m.label}</span>
                <span style={{ fontSize: 11, color: "var(--ink-55)" }}>
                  {m.rows.length} sessions · {hms(secs)}
                </span>
              </div>
              <span className="km">{km >= 0.05 ? `${km.toFixed(1)} km` : "—"}</span>
            </div>

            {m.rows.map((r) => (
              <button key={r.id} className="sess" onClick={() => openActivity(r.id)}>
                <span className="edge" style={{ background: kindColour(r.sport_type) }} />
                <span className="body">
                  <span className="rowsplit">
                    <span className="title" style={{ fontSize: 16 }}>{r.name ?? "Activity"}</span>
                    <span className="kindlab" style={{ fontSize: 9 }}>{kindLabel(r.sport_type ?? "")}</span>
                  </span>
                  <span className="detail">
                    {fmt(r.local_date, { weekday: "short", day: "numeric", month: "short" })}
                    {!r.has_detail ? " · detail not imported" : ""}
                  </span>
                  <span className="metrics">
                    <span>{r.distance_m ? `${(r.distance_m / 1000).toFixed(2)} km` : hms(r.moving_seconds)}</span>
                    <span>{r.distance_m ? hms(r.moving_seconds) : ""}</span>
                    <span>{r.avg_speed_ms && r.distance_m ? `${pace(r.avg_speed_ms)} /km`
                      : r.avg_hr ? `avg ${Math.round(r.avg_hr)}` : ""}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        );
      })}

      {shown.length === 0 && <p className="empty">Nothing logged for that filter.</p>}
      <p style={{ fontSize: 10, color: "var(--ink-40)" }}>Source: Strava · Garmin</p>
    </div>
  );
}
