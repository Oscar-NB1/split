"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmt } from "@/lib/dates";
import { hms, pace, ROLE_LABEL, type Segment } from "@/lib/analysis";
import { kindLabel } from "@/lib/coach";

type Stats = {
  count: number; distance_m: number; moving_seconds: number;
  avg_hr: number | null; peak_segment_hr: number | null; lowest_segment_hr: number | null;
  max_hr: number | null; avg_speed_ms: number | null; best_speed_ms: number | null;
};
type ZoneRow = { tag: string; label: string; colour: string; seconds: number; pct: number };
type Split = {
  split: number; distance_m: number | null; moving_seconds: number | null;
  avg_speed_ms: number | null; avg_hr: number | null; elevation_diff_m: number | null;
};
type Payload = {
  activity: {
    id: string; name: string | null; sport_type: string | null; local_date: string;
    display_name: string; user_id: string; provider_activity_id: string;
    moving_seconds: number | null; elapsed_seconds: number | null;
    distance_m: number | null; elevation_m: number | null;
    avg_hr: number | null; max_hr: number | null; avg_speed_ms: number | null;
    session_title: string | null; planned_minutes: number | null;
    session_status: string | null; effort_points: number | null;
  };
  segments: Segment[]; isIntervals: boolean;
  stats: Record<"work" | "rest" | "steady", Stats>;
  splits: Split[];
  series: { t: number[]; hr: (number | null)[]; speed: (number | null)[]; dist: number[] } | null;
  zones: ZoneRow[]; zoneTotal: number;
  route: [number, number][]; basemap: boolean; detail_pending: boolean;
};

export default function Activity({ id, meId }: { id: string; meId: string }) {
  const [d, setD] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"segments" | "km">("segments");

  useEffect(() => {
    let live = true;
    fetch(`/api/activity/${id}`)
      .then(async (r) => {
        if (r.status === 401) { location.href = "/login"; return null; }
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "failed");
        return r.json();
      })
      .then((j) => live && j && setD(j))
      .catch((e) => live && setErr(String(e.message ?? e)));
    return () => { live = false; };
  }, [id]);

  if (err) return <div className="pad"><div className="errbox" role="alert">{err}</div></div>;
  if (!d) return <div className="pad"><p className="empty">Loading…</p></div>;

  const a = d.activity;
  const km = a.distance_m ? a.distance_m / 1000 : 0;
  const live = d.segments.filter((s) => s.role !== "stub");
  const hasSegments = live.filter((s) => s.role === "work").length > 0;
  const rows = tab === "segments" && hasSegments ? live : d.splits;

  return (
    <div>
      <div className="hero">
        <div className="eyebrow">
          {fmt(a.local_date, { weekday: "short", day: "numeric", month: "long" })}
          {a.sport_type ? ` · ${kindLabel(a.sport_type)}` : ""}
          {a.user_id !== meId ? ` · ${a.display_name}` : ""}
        </div>
        <h1 className="h1" style={{ marginTop: 7 }}>{a.name ?? "Activity"}</h1>
      </div>

      {d.detail_pending && (
        <div className="band">
          <p className="muted">
            Splits and graphs for this one haven&apos;t imported yet. The hourly sweep
            picks it up.
          </p>
        </div>
      )}

      {/* -------------------------------------------------------- headline */}
      <div className="band">
        <div className="statgrid">
          <Stat l="Distance" v={km ? km.toFixed(2) : "—"} />
          <Stat l="Moving" v={hms(a.moving_seconds)} />
          <Stat l="Avg pace" v={pace(a.avg_speed_ms)} />
          <Stat l="Avg HR" v={a.avg_hr ? String(Math.round(a.avg_hr)) : "—"} />
          <Stat l="Max HR" v={a.max_hr ? String(Math.round(a.max_hr)) : "—"} />
          <Stat l="Elevation" v={a.elevation_m != null ? `${Math.round(a.elevation_m)}` : "—"} />
        </div>
      </div>

      {/* ------------------------------------------------------------ route */}
      {d.route.length > 1 && (
        <div style={{ background: "var(--paper)", borderBottom: "1px solid var(--line)" }}>
          <RouteMap points={d.route} activityId={a.id} basemap={d.basemap} />
          <div className="rowsplit" style={{ padding: "10px 18px 14px" }}>
            <span style={{ fontSize: 11, color: "var(--ink-40)" }}>{d.route.length} GPS points</span>
            <span className="eyebrow" style={{ fontSize: 10 }}>GPS · Strava</span>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- HR trace */}
      {d.series?.hr.some((v) => v != null) && (
        <div className="band">
          <div className="rowsplit">
            <span className="caps" style={{ color: "var(--ink)" }}>Heart rate</span>
            <span style={{ fontSize: 11, color: "var(--ink-55)" }}>
              {a.avg_hr ? `avg ${Math.round(a.avg_hr)}` : ""}
              {a.max_hr ? ` · max ${Math.round(a.max_hr)}` : ""}
            </span>
          </div>
          <Trace series={d.series} field="hr" segments={live} format={(v) => `${Math.round(v)} bpm`} />
        </div>
      )}

      {/* ----------------------------------------------------------- zones */}
      {d.zoneTotal > 0 && (
        <div className="band">
          <div className="rowsplit">
            <span className="caps" style={{ color: "var(--ink)" }}>Heart rate zones</span>
            <span style={{ fontSize: 11, color: "var(--ink-55)" }}>{hms(d.zoneTotal)} with a strap</span>
          </div>
          {d.zones.map((z) => (
            <div className="zone" key={z.tag}>
              <span className="zt"><i style={{ background: z.colour }} />{z.tag}</span>
              <span className="track"><i style={{ width: `${z.pct}%`, background: z.colour }} /></span>
              <span className="pct">{z.pct}%</span>
              <span className="rng">{z.label}</span>
            </div>
          ))}
          <p style={{ fontSize: 10, color: "var(--ink-40)", lineHeight: 1.5 }}>
            Counted off the raw stream with its own timestamps, so a watch that drops to
            smart recording still reports the right minutes. Zones are set from max 189.
          </p>
        </div>
      )}

      {/* ------------------------------------------------------------ pace */}
      {km > 0.1 && d.series?.speed.some((v) => v != null && v > 0.5) && (
        <div className="band">
          <div className="rowsplit">
            <span className="caps" style={{ color: "var(--ink)" }}>Pace</span>
            <span style={{ fontSize: 11, color: "var(--ink-55)" }}>min/km</span>
          </div>
          <Trace series={d.series} field="speed" segments={live}
            format={(v) => `${pace(v)} /km`} paceAxis />
        </div>
      )}

      {/* ----------------------------------------------------------- splits */}
      {rows.length > 0 && (
        <div className="band">
          <div className="rowsplit">
            <span className="caps" style={{ color: "var(--ink)" }}>
              {tab === "segments" && hasSegments ? "Segments" : "Kilometre splits"}
            </span>
            {hasSegments && d.splits.length > 0 && (
              <div className="pillrow" style={{ padding: 3 }}>
                <button aria-pressed={tab === "segments"} onClick={() => setTab("segments")}>Segments</button>
                <button aria-pressed={tab === "km"} onClick={() => setTab("km")}>Km</button>
              </div>
            )}
          </div>
          <div className="splithead">
            <span>{tab === "segments" && hasSegments ? "Type" : "Km"}</span><span />
            <span style={{ textAlign: "right" }}>{tab === "segments" && hasSegments ? "Time" : "Pace"}</span>
            <span style={{ textAlign: "right" }}>HR</span>
          </div>
          <SplitRows rows={rows} isSegments={tab === "segments" && hasSegments} />
          {tab === "segments" && hasSegments && (
            <p style={{ fontSize: 10, color: "var(--ink-40)", lineHeight: 1.5 }}>
              Work and recovery are separated by lap speed — Strava doesn&apos;t label them.
              Warm-up and cool-down are counted on their own.
            </p>
          )}
        </div>
      )}

      {/* ---------------------------------------------- work vs recovery */}
      {d.isIntervals && (
        <div className="band">
          <span className="caps" style={{ color: "var(--ink)" }}>Work vs recovery</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <RoleCard title="Work" s={d.stats.work} accent="var(--navy)" />
            <RoleCard title="Recovery" s={d.stats.rest} accent="var(--ink-40)" />
          </div>
        </div>
      )}

      {/* --------------------------------------------- prescribed vs logged */}
      {a.session_title && (
        <div className="band">
          <span className="caps" style={{ color: "var(--ink)" }}>Prescribed vs logged</span>
          <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-70)" }}>
            {a.session_title}
            {a.planned_minutes ? ` · ${a.planned_minutes} min planned` : ""}
            {a.moving_seconds ? ` · ${Math.round(a.moving_seconds / 60)} min logged` : ""}
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span className={`tag ${a.session_status === "done" ? "done" : a.session_status === "adjusted" ? "adj" : "plan"}`}>
              {a.session_status ?? "planned"}
            </span>
            {a.effort_points ? <span className="tag plan">{a.effort_points} effort points</span> : null}
          </div>
        </div>
      )}

      <div className="pad">
        <a href={`https://www.strava.com/activities/${a.provider_activity_id}`}
          target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Open on Strava ↗</a>
      </div>
    </div>
  );
}

const Stat = ({ l, v }: { l: string; v: string }) => (
  <div><div className="l">{l}</div><div className="v">{v}</div></div>
);

function RoleCard({ title, s, accent }: { title: string; s: Stats; accent: string }) {
  return (
    <div className="card" style={{ padding: 13, borderLeft: `2px solid ${accent}` }}>
      <div className="rowsplit" style={{ marginBottom: 8 }}>
        <span className="caps" style={{ fontSize: 10, color: "var(--ink)" }}>{title}</span>
        <span style={{ fontSize: 10, color: "var(--ink-40)" }}>{s.count}×</span>
      </div>
      {[
        ["Avg HR", s.avg_hr ? `${Math.round(s.avg_hr)}` : "—"],
        [title === "Work" ? "Peak" : "Highest", s.peak_segment_hr ? `${Math.round(s.peak_segment_hr)}` : "—"],
        [title === "Work" ? "Easiest" : "Lowest", s.lowest_segment_hr ? `${Math.round(s.lowest_segment_hr)}` : "—"],
        ["Total time", hms(s.moving_seconds)],
        // a standing recovery has a pace, and it is nonsense; suppress it rather
        // than print "avg 35:17 /km" next to a set of 90-second rests
        ["Avg pace", s.avg_speed_ms && s.avg_speed_ms >= MOVING_MS ? pace(s.avg_speed_ms) : "—"],
        ["Best", s.best_speed_ms && s.best_speed_ms >= MOVING_MS ? pace(s.best_speed_ms) : "—"],
      ].map(([k, v]) => (
        <div key={k} className="rowsplit" style={{ padding: "4px 0", fontSize: 12 }}>
          <span style={{ color: "var(--ink-55)" }}>{k}</span>
          <span className="mono" style={{ fontWeight: 600 }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Below this, "pace" stops meaning anything. A standing recovery between reps
 * covers a few metres in ninety seconds, which is a true 43:52/km and a useless
 * thing to print — the number a coach reads there is the duration.
 */
const MOVING_MS = 1.2; // ~13:50/km, slower than a walk

function SplitRows({ rows, isSegments }: { rows: (Segment | Split)[]; isSegments: boolean }) {
  // Segments are read as durations (a rep is "400m in 84s"), kilometre splits as
  // pace. So the bar encodes time for one and speed for the other, rather than
  // one encoding that suits neither.
  const secs = rows.map((r) => Number(r.moving_seconds) || 0);
  const longest = Math.max(...secs, 1);
  const speeds = rows.map((r) => Number(r.avg_speed_ms) || 0);
  const fastest = Math.max(...speeds, 0.01);

  return (
    <>
      {rows.map((r, i) => {
        const seg = r as Segment;
        const sp = r as Split;
        const label = isSegments ? ROLE_LABEL[seg.role] : `${sp.split} km`;
        const isWork = isSegments && seg.role === "work";
        const speed = Number(r.avg_speed_ms) || 0;
        const moving = speed >= MOVING_MS;
        const width = isSegments
          ? ((Number(r.moving_seconds) || 0) / longest) * 100
          : (speed / fastest) * 100;
        return (
          <div className="splitrow" key={i}>
            <span className="lb" style={{ color: isWork ? "var(--ink)" : "var(--ink-55)" }}>{label}</span>
            <span className="bar">
              <i className={isWork ? "work" : undefined} style={{ width: `${Math.max(2, width)}%` }} />
            </span>
            <span className="pc mono">
              {isSegments
                ? hms(r.moving_seconds)
                : moving ? pace(r.avg_speed_ms) : "—"}
            </span>
            <span className="hr mono">{r.avg_hr ? Math.round(Number(r.avg_hr)) : "—"}</span>
          </div>
        );
      })}
    </>
  );
}

/**
 * One measure over elapsed time, with the interval structure shaded behind it.
 *
 * Two stacked charts rather than one with twin axes: bpm and min/km share no
 * scale, and overlaying them on two y-axes lets a reader see a crossing point
 * that means nothing.
 */
function Trace({
  series, field, segments, format, paceAxis,
}: {
  series: NonNullable<Payload["series"]>;
  field: "hr" | "speed";
  segments: Segment[];
  format: (v: number) => string;
  paceAxis?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(340);
  const [hover, setHover] = useState<number | null>(null);
  const H = 116, PAD = { l: 34, r: 6, t: 8, b: 4 };

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, e.contentRect.width)));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  const vals = series[field];
  const { lo, hi, path, ticks } = useMemo(() => {
    const nums = vals.filter((v): v is number => v != null);
    if (!nums.length) return { lo: 0, hi: 1, path: "", ticks: [] as number[] };
    let lo: number, hi: number;
    if (paceAxis) {
      // Pace is 1000/speed and explodes toward zero, so one traffic light would
      // squash the whole run into a few pixels. Domain is the 2nd–98th centile.
      const s = [...nums].sort((a, b) => a - b);
      lo = s[Math.floor(0.02 * s.length)]; hi = s[Math.floor(0.98 * s.length)];
      if (!(hi > lo)) { lo = s[0]; hi = s[s.length - 1]; }
    } else { lo = Math.min(...nums); hi = Math.max(...nums); }
    const p = (hi - lo) * 0.08 || 1; lo -= p; hi += p;

    const tMax = series.t[series.t.length - 1] || 1;
    const px = (t: number) => PAD.l + (t / tMax) * (w - PAD.l - PAD.r);
    const py = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b - 12);
    let dstr = "", pen = false;
    vals.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      const y = py(Math.max(lo, Math.min(hi, v)));
      dstr += `${pen ? "L" : "M"}${px(series.t[i]).toFixed(1)} ${y.toFixed(1)}`;
      pen = true;
    });
    const step = (hi - lo) / 3;
    return { lo, hi, path: dstr, ticks: [0, 1, 2, 3].map((i) => lo + i * step) };
  }, [vals, series.t, w, paceAxis]);

  const tMax = series.t[series.t.length - 1] || 1;
  const px = (t: number) => PAD.l + (t / tMax) * (w - PAD.l - PAD.r);
  const py = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b - 12);
  const hv = hover != null ? vals[hover] : null;

  return (
    <div className="chartwrap" ref={box}>
      <svg viewBox={`0 0 ${w} ${H}`} height={H} role="img" aria-label="Trace over time"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const t = (((e.clientX - r.left) / r.width * w) - PAD.l) / (w - PAD.l - PAD.r) * tMax;
          let best = 0, bd = Infinity;
          series.t.forEach((tt, i) => { const dd = Math.abs(tt - t); if (dd < bd) { bd = dd; best = i; } });
          setHover(best);
        }}
        onPointerLeave={() => setHover(null)}>
        {segments.filter((s) => s.role === "work").map((s) => {
          const x1 = px(s.start_s), x2 = px(Math.min(s.end_s, tMax));
          return x2 - x1 < 0.5 ? null : (
            <rect key={s.lap_index} x={x1} y={PAD.t} width={x2 - x1}
              height={H - PAD.t - PAD.b - 12} fill="var(--teal-tint)" />
          );
        })}
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={py(v)} x2={w - PAD.r} y2={py(v)} stroke="var(--grid)" />
            <text x={PAD.l - 5} y={py(v) + 3.5} textAnchor="end"
              style={{ fontSize: 9, fill: "var(--ink-40)" }}>
              {paceAxis ? pace(v) : Math.round(v)}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="#0A8FB0" strokeWidth="1.8" strokeLinejoin="round" />
        {hover != null && hv != null && (
          <>
            <line x1={px(series.t[hover])} y1={PAD.t} x2={px(series.t[hover])}
              y2={H - PAD.b - 12} stroke="var(--ink-40)" />
            <circle cx={px(series.t[hover])} cy={py(hv)} r="4" fill="#0A8FB0"
              stroke="var(--paper)" strokeWidth="2" />
          </>
        )}
      </svg>
      <div className="axis">
        <span>0:00</span>
        <span style={{ fontWeight: 600, color: "var(--ink)" }}>
          {hover != null && hv != null
            ? `${format(hv)} · ${hms(series.t[hover])}${series.dist[hover] ? ` · ${(series.dist[hover] / 1000).toFixed(2)} km` : ""}`
            : ""}
        </span>
        <span>{hms(tMax)}</span>
      </div>
    </div>
  );
}

function RouteMap({ points, activityId, basemap }: {
  points: [number, number][]; activityId: string; basemap: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const { d, vb } = useMemo(() => {
    const lats = points.map((p) => p[0]), lngs = points.map((p) => p[1]);
    const kx = Math.cos(((Math.min(...lats) + Math.max(...lats)) / 2 * Math.PI) / 180);
    const xs = lngs.map((l) => l * kx);
    const minX = Math.min(...xs), maxY = Math.max(...lats);
    const spanX = Math.max(...xs) - minX || 1e-6;
    const spanY = maxY - Math.min(...lats) || 1e-6;
    const pad = Math.max(spanX, spanY) * 0.06;
    return {
      d: points.map(([la, ln], i) => `${i ? "L" : "M"}${(ln * kx - minX).toFixed(6)} ${(maxY - la).toFixed(6)}`).join(""),
      vb: `${-pad} ${-pad} ${spanX + pad * 2} ${spanY + pad * 2}`,
    };
  }, [points]);

  return (
    <div className="routebox">
      {basemap && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/activity/${activityId}/map`} alt="Route recorded by GPS"
          onError={() => setFailed(true)} />
      ) : (
        <svg viewBox={vb} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Route">
          <path d={d} fill="none" stroke="#0A8FB0" strokeWidth="2.5"
            vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}
