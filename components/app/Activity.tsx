"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmt } from "@/lib/dates";
import { hms, pace, ROLE_LABEL, type Segment } from "@/lib/analysis";
import { kindColour, kindLabel } from "@/lib/coach";
import { prescribedPace } from "@/lib/signals";
import Thread from "./Thread";
import LogVoice from "./LogVoice";

const TEAL = "#0A8FB0", NAVY_D = "#0E2740", NAVY = "#12314D";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const OFF = "var(--off)", PAPER = "var(--paper)", LINE = "var(--line)";

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
    session_id: string | null; session_title: string | null; planned_minutes: number | null;
    session_status: string | null; effort_points: number | null;
  };
  segments: Segment[]; isIntervals: boolean;
  stats: Record<"work" | "rest" | "steady", Stats>;
  splits: Split[];
  series: { t: number[]; hr: (number | null)[]; speed: (number | null)[]; dist: number[] } | null;
  zones: ZoneRow[]; zoneTotal: number;
  race: { id: string; event_name: string | null; overall_seconds: number | null } | null;
  stationSplits: { label: string; seconds: number; kind: string; place: number | null }[];
  route: [number, number][]; basemap: boolean; detail_pending: boolean;
};

const heroStyle = (kind: string | null): React.CSSProperties => ({
  padding: "20px 18px 20px",
  background: `linear-gradient(165deg, color-mix(in srgb, ${kindColour(kind)} 14%, var(--off)) 0%, var(--off) 80%)`,
});
const band: React.CSSProperties = {
  padding: "16px 18px", background: PAPER, borderBottom: `1px solid ${LINE}`,
  display: "flex", flexDirection: "column", gap: 10,
};
const caps: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase",
};

export default function Activity({ id, meId }: { id: string; meId: string }) {
  const [d, setD] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"segments" | "laps">("segments");

  useEffect(() => {
    let live = true;
    fetch(`/api/activity/${id}`)
      .then(async (r) => {
        if (r.status === 401) { location.href = "/"; return null; }
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "failed");
        return r.json();
      })
      .then((j) => live && j && setD(j))
      .catch((e) => live && setErr(String(e.message ?? e)));
    return () => { live = false; };
  }, [id]);

  if (err) return <div style={{ padding: 18 }}><div className="errbox" role="alert">{err}</div></div>;
  if (!d) return <div style={{ padding: 18 }}><p className="empty">Loading…</p></div>;

  const a = d.activity;
  const km = a.distance_m ? a.distance_m / 1000 : 0;
  const live = d.segments.filter((s) => s.role !== "stub");
  const hasSegments = live.some((s) => s.role === "work");
  const prescribed = a.session_title ? prescribedPace(a.session_title) : null;
  const endT = d.series?.t[d.series.t.length - 1] ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={heroStyle(a.sport_type)}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em",
          textTransform: "uppercase", color: "var(--teal)" }}>
          {fmt(a.local_date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
          {a.sport_type ? ` · ${kindLabel(a.sport_type)}` : ""}
          {a.user_id !== meId ? ` · ${a.display_name}` : ""}
        </div>
        <div style={{ fontFamily: "var(--display)", fontSize: 25, fontWeight: 700,
          lineHeight: 1.1, letterSpacing: "-.02em", marginTop: 7 }}>{a.name ?? "Activity"}</div>
      </div>

      {/*
        * What this workout actually was.
        *
        * A workout nobody planned is where the gap is widest: Strava says "WeightTraining, 111
        * minutes" and there is no session card to carry the rest. Same component as the session
        * screen, without a session to attach to — so it logs against the activity and the day.
        */}
      {a.user_id === meId && (
        <LogVoice activityId={a.id} onDate={a.local_date} />
      )}

      {/*
        * Two payloads, an hour apart.
        *
        * Connecting pulls the summary — distance, time, pace, average heart rate
        * — because fetching per-activity detail for eight weeks inline would
        * exhaust Strava's rate limit and the function timeout. Laps, kilometre
        * splits and the heart-rate trace arrive on the hourly sweep. Saying so
        * is the difference between waiting and assuming it is broken.
        */}
      {d.detail_pending && (
        <div style={band}>
          <p className="muted">
            Still importing this one. Distance, pace and average heart rate are in;
            the splits and the heart-rate trace arrive within the hour, and the
            breakdown fills in on its own — there is nothing to do.
          </p>
        </div>
      )}

      {d.route.length > 1 && (
        <div style={{ background: PAPER, borderBottom: `1px solid ${LINE}` }}>
          <div style={{ position: "relative", width: "100%", height: 200, background: OFF }}>
            <RouteMap points={d.route} activityId={a.id} basemap={d.basemap} />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 10, padding: "10px 18px 14px" }}>
            <span style={{ fontSize: 11, color: INK40 }}>{d.route.length} GPS points</span>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em",
              textTransform: "uppercase", color: "var(--teal)" }}>GPS · Strava</span>
          </div>
        </div>
      )}

      <div style={band}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px 12px" }}>
          {[
            ["Distance", km ? km.toFixed(2) : "—"],
            ["Moving", hms(a.moving_seconds)],
            ["Avg pace", pace(a.avg_speed_ms)],
            ["Avg HR", a.avg_hr ? String(Math.round(a.avg_hr)) : "—"],
            ["Max HR", a.max_hr ? String(Math.round(a.max_hr)) : "—"],
            ["Elevation", a.elevation_m != null ? String(Math.round(a.elevation_m)) : "—"],
          ].map(([l, v]) => (
            <div key={l}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em",
                textTransform: "uppercase", color: INK55 }}>{l}</div>
              <div style={{ fontFamily: "var(--display)", fontSize: 20, fontWeight: 700,
                lineHeight: 1.15, marginTop: 3 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {d.series && d.series.hr.some((v) => v != null) && (
        <div style={band}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span style={caps}>Heart rate</span>
            <span style={{ fontSize: 11, color: INK55 }}>
              {a.avg_hr ? `avg ${Math.round(a.avg_hr)}` : ""}
              {a.max_hr ? ` · peak ${Math.round(a.max_hr)}` : ""}
            </span>
          </div>
          <HrChart series={d.series} segments={live} endT={endT} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: INK40 }}>
            <span>0:00</span><span>{hms(endT / 2)}</span><span>{hms(endT)}</span>
          </div>
        </div>
      )}

      {/*
        * Pace against the target.
        *
        * A heart-rate trace says how hard it felt; this says whether the session
        * was actually run as prescribed, which is the question the plan cares
        * about. One bar per segment, the target as a line across it, and the
        * colour is simply which side of the line the bar landed on.
        */}
      {/*
        * Shown whenever the run had reps in it, target or no target.
        *
        * This was gated on `prescribed`, which comes from the linked planned session's
        * title — so an interval session Strava had not matched to a plan, or one whose
        * title carries no pace, hid the chart entirely. "Did I hold an even pace across
        * eight reps" is worth answering on its own; the target is what turns it into
        * "did I hold the right one", and it is drawn when there is one.
        */}
      {live.filter((sg) => sg.role === "work" && sg.avg_speed_ms).length > 1 && (
        <div style={band}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span style={caps}>{prescribed ? "Pace against target" : "Pace per rep"}</span>
            <span style={{ fontSize: 11, color: INK55 }}>
              {prescribed ? `target ${pace(1000 / prescribed)} /km` : "no target on this one"}
            </span>
          </div>
          <PaceChart segments={live} prescribed={prescribed} />
          <span style={{ fontSize: 10, color: INK40, lineHeight: 1.5 }}>
            Work segments only — the recoveries are meant to be slow, so putting
            them on the same scale would flatten everything that matters.
          </span>
        </div>
      )}

      {d.zoneTotal > 0 && (
        <div style={band}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span style={caps}>Heart rate zones</span>
            <span style={{ fontSize: 11, color: INK55 }}>{hms(d.zoneTotal)} with a strap</span>
          </div>
          {d.zones.map((z) => (
            <div key={z.tag} style={{ display: "grid", gridTemplateColumns: "44px 1fr 34px 82px",
              alignItems: "center", gap: 8 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11,
                fontWeight: 700 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, flex: "none",
                  background: z.colour }} />
                {z.tag}
              </span>
              <div style={{ height: 15, background: OFF, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: 15, borderRadius: 3, width: `${z.pct}%`, background: z.colour }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, textAlign: "right",
                color: z.pct >= 25 ? "var(--ink)" : INK55 }}>{z.pct}%</span>
              <span style={{ fontSize: 11, color: INK40, textAlign: "right" }}>{z.label}</span>
            </div>
          ))}
        </div>
      )}

      {(hasSegments || d.splits.length > 0) && (
        <SplitTable d={d} view={view} setView={setView} hasSegments={hasSegments}
          prescribed={prescribed} />
      )}

      {a.session_title && (
        <div style={band}>
          <span style={caps}>Prescribed vs logged</span>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-70)" }}>
            {a.session_title}
            {a.planned_minutes ? ` · ${a.planned_minutes} min planned` : ""}
            {prescribed ? ` at ${pace(1000 / prescribed)} /km` : ""}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Verdict d={d} prescribed={prescribed} />
            <span style={{ fontSize: 11, fontWeight: 600, color: INK55, background: OFF,
              borderRadius: "var(--r-pill)", padding: "6px 12px" }}>
              {a.session_status === "adjusted" ? "Scaled down" : "Matched automatically"}
            </span>
          </div>
        </div>
      )}

      {d.race && d.stationSplits.length > 0 && (
        <div style={band}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span style={caps}>Station splits</span>
            <span style={{ fontSize: 11, color: INK55 }}>
              {d.race.event_name} · {hms(d.race.overall_seconds)}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 52px 54px", gap: 8,
            fontSize: 9, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase",
            color: INK40 }}>
            <span>Lap</span><span style={{ textAlign: "right" }}>Time</span>
            <span style={{ textAlign: "right" }}>Rank</span>
          </div>
          {d.stationSplits.map((r, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 52px 54px", gap: 8,
              alignItems: "center", padding: "5px 0", borderBottom: "1px solid var(--line-2)" }}>
              <span style={{ fontSize: 13, color: r.kind === "run" ? INK55 : "var(--ink)" }}>{r.label}</span>
              <span style={{ fontSize: 13, fontWeight: 700, textAlign: "right" }}>{hms(r.seconds)}</span>
              <span style={{ fontSize: 12, color: INK55, textAlign: "right" }}>
                {r.place ? `#${r.place}` : "—"}
              </span>
            </div>
          ))}
          <span style={{ fontSize: 10, color: INK40, lineHeight: 1.5 }}>
            From the official result, not the watch — Garmin numbers its laps rather than naming them.
          </span>
        </div>
      )}

      <Review d={d} prescribed={prescribed} />
      {a.session_id && <SessionFeedback sessionId={a.session_id} meId={meId} />}

      <div style={{ padding: "16px 18px 26px" }}>
        <a href={`https://www.strava.com/activities/${a.provider_activity_id}`}
          target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Open on Strava ↗</a>
      </div>
    </div>
  );
}

/**
 * The HR trace: area plus line, 330×100, two faint gridlines — as the design
 * draws it. The domain is padded 8 below and 6 above so the trace never touches
 * the frame; a line grazing the top edge reads as clipped even when it is not.
 */
/** Which segment roles get a band, and in what colour. */
const BAND: Record<string, string> = {
  work: "rgba(10,143,176,.13)",
  rest: "rgba(18,49,77,.05)",
};

function HrChart({
  series, segments, endT,
}: {
  series: NonNullable<Payload["series"]>;
  segments: Segment[];
  endT: number;
}) {
  const { line, area } = useMemo(() => {
    const W = 330, H = 100;
    const vals = series.hr;
    const nums = vals.filter((v): v is number => v != null);
    if (nums.length < 2) return { line: "", area: "" };
    const lo = Math.min(...nums) - 8, hi = Math.max(...nums) + 6;
    const pts: [number, number][] = [];
    vals.forEach((v, i) => {
      if (v == null) return;
      pts.push([(i / Math.max(1, vals.length - 1)) * W,
        H - ((v - lo) / (hi - lo)) * (H - 10) - 5]);
    });
    const l = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    return { line: l, area: `${l} L${W} ${H} L0 ${H} Z` };
  }, [series]);

  /*
   * The intervals, drawn behind the trace.
   *
   * A heart-rate line on its own cannot be read as a session: the peaks are
   * obviously reps and the dips obviously rests, but which rep, and whether the
   * warm-up ran long, is guesswork. Banding the segments turns the same curve
   * into something you can count.
   */
  const bands = useMemo(() => {
    if (!endT || segments.length < 2) return [];
    return segments
      .filter((sg) => BAND[sg.role])
      .map((sg) => {
        const dur = sg.elapsed_seconds ?? sg.moving_seconds ?? 0;
        return {
          key: `${sg.role}-${sg.start_s}`,
          x: (sg.start_s / endT) * 330,
          w: Math.max(0.6, (dur / endT) * 330),
          fill: BAND[sg.role],
        };
      });
  }, [segments, endT]);

  /*
   * Scrubbing: the rate at the moment you are pointing at.
   *
   * A trace tells you the shape of a session and refuses to tell you a number, which is
   * the one thing anybody looks at a heart-rate graph to find out — "how high did that
   * fourth rep actually get". Pointer events rather than mouse or touch handlers, so a
   * finger drag and a mouse hover are the same code path.
   */
  const [at, setAt] = useState<number | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const vals = series.hr;

  const read = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    setAt(Math.round(frac * Math.max(0, vals.length - 1)));
  };

  const bpm = at != null ? vals[at] : null;
  const secs = at != null && vals.length > 1
    ? Math.round((at / (vals.length - 1)) * endT) : null;
  const cursorX = at != null && vals.length > 1
    ? (at / (vals.length - 1)) * 330 : null;
  const clock = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;

  return (
    <div ref={box} style={{ position: "relative", touchAction: "pan-y" }}
      onPointerDown={(e) => read(e.clientX)}
      onPointerMove={(e) => { if (e.buttons || e.pointerType === "touch") read(e.clientX); }}
      onPointerLeave={() => setAt(null)}
      onPointerUp={() => { /* the readout stays until they point somewhere else */ }}>
      {bpm != null && cursorX != null && (
        /*
         * Placed by percentage and clamped, so the callout stays inside the card at both
         * ends rather than being cut off on the rep everybody wants to read — the last one.
         */
        <div style={{
          position: "absolute", top: -2, zIndex: 2, pointerEvents: "none",
          left: `${Math.max(6, Math.min(94, (cursorX / 330) * 100))}%`,
          transform: "translateX(-50%)",
          background: NAVY, color: "#fff", borderRadius: 7, padding: "4px 8px",
          fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
        }}>
          {bpm} bpm{secs != null ? ` · ${clock(secs)}` : ""}
        </div>
      )}
    <svg viewBox="0 0 330 100" preserveAspectRatio="none" style={{ width: "100%", height: 100 }}>
      {bands.map((b) => (
        <rect key={b.key} x={b.x} y={0} width={b.w} height={100} fill={b.fill} />
      ))}
      {/* A hairline at each boundary, so two work segments back to back still read
          as two rather than as one long effort. */}
      {bands.map((b) => (
        <line key={`e-${b.key}`} x1={b.x} y1={0} x2={b.x} y2={100}
          stroke="rgba(18,49,77,.16)" strokeWidth="0.5" />
      ))}
      <line x1="0" y1="30" x2="330" y2="30" stroke="rgba(18,49,77,.09)" />
      <line x1="0" y1="65" x2="330" y2="65" stroke="rgba(18,49,77,.09)" />
      <path d={area} fill="rgba(10,143,176,.16)" />
      <path d={line} fill="none" stroke={TEAL} strokeWidth="1.7" />
      {cursorX != null && (
        <line x1={cursorX} y1={0} x2={cursorX} y2={100} stroke={NAVY} strokeWidth="1" />
      )}
    </svg>
    </div>
  );
}

/**
 * Splits or segments, the bar scaled so the fastest is full width.
 *
 * A pace turns navy when a work rep came in more than 5 s/km FASTER than
 * prescribed. That is not praise: every rep faster than prescription is stolen
 * from Sunday, and willpower has failed four times on record.
 */
function SplitTable({
  d, view, setView, hasSegments, prescribed,
}: {
  d: Payload; view: "segments" | "laps"; setView: (v: "segments" | "laps") => void;
  hasSegments: boolean; prescribed: number | null;
}) {
  const live = d.segments.filter((s) => s.role !== "stub");
  const useSeg = hasSegments && view === "segments";
  const rows = useSeg
    ? live.map((s) => ({
        label: ROLE_LABEL[s.role], work: s.role === "work",
        per: s.avg_speed_ms ? 1000 / Number(s.avg_speed_ms) : 0,
        seconds: Number(s.moving_seconds) || 0, hr: s.avg_hr,
      }))
    : d.splits.map((s) => ({
        label: `${s.split} km`, work: false,
        per: s.avg_speed_ms ? 1000 / Number(s.avg_speed_ms) : 0,
        seconds: Number(s.moving_seconds) || 0, hr: s.avg_hr,
      }));
  if (rows.length === 0) return null;
  const paces = rows.filter((r) => r.per > 0).map((r) => r.per);
  const best = paces.length ? Math.min(...paces) : 1;

  return (
    <div style={band}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={caps}>{useSeg ? "Segments" : "Kilometre splits"}</span>
        {hasSegments && d.splits.length > 0 && (
          <div style={{ display: "flex", gap: 3, background: OFF,
            borderRadius: "var(--r-pill)", padding: 3 }}>
            {(["segments", "laps"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} style={{
                borderRadius: "var(--r-pill)", padding: "6px 12px", fontSize: 11, fontWeight: 700,
                background: view === v ? "var(--navy)" : "transparent",
                color: view === v ? "#fff" : INK55,
              }}>{v === "segments" ? "Segments" : "Km"}</button>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "68px 1fr 54px 44px", gap: 8,
        fontSize: 9, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase",
        color: INK40 }}>
        <span>{useSeg ? "Type" : "Km"}</span><span />
        <span style={{ textAlign: "right" }}>{useSeg ? "Time" : "Pace"}</span>
        <span style={{ textAlign: "right" }}>HR</span>
      </div>
      {rows.map((r, i) => {
        const tooFast = !!prescribed && r.work && r.per > 0 && r.per < prescribed - 5;
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "68px 1fr 54px 44px",
            alignItems: "center", gap: 8, padding: "5px 0",
            borderBottom: "1px solid var(--line-2)" }}>
            <span style={{ fontSize: 11, fontWeight: r.work ? 700 : 500,
              color: r.work ? "var(--ink)" : INK55 }}>{r.label}</span>
            <div style={{ height: 15, display: "flex", alignItems: "center" }}>
              <div style={{ height: 15, borderRadius: 3,
                width: `${Math.max(14, r.per > 0 ? (best / r.per) * 100 : 14).toFixed(0)}%`,
                background: r.work ? TEAL : "rgba(10,143,176,.35)" }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, textAlign: "right",
              color: tooFast ? NAVY_D : "var(--ink)" }}>
              {useSeg ? hms(r.seconds) : r.per > 0 ? pace(1000 / r.per) : "—"}
            </span>
            <span style={{ fontSize: 11, color: INK55, textAlign: "right" }}>
              {r.hr ? Math.round(Number(r.hr)) : "—"}
            </span>
          </div>
        );
      })}
      {useSeg && prescribed && (
        <span style={{ fontSize: 10, color: INK40, lineHeight: 1.5 }}>
          A navy pace is a rep run more than 5 s/km faster than prescribed. Every rep faster
          than prescription is stolen from Sunday.
        </span>
      )}
    </div>
  );
}

function Verdict({ d, prescribed }: { d: Payload; prescribed: number | null }) {
  const work = d.stats.work;
  const reps = d.segments.filter((s) => s.role === "work" && s.avg_speed_ms);
  const firstFastest = reps.length >= 3
    && reps.every((r, i) => i === 0 || Number(r.avg_speed_ms) <= Number(reps[0].avg_speed_ms));
  const tooFast = !!prescribed && !!work.avg_speed_ms && 1000 / work.avg_speed_ms < prescribed - 5;

  const [text, bg, fg] = firstFastest
    ? ["Rep 1 fastest — failed", "rgba(192,122,62,.16)", "#C07A3E"]
    : tooFast
      ? ["Run too fast", "rgba(232,192,81,.20)", "#8A6510"]
      : d.activity.session_status === "adjusted"
        ? ["Adjusted", OFF, INK55]
        : ["On prescription", "var(--teal-tint2)", TEAL];

  return (
    <span style={{ fontSize: 11, fontWeight: 700, borderRadius: "var(--r-pill)",
      padding: "6px 12px", background: bg, color: fg }}>{text}</span>
  );
}

/**
 * The review, computed rather than written.
 *
 * The design calls this "Auto review", and the architecture note puts the model
 * layer last on purpose. These are rules over the numbers already on the screen:
 * each line states a fact and what it implies, so it says the same thing twice
 * and can be argued with.
 */
function Review({ d, prescribed }: { d: Payload; prescribed: number | null }) {
  const lines: { text: string; tone: "good" | "warn" | "flat" }[] = [];
  const z = d.zones;
  const hard = (z[3]?.pct ?? 0) + (z[4]?.pct ?? 0);
  const easy = (z[0]?.pct ?? 0) + (z[1]?.pct ?? 0);
  const work = d.stats.work, rest = d.stats.rest;
  const reps = d.segments.filter((s) => s.role === "work" && s.avg_speed_ms);

  if (d.zoneTotal > 0) {
    if (hard >= 70) lines.push({ tone: "warn", text: `${hard}% of this session sat in Z4 or Z5. That is a race, not a training run.` });
    else if (easy >= 70) lines.push({ tone: "good", text: `${easy}% in Z1–Z2 — an easy run actually run easy, which is the instruction the plan repeats most.` });
    else lines.push({ tone: "flat", text: `${hard}% Z4–Z5 against ${easy}% Z1–Z2.` });
  }
  if (reps.length >= 3) {
    const first = 1000 / Number(reps[0].avg_speed_ms);
    if (reps.slice(1).every((r) => 1000 / Number(r.avg_speed_ms) >= first)) {
      lines.push({ tone: "warn", text: "Rep 1 was the fastest, so the session is logged as failed whatever the average says. That rule exists because willpower has failed four times on record." });
    } else {
      lines.push({ tone: "good", text: "Rep 1 was not the fastest. That is the session passing its own test." });
    }
  }
  if (prescribed && work.avg_speed_ms) {
    const delta = Math.round(1000 / work.avg_speed_ms - prescribed);
    lines.push({
      tone: Math.abs(delta) <= 5 ? "good" : "warn",
      text: `Work reps held ${pace(work.avg_speed_ms)} /km against ${pace(1000 / prescribed)} prescribed — ${delta === 0 ? "exactly on it" : `${Math.abs(delta)} s/km ${delta < 0 ? "quick" : "slow"}`}.`,
    });
  }
  if (work.count > 0 && rest.count > 0 && work.avg_hr && rest.avg_hr) {
    const drop = Math.round(work.avg_hr - rest.avg_hr);
    lines.push({
      tone: drop >= 10 ? "good" : "warn",
      text: `Heart rate came down ${drop} bpm on the recoveries. The plan wants 10–15; at Heerenveen the stations gave 3, which is why the whole race redlined.`,
    });
  }
  if (lines.length === 0) return null;
  const dot = (t: string) => (t === "good" ? TEAL : t === "warn" ? "#C07A3E" : INK40);

  return (
    <div style={band}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={caps}>Review</span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
          textTransform: "uppercase", color: INK40 }}>Computed</span>
      </div>
      {lines.map((l, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "8px 1fr", gap: 10,
          alignItems: "start" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", marginTop: 5,
            background: dot(l.tone) }} />
          <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-70)" }}>{l.text}</span>
        </div>
      ))}
      <span style={{ fontSize: 10, color: INK40, lineHeight: 1.5 }}>
        Rules over the numbers above, not written prose — so it says the same thing twice.
      </span>
    </div>
  );
}

function SessionFeedback({ sessionId, meId }: { sessionId: string; meId: string }) {
  const [d, setD] = useState<{
    feedback: { rpe: number | null; length_feel: string | null } | null;
    comments: { id: string; body: string; created_at: string; author_id: string; display_name: string }[];
  } | null>(null);

  const load = async () => {
    const r = await fetch(`/api/session/${sessionId}`);
    if (r.ok) setD(await r.json());
  };
  useEffect(() => { load(); }, [sessionId]);

  // Hands back the server's answer rather than a boolean, for the same reason the
  // session screen does: a length report can change the next session, and only the
  // server knows whether it did.
  const send = async (body: Record<string, unknown>) => {
    const r = await fetch(`/api/session/${sessionId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? (j as Record<string, unknown>) : null;
  };

  if (!d) return null;
  const rpe = d.feedback?.rpe ?? null;
  const feel = d.feedback?.length_feel ?? null;

  return (
    <>
      <div style={band}>
        <span style={caps}>How did it feel?</span>
        <div style={{ display: "flex", gap: 4 }}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button key={n} onClick={async () => { await send({ action: "feedback", rpe: n }); load(); }}
              style={{ flex: 1, height: 34, borderRadius: 8, fontSize: 12, fontWeight: 700,
                background: rpe === n ? "var(--navy)" : OFF,
                color: rpe === n ? "#fff" : INK55 }}>{n}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {["short", "right", "long"].map((f) => (
            <button key={f} onClick={async () => { await send({ action: "feedback", length_feel: f }); load(); }}
              style={{ flex: 1, padding: "9px 0", borderRadius: "var(--r-pill)", fontSize: 11,
                fontWeight: 700, border: "1px solid",
                background: feel === f ? "var(--teal-tint)" : "transparent",
                color: feel === f ? TEAL : INK55,
                borderColor: feel === f ? TEAL : LINE }}>
              {f === "short" ? "Too short" : f === "right" ? "About right" : "Too long"}
            </button>
          ))}
        </div>
      </div>
      <Thread comments={d.comments} meId={meId} send={send} reload={load} />
    </>
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
      d: points.map(([la, ln], i) =>
        `${i ? "L" : "M"}${(ln * kx - minX).toFixed(6)} ${(maxY - la).toFixed(6)}`).join(""),
      vb: `${-pad} ${-pad} ${spanX + pad * 2} ${spanY + pad * 2}`,
    };
  }, [points]);

  if (basemap && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/api/activity/${activityId}/map`} alt="Route recorded by GPS"
      onError={() => setFailed(true)}
      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />;
  }
  return (
    <svg viewBox={vb} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Route"
      style={{ width: "100%", height: "100%" }}>
      <path d={d} fill="none" stroke={TEAL} strokeWidth="2.5" vectorEffect="non-scaling-stroke"
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Pace per work segment, against the prescribed target.
 *
 * Bars rather than a line: pace is only meaningful per rep, and a continuous line
 * through the recoveries would spend most of its length describing walking. The
 * target is a line across the chart, so the answer to "did I run this as written"
 * is which side of it each bar sits on — not a number to compare in your head.
 *
 * Quicker than target is not automatically good, and the colour does not pretend
 * it is: it marks distance from the line in either direction, because a rep run
 * thirty seconds quick is a rep that cost the next one.
 */
function PaceChart({
  segments, prescribed,
}: {
  segments: Segment[];
  /** target pace in metres per second, or null when the run has no prescription */
  prescribed: number | null;
}) {
  const reps = useMemo(
    () => segments
      .filter((sg) => sg.role === "work" && sg.avg_speed_ms)
      .map((sg, i) => ({
        n: i + 1,
        secPerKm: 1000 / (sg.avg_speed_ms as number),
        hr: sg.avg_hr,
      })),
    [segments],
  );
  if (reps.length === 0) return null;

  /*
   * Without a target, the set's own average is the reference line.
   *
   * The chart's job is to show whether the reps were even and where they drifted, and
   * that question has an answer with no prescription at all — the line just means "your
   * own average" instead of "what you were asked for", which the caption says.
   */
  const target = prescribed
    ? 1000 / prescribed
    : reps.reduce((n, r) => n + r.secPerKm, 0) / reps.length;
  // The scale spans the target and every rep, with a little air, so the target
  // line is never at the very edge where it cannot be read against anything.
  const all = [target, ...reps.map((r) => r.secPerKm)];
  const lo = Math.min(...all) - 8, hi = Math.max(...all) + 8;
  const y = (v: number) => 100 - ((v - lo) / (hi - lo)) * 92 - 4;
  const targetY = y(target);
  const w = 330 / reps.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <svg viewBox="0 0 330 100" preserveAspectRatio="none"
        style={{ width: "100%", height: 108 }}>
        {reps.map((r, i) => {
          // Quicker is a lower number, so a bar below the line is a quick rep.
          const top = Math.min(y(r.secPerKm), targetY);
          const h = Math.abs(y(r.secPerKm) - targetY);
          const quick = r.secPerKm < target;
          const off = Math.abs(r.secPerKm - target);
          return (
            <rect key={r.n} x={i * w + w * 0.18} width={w * 0.64}
              y={top} height={Math.max(1.5, h)} rx="2"
              fill={off <= 3 ? "rgba(10,143,176,.30)" : quick ? TEAL : "#C07A3E"} />
          );
        })}
        <line x1="0" y1={targetY} x2="330" y2={targetY}
          stroke={NAVY_D} strokeWidth="1.2" strokeDasharray="4 3" />
      </svg>

      <div style={{ display: "flex" }}>
        {reps.map((r) => {
          const off = Math.round(r.secPerKm - target);
          return (
            <span key={r.n} style={{
              flex: 1, textAlign: "center", fontSize: 9, fontWeight: 700,
              color: Math.abs(off) <= 3 ? INK55 : off < 0 ? TEAL : "#8E3521",
            }}>
              {off === 0 ? "on" : `${off > 0 ? "+" : ""}${off}`}
            </span>
          );
        })}
      </div>
      <span style={{ fontSize: 9, color: INK40, textAlign: "center" }}>
        seconds per kilometre against {prescribed ? "target" : "your own average"}, per rep
      </span>
    </div>
  );
}
