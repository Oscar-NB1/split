"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmt } from "@/lib/dates";
import { hms, pace, ROLE_LABEL, type Role, type Segment } from "@/lib/analysis";

type Stats = {
  count: number; distance_m: number; moving_seconds: number;
  avg_hr: number | null; peak_segment_hr: number | null; lowest_segment_hr: number | null;
  max_hr: number | null; avg_speed_ms: number | null; best_speed_ms: number | null;
};
type Split = {
  split: number; distance_m: number | null; moving_seconds: number | null;
  avg_speed_ms: number | null; avg_hr: number | null; elevation_diff_m: number | null;
};
type Payload = {
  activity: {
    id: string; name: string | null; sport_type: string | null; local_date: string;
    start_time: string; display_name: string; user_id: string;
    moving_seconds: number | null; elapsed_seconds: number | null;
    distance_m: number | null; elevation_m: number | null;
    avg_hr: number | null; max_hr: number | null; avg_speed_ms: number | null;
    session_title: string | null; planned_minutes: number | null;
    session_status: string | null; effort_points: number | null;
    provider_activity_id: string;
  };
  segments: Segment[];
  isIntervals: boolean;
  stats: Record<"work" | "rest" | "steady" | "warmup" | "cooldown", Stats>;
  splits: Split[];
  series: { t: number[]; hr: (number | null)[]; speed: (number | null)[]; dist: number[]; alt: (number | null)[] } | null;
  route: [number, number][];
  /** Whether MAPBOX_TOKEN is set. The client can't see the token itself. */
  basemap: boolean;
  detail_pending: boolean;
};

const PLOT_H = 168;
const PAD = { l: 44, r: 10, t: 10, b: 20 };

/** A shaded region behind a chart: either a work rep, or a kilometre. */
type Band = { key: number; start_s: number; end_s: number; label: string };

/**
 * Kilometre boundaries in elapsed time, read off the distance stream.
 *
 * Used when a session has no interval structure to shade — a steady run still
 * benefits from knowing where each kilometre fell on the HR trace. Alternate
 * kilometres are shaded, so the bands read as a repeating rhythm rather than as
 * "these kilometres were special".
 */
function kilometreBands(series: NonNullable<Payload["series"]>): Band[] {
  const out: Band[] = [];
  let target = 1000;
  let startT = series.t[0] ?? 0;
  for (let i = 0; i < series.dist.length; i++) {
    if (series.dist[i] >= target) {
      const km = Math.round(target / 1000);
      // every other kilometre, so consecutive bands don't merge into one block
      if (km % 2 === 0) out.push({ key: km, start_s: startT, end_s: series.t[i], label: String(km) });
      startT = series.t[i];
      target += 1000;
    }
  }
  return out;
}

export default function ActivityDetail({ id, meId }: { id: string; meId: string }) {
  const [d, setD] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Shared between both charts, so one crosshair moves on both at once. */
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/activity/${id}`)
      .then(async (res) => {
        if (res.status === 401) { location.href = "/login"; return null; }
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "failed");
        return res.json();
      })
      .then((j) => { if (live && j) setD(j); })
      .catch((e) => live && setError(String(e.message ?? e)));
    return () => { live = false; };
  }, [id]);

  if (error) return <div className="errbox" role="alert">{error}</div>;
  if (!d) return <div className="note">Loading…</div>;

  const a = d.activity;
  const mine = a.user_id === meId;
  const km = a.distance_m ? a.distance_m / 1000 : 0;
  const live = d.segments.filter((s) => s.role !== "stub");

  // Shade the reps if there are reps; otherwise shade alternate kilometres, so a
  // steady run's HR trace still has something to read distance against.
  // Computed inline rather than in a hook: this sits after an early return, and
  // 500 points is not worth a hook-ordering hazard.
  const workBands: Band[] = live
    .filter((s) => s.role === "work")
    .map((s) => ({ key: s.lap_index, start_s: s.start_s, end_s: s.end_s, label: String(s.lap_index) }));
  const bands = workBands.length > 0
    ? workBands
    : d.series && km > 0.1 ? kilometreBands(d.series) : [];
  const bandNote = workBands.length > 0 ? "work reps" : "alternate km";

  return (
    <div className="adet">
      <a className="backlink" href="/">← Week</a>

      <div className="eyebrow">
        {fmt(a.local_date, { weekday: "long", day: "numeric", month: "long" })}
        {" · "}{mine ? "You" : a.display_name}
        {a.sport_type ? ` · ${a.sport_type.replace(/([a-z])([A-Z])/g, "$1 $2")}` : ""}
      </div>
      <h2 className={`adet-title ${mine ? "a" : "b"}`}>{a.name ?? "Activity"}</h2>

      {a.session_title && (
        <p className="note">
          Paired with <b>{a.session_title}</b>
          {a.planned_minutes ? ` · ${a.planned_minutes} min planned` : ""}
          {a.session_status ? ` · ${a.session_status}` : ""}
          {a.effort_points ? ` · ${a.effort_points} effort points` : ""}
        </p>
      )}

      {/* ---------------------------------------------------------- headline */}
      <div className="statgrid">
        <Stat label="Distance" value={km ? km.toFixed(2) : "—"} unit={km ? "km" : ""} />
        <Stat label="Moving" value={hms(a.moving_seconds)} />
        <Stat label="Avg pace" value={pace(a.avg_speed_ms)} unit={a.avg_speed_ms ? "/km" : ""} />
        <Stat label="Avg HR" value={a.avg_hr ? String(Math.round(a.avg_hr)) : "—"} unit={a.avg_hr ? "bpm" : ""} />
        <Stat label="Max HR" value={a.max_hr ? String(Math.round(a.max_hr)) : "—"} unit={a.max_hr ? "bpm" : ""} />
        <Stat label="Elevation" value={a.elevation_m != null ? String(Math.round(a.elevation_m)) : "—"} unit={a.elevation_m != null ? "m" : ""} />
      </div>

      {d.detail_pending && (
        <div className="warnbox">
          Splits, segments and the graphs for this one haven&apos;t been imported yet.
          The hourly sweep picks it up, or run <span className="mono">npm run strava:detail</span>.
        </div>
      )}

      {/* ------------------------------------------------- work vs recovery */}
      {d.isIntervals ? (
        <>
          <h3 className="sechead">
            Segments <span className="dimlabel">{d.stats.work.count} work · {d.stats.rest.count} recovery</span>
          </h3>
          <div className="cmpgrid">
            <RoleCard title="Work" s={d.stats.work} kind="work" />
            <RoleCard title="Recovery" s={d.stats.rest} kind="rest" />
          </div>
          <p className="note">
            Work and recovery are separated by lap speed — Strava doesn&apos;t label them.
            Warm-up and cool-down are counted on their own, so they don&apos;t flatter the
            recovery averages.
          </p>
        </>
      ) : live.length > 1 ? (
        <>
          <h3 className="sechead">
            Segments <span className="dimlabel">steady · {live.length} laps</span>
          </h3>
          <div className="cmpgrid">
            <RoleCard title="All laps" s={d.stats.steady} kind="work" />
          </div>
        </>
      ) : null}

      {/* -------------------------------------------------------- the graphs */}
      {d.series && d.series.t.length > 1 ? (
        <>
          {d.series.hr.some((v) => v != null) && (
            <Chart
              title="Heart rate" unit="bpm" series={d.series} field="hr"
              segments={live} bands={bands} bandNote={bandNote}
              hover={hover} setHover={setHover}
              format={(v) => `${Math.round(v)} bpm`}
            />
          )}
          {/* Gym sessions carry a velocity stream of near-zeros, which drew a
              flat line against an axis labelled 16:40 and 50:00 per km. A pace
              chart needs the activity to have actually covered ground. */}
          {km > 0.1 && d.series.speed.some((v) => v != null && v > 0.5) && (
            <Chart
              title="Pace" unit="min/km" series={d.series} field="speed"
              segments={live} bands={bands} bandNote={bandNote}
              hover={hover} setHover={setHover}
              format={(v) => `${pace(v)} /km`} tickFormat={(v) => pace(v)} tickMode="pace"
            />
          )}
        </>
      ) : (
        !d.detail_pending && <p className="note">No time series for this activity.</p>
      )}

      {/* ----------------------------------------------------------- the map */}
      {d.route.length > 1 && (
        <RouteMap points={d.route} mine={mine} activityId={a.id} basemap={d.basemap} />
      )}

      {/* --------------------------------------------------------- the table */}
      {/* one lap is not a segment breakdown — it repeats the headline numbers */}
      {live.length > 1 && (
        <details className="tableview" open>
          <summary>Segment table</summary>
          <div className="tablewrap">
            <table className="dtable mono">
              <thead>
                <tr>
                  <th>#</th><th>Type</th><th>Dist</th><th>Time</th>
                  <th>Pace</th><th>Avg HR</th><th>Max HR</th>
                </tr>
              </thead>
              <tbody>
                {live.map((s) => (
                  <tr key={s.lap_index} className={`r-${s.role}`}>
                    <td>{s.lap_index}</td>
                    <td className="rolecell">{ROLE_LABEL[s.role]}</td>
                    <td>{s.distance_m ? Math.round(s.distance_m) + " m" : "—"}</td>
                    <td>{hms(s.moving_seconds)}</td>
                    <td>{pace(s.avg_speed_ms)}</td>
                    <td>{s.avg_hr ? Math.round(s.avg_hr) : "—"}</td>
                    <td>{s.max_hr ? Math.round(s.max_hr) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {d.splits.length > 0 && (
        <details className="tableview">
          <summary>Kilometre splits</summary>
          <div className="tablewrap">
            <table className="dtable mono">
              <thead>
                <tr><th>Km</th><th>Time</th><th>Pace</th><th>Avg HR</th><th>Elev</th></tr>
              </thead>
              <tbody>
                {d.splits.map((s) => (
                  <tr key={s.split}>
                    <td>{s.split}</td>
                    <td>{hms(s.moving_seconds)}</td>
                    <td>{pace(s.avg_speed_ms)}</td>
                    <td>{s.avg_hr ? Math.round(s.avg_hr) : "—"}</td>
                    <td>{s.elevation_diff_m != null ? `${s.elevation_diff_m > 0 ? "+" : ""}${Math.round(s.elevation_diff_m)}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <p className="note">
        <a href={`https://www.strava.com/activities/${a.provider_activity_id}`}
          target="_blank" rel="noreferrer">Open on Strava ↗</a>
      </p>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="stat">
      <div className="lab">{label}</div>
      <div className="statval disp">{value}{unit ? <span className="u">{unit}</span> : null}</div>
    </div>
  );
}

function RoleCard({ title, s, kind }: { title: string; s: Stats; kind: "work" | "rest" }) {
  return (
    <div className={`rolecard ${kind}`}>
      <div className="rolehead">
        <span>{title}</span>
        <span className="dimlabel">{s.count} × · {hms(s.moving_seconds)}</span>
      </div>
      <dl>
        <Row k="Avg HR" v={s.avg_hr ? `${Math.round(s.avg_hr)} bpm` : "—"} />
        <Row k={kind === "work" ? "Peak segment HR" : "Highest segment HR"}
          v={s.peak_segment_hr ? `${Math.round(s.peak_segment_hr)} bpm` : "—"} />
        <Row k={kind === "work" ? "Easiest segment HR" : "Lowest segment HR"}
          v={s.lowest_segment_hr ? `${Math.round(s.lowest_segment_hr)} bpm` : "—"} />
        <Row k="Max HR" v={s.max_hr ? `${Math.round(s.max_hr)} bpm` : "—"} />
        <Row k="Avg pace" v={s.avg_speed_ms ? `${pace(s.avg_speed_ms)} /km` : "—"} />
        <Row k="Best pace" v={s.best_speed_ms ? `${pace(s.best_speed_ms)} /km` : "—"} />
        <Row k="Distance" v={s.distance_m ? `${(s.distance_m / 1000).toFixed(2)} km` : "—"} />
      </dl>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="drow"><dt>{k}</dt><dd className="mono">{v}</dd></div>
);

/**
 * One measure over elapsed time, with the interval structure shaded behind it.
 *
 * Deliberately two stacked charts rather than one with two y-axes: HR in bpm and
 * pace in min/km share no scale, and overlaying them on twin axes lets the
 * reader see a crossing point that means nothing. The x-axis and the crosshair
 * are shared instead, which is what makes them comparable.
 */
function Chart({
  title, unit, series, field, segments, bands, bandNote, hover, setHover, format,
  tickFormat, tickMode,
}: {
  title: string; unit: string;
  series: NonNullable<Payload["series"]>;
  field: "hr" | "speed";
  /** Only for the hover readout — which segment the pointer is inside. */
  segments: Segment[];
  bands: Band[];
  bandNote: string;
  hover: number | null;
  setHover: (i: number | null) => void;
  format: (v: number) => string;
  tickFormat?: (v: number) => string;
  /** "pace" puts gridlines on round min/km values instead of round m/s ones. */
  tickMode?: "linear" | "pace";
}) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  const vals = series[field];
  const { yMin, yMax, path, ticks, clamped } = useMemo(() => {
    const nums = vals.filter((v): v is number => v != null);
    if (!nums.length) return { yMin: 0, yMax: 1, path: "", ticks: [] as number[], clamped: 0 };

    let lo: number, hi: number;
    if (tickMode === "pace") {
      // Pace is 1000/speed, so it explodes as the watch approaches zero: one
      // traffic light gives a 40:00/km sample and the entire real range gets
      // squashed into the top few pixels. The domain is therefore taken from the
      // 2nd-98th percentile and out-of-range points are drawn on the edge —
      // with the count reported, so trimming is never silent.
      const sorted = [...nums].sort((a, b) => a - b);
      const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
      lo = q(0.02); hi = q(0.98);
      if (!(hi > lo)) { lo = sorted[0]; hi = sorted[sorted.length - 1]; }
    } else {
      lo = Math.min(...nums); hi = Math.max(...nums);
    }
    const padY = (hi - lo) * 0.08 || 1;
    lo -= padY; hi += padY;

    const tMax = series.t[series.t.length - 1] || 1;
    const px = (t: number) => PAD.l + (t / tMax) * (w - PAD.l - PAD.r);
    const py = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * PLOT_H;

    // a null run (strap dropout) breaks the line rather than bridging a gap
    // that was never measured
    let dstr = "";
    let pen = false;
    let clamped = 0;
    vals.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      if (v < lo || v > hi) clamped++;
      const y = py(Math.max(lo, Math.min(hi, v)));
      dstr += `${pen ? "L" : "M"}${px(series.t[i]).toFixed(1)} ${y.toFixed(1)}`;
      pen = true;
    });

    // The pace axis is linear in speed but *labelled* in min/km, and pace is
    // 1000/speed — so evenly spaced gridlines land on values like 2:57, 4:01,
    // 6:15, 14:14. Ticks are chosen in pace space and mapped back to speed, so
    // they read 3:30, 4:00, 5:00 while the geometry stays honest.
    let ticks: number[];
    if (tickMode === "pace" && lo > 0) {
      const slowest = 1000 / lo, fastest = 1000 / hi; // seconds per km
      const span = slowest - fastest;
      // smallest step giving at most six gridlines: a run with one near-stopped
      // moment has a wide pace range, and insisting on four ticks leaves it with
      // two gridlines over the whole plot
      const step = [15, 30, 60, 120, 300, 600].find((s) => span / s <= 6) ?? 900;
      ticks = [];
      for (let s = Math.ceil(fastest / step) * step; s <= slowest; s += step) {
        ticks.push(1000 / s);
      }
      // a very flat run can produce fewer than two gridlines; fall back
      if (ticks.length < 2) ticks = [0, 1, 2, 3].map((i) => lo + (i * (hi - lo)) / 3);
    } else {
      const step = (hi - lo) / 3;
      ticks = [0, 1, 2, 3].map((i) => lo + i * step);
    }
    return { yMin: lo, yMax: hi, path: dstr, ticks, clamped };
  }, [vals, series.t, w, tickMode]);

  const tMax = series.t[series.t.length - 1] || 1;
  const px = (t: number) => PAD.l + (t / tMax) * (w - PAD.l - PAD.r);
  const py = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * PLOT_H;
  const H = PLOT_H + PAD.t + PAD.b;

  /** Nearest sample to the pointer, by x. */
  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * w;
    const t = ((x - PAD.l) / (w - PAD.l - PAD.r)) * tMax;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < series.t.length; i++) {
      const dd = Math.abs(series.t[i] - t);
      if (dd < bestD) { bestD = dd; best = i; }
    }
    setHover(best);
  }

  const hv = hover != null ? vals[hover] : null;
  const hoveredSeg = hover != null
    ? segments.find((s) => series.t[hover] >= s.start_s && series.t[hover] < s.end_s)
    : undefined;

  return (
    <figure className="chart" ref={box}>
      <figcaption>
        <span className="chartttl">{title}</span>
        <span className="dimlabel">{unit}</span>
        {bands.length > 0 && <span className="dimlabel">shaded: {bandNote}</span>}
        {clamped > 0 && (
          <span className="dimlabel" title="Stops and pauses fall outside the axis and are drawn on its edge. Hover still reads the true value.">
            {clamped} point{clamped === 1 ? "" : "s"} off scale
          </span>
        )}
        {hover != null && hv != null && (
          <span className="readout mono">
            {format(hv)}
            <span className="sep">·</span>{hms(series.t[hover])}
            {series.dist[hover] ? <><span className="sep">·</span>{(series.dist[hover] / 1000).toFixed(2)} km</> : null}
            {hoveredSeg && <><span className="sep">·</span>{ROLE_LABEL[hoveredSeg.role]} {hoveredSeg.lap_index}</>}
          </span>
        )}
      </figcaption>
      <svg viewBox={`0 0 ${w} ${H}`} width="100%" height={H} role="img"
        aria-label={`${title} over time`}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {/* Structure behind the data: work reps where there are intervals,
            kilometres where there aren't. Bands are a surface lift, not a hue,
            and each carries its number — never colour alone. */}
        {bands.map((b) => {
          const x1 = px(b.start_s), x2 = px(Math.min(b.end_s, tMax));
          if (x2 - x1 < 0.5) return null;
          return (
            <g key={b.key}>
              <rect x={x1} y={PAD.t} width={x2 - x1} height={PLOT_H} className="band" />
              <line x1={x1} y1={PAD.t} x2={x1} y2={PAD.t + PLOT_H} className="bandedge" />
              {x2 - x1 > 14 && (
                <text x={(x1 + x2) / 2} y={PAD.t + 10} className="bandlab" textAnchor="middle">
                  {b.label}
                </text>
              )}
            </g>
          );
        })}

        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={py(v)} x2={w - PAD.r} y2={py(v)} className="grid" />
            <text x={PAD.l - 6} y={py(v) + 3.5} className="axlab" textAnchor="end">
              {tickFormat ? tickFormat(v) : Math.round(v)}
            </text>
          </g>
        ))}

        <path d={path} className="dataline" fill="none" />

        {hover != null && hv != null && (
          <>
            <line x1={px(series.t[hover])} y1={PAD.t} x2={px(series.t[hover])} y2={PAD.t + PLOT_H}
              className="crosshair" />
            <circle cx={px(series.t[hover])} cy={py(hv)} r="4.5" className="dot" />
          </>
        )}

        <text x={PAD.l} y={H - 6} className="axlab">0:00</text>
        <text x={w - PAD.r} y={H - 6} className="axlab" textAnchor="end">{hms(tMax)}</text>
      </svg>
    </figure>
  );
}

/**
 * The recorded route, from `map.summary_polyline` on the activity.
 *
 * Two renderings. With MAPBOX_TOKEN set, a rendered basemap arrives as one PNG
 * from our own proxy — Mapbox draws the line itself, so there is no mapping
 * library in the browser. Without a token, or if that request fails, the same
 * points are drawn as a bare outline: longitude scaled by cos(latitude) so the
 * shape isn't stretched sideways.
 *
 * The fallback is wired to the image's onError rather than only to the token
 * check, so a Mapbox outage degrades to the outline instead of a broken image.
 */
function RouteMap({
  points, mine, activityId, basemap,
}: { points: [number, number][]; mine: boolean; activityId: string; basemap: boolean }) {
  const [imgFailed, setImgFailed] = useState(false);
  const useBasemap = basemap && !imgFailed;
  const { d, vb } = useMemo(() => {
    const lats = points.map((p) => p[0]);
    const lngs = points.map((p) => p[1]);
    const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const kx = Math.cos((midLat * Math.PI) / 180);
    const xs = lngs.map((l) => l * kx);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...lats), maxY = Math.max(...lats);
    const spanX = maxX - minX || 1e-6, spanY = maxY - minY || 1e-6;
    const span = Math.max(spanX, spanY);
    const pad = span * 0.06;

    // y is flipped: latitude grows north, SVG grows down
    const str = points
      .map(([lat, lng], i) =>
        `${i ? "L" : "M"}${(lng * kx - minX).toFixed(6)} ${(maxY - lat).toFixed(6)}`)
      .join("");
    return {
      d: str,
      vb: `${-pad} ${-pad} ${spanX + pad * 2} ${spanY + pad * 2}`,
      spanX, spanY,
    };
  }, [points]);

  return (
    <figure className="chart routebox">
      <figcaption><span className="chartttl">Route</span>
        <span className="dimlabel">{points.length} points</span>
        {!useBasemap && basemap && <span className="dimlabel">basemap unavailable</span>}
      </figcaption>
      {useBasemap ? (
        // eslint-disable-next-line @next/next/no-img-element -- a proxied PNG of
        // fixed aspect; next/image would add an optimiser hop for no benefit
        <img className="routeimg" src={`/api/activity/${activityId}/map`} alt="Route recorded by GPS"
          onError={() => setImgFailed(true)} />
      ) : (
        <svg viewBox={vb} className="routesvg" role="img" aria-label="Route recorded by GPS"
          preserveAspectRatio="xMidYMid meet">
          <path d={d} className={`routeline ${mine ? "a" : "b"}`} fill="none"
            vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )}
    </figure>
  );
}
