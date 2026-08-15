"use client";
import { useCallback, useEffect, useState } from "react";
import { fmt } from "@/lib/dates";
import { kindColour } from "@/lib/coach";
import { humanDose, type StepGroup } from "@/lib/prescription";
import { prescribedPace } from "@/lib/signals";
import Thread from "./Thread";

export type SessionDetail = {
  session: {
    id: string; user_id: string; planned_date: string; title: string; kind: string;
    planned_minutes: number | null; target: string | null; coach_note: string | null;
    status: string; actual_minutes: number | null; significance: string | null;
    slot: string | null; activity_id: string | null; display_name: string;
    effort_points: number | null;
  };
  steps: StepGroup[];
  reps: number;
  lifts: { name: string; sets: number; reps: number; load: number | null }[];
  sets: SetRow[];
  feedback: { rpe: number | null; length_feel: string | null; note: string | null } | null;
  comments: { id: string; body: string; created_at: string; author_id: string; display_name: string }[];
  activity: { id: string; name: string; moving_seconds: number; distance_m: string; avg_hr: string } | null;
};
export type SetRow = {
  id: string; exercise: string; ord: number; set_no: number;
  prescribed_load: number | null; prescribed_reps: number | null;
  load_kg: number | null; reps: number | null; done: boolean; note: string | null;
};

/** Everything both session screens need to load and write. */
export function useSession(id: string) {
  const [d, setD] = useState<SessionDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/session/${id}`);
    if (r.status === 401) { location.href = "/login"; return; }
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Couldn't load it."); return; }
    setD(await r.json());
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const send = useCallback(async (body: Record<string, unknown>) => {
    const r = await fetch(`/api/session/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) setErr((await r.json().catch(() => ({}))).error ?? "That didn't save.");
    return r.ok;
  }, [id]);

  return { d, setD, err, load, send };
}

const TEAL = "#0A8FB0";
const INK55 = "var(--ink-55)";
const say = (sec: number, mode: string) =>
  mode === "Treadmill"
    ? `${(3600 / sec).toFixed(1)} kph`
    : `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, "0")} /km`;

type Item = { main: string; sub: string; work: boolean };
type Group = { label: string; color: string; items: Item[]; note: string };

/**
 * The prescription as the design renders it: every rep its own numbered row.
 *
 * The parser groups a session as `5 × (work, recovery)` because that is how
 * intervals.icu writes it and how it reaches the watch. The screen shows the
 * reps expanded — six rows, numbered 2 to 7 — because that is what you read
 * standing on a track, one line per thing you are about to do.
 */
function groupsFor(steps: StepGroup[], prescribed: number | null, mode: string): Group[] {
  const out: Group[] = [];
  const cap = prescribed
    ? mode === "Treadmill"
      ? `Set the belt to ${say(prescribed, mode)} and leave it. The alarm equivalent is ${say(prescribed - 3, mode)} — do not touch the speed up.`
      : `Watch alert at ${say(prescribed - 3, "Outdoor")} — prescribed minus 3 s. Not a target, an alarm.`
    : "";

  for (const g of steps) {
    const isWarm = g.label === "Warm-up";
    const isCool = g.label === "Cool-down";

    if (isWarm || isCool) {
      const it = g.items[0];
      out.push({
        label: isWarm ? "Warm-up" : "Cool down", color: INK55, note: "",
        items: [{
          main: `${humanDose(it?.dose ?? "")} ${isWarm ? "conversational" : "easy"}`.trim(),
          sub: isWarm && prescribed ? `No faster than ${say(prescribed + 45, mode)}` : "or slower",
          work: false,
        }],
      });
      continue;
    }

    // the repeat block, expanded
    const work = g.items.find((i) => !i.rest);
    const rest = g.items.find((i) => i.rest);
    const items: Item[] = [];
    for (let i = 0; i < g.repeat; i++) {
      items.push({
        main: `${humanDose(work?.dose ?? "")}${prescribed ? ` at ${say(prescribed, mode)}` : ""}`,
        sub: rest ? `${humanDose(rest.dose)} ${/walk/i.test(rest.label) ? "walking rest" : "recovery"}` : "",
        work: true,
      });
    }
    out.push({ label: `Session · ${items.length} reps`, color: TEAL, items, note: cap });
  }
  return out;
}

export default function Brief({
  id, meId, openActivity, onChanged,
}: { id: string; meId: string; openActivity: (a: string) => void; onChanged: () => void }) {
  const { d, err, load, send } = useSession(id);
  const [warmOpen, setWarmOpen] = useState(false);
  const [mode, setMode] = useState("Outdoor");
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (err) return <div className="pad"><div className="errbox" role="alert">{err}</div></div>;
  if (!d) return <div className="pad"><p className="empty">Loading…</p></div>;

  const s = d.session;
  const done = s.status === "done" || s.status === "adjusted";
  const noteLines = s.coach_note?.split("\n").filter(Boolean) ?? [];
  const why = noteLines[0];
  const pace = prescribedPace(s.title);
  const groups = groupsFor(d.steps, pace, mode);
  const accent = kindColour(s.kind);

  async function skip() {
    setBusy(true);
    await fetch(`/api/sessions/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "skip", reason: "no_time" }),
    });
    setBusy(false);
    await load(); onChanged();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{
        padding: "20px 18px 20px",
        background: `linear-gradient(165deg, color-mix(in srgb, ${accent} 14%, var(--off)) 0%, var(--off) 80%)`,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em",
          textTransform: "uppercase", color: "var(--teal)" }}>
          {fmt(s.planned_date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
          {s.slot ? ` · ${s.slot}` : ""}
          {s.user_id !== meId ? ` · ${s.display_name}` : ""}
        </div>
        <div style={{ fontFamily: "var(--display)", fontSize: 27, fontWeight: 700,
          lineHeight: 1.1, letterSpacing: "-.02em", marginTop: 8 }}>{s.title}</div>
        <div style={{ fontSize: 13, color: "var(--ink-55)", marginTop: 6 }}>
          {s.kind.startsWith("run") ? "Run" : s.kind === "strength" ? "Strength" : "Hyrox"}
          {d.reps > 0 ? ` · ${d.reps} reps` : ""}
        </div>

        {s.planned_minutes && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 18 }}>
            <span style={{ fontFamily: "var(--display)", fontSize: 25, fontWeight: 700 }}>
              {s.planned_minutes} min
            </span>
            <span style={{ fontSize: 11, color: "var(--ink-55)" }}>
              {pace ? `at ${say(pace, "Outdoor")} prescribed` : ""}
            </span>
          </div>
        )}
        <div style={{ fontSize: 11, color: "var(--ink-40)", marginTop: 8 }}>
          From your plan · Strava matches it automatically
        </div>
      </div>

      {why && (
        <div style={{ padding: "16px 18px 0" }}>
          <div style={{ background: "var(--paper)", border: "1px solid var(--line)",
            borderRadius: "var(--r-card)", padding: "15px 16px",
            display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 18, height: 18, borderRadius: 5, background: "var(--teal-tint2)",
                color: "var(--teal)", fontSize: 10, fontWeight: 800,
                display: "flex", alignItems: "center", justifyContent: "center" }}>i</span>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em",
                textTransform: "uppercase" }}>Why this session matters</span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--ink-70)" }}>{why}</div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", padding: "14px 10px", margin: "14px 18px 0",
        background: "var(--paper)", border: "1px solid var(--line)", borderRadius: "var(--r-card)" }}>
        <Action label="Warm-up" active={warmOpen} onClick={() => setWarmOpen(!warmOpen)}>
          <circle cx="12" cy="4.5" r="2" /><path d="M8 21l2.5-5 3.5-2-1-4" />
          <path d="M6 11l3-2h4l4 3" /><path d="M15 21l-1.5-4" />
        </Action>
        <Action label={s.activity_id ? "Open activity" : "Link Strava"} active={!!s.activity_id}
          onClick={() => s.activity_id && openActivity(s.activity_id)}>
          <path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1" />
          <path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />
        </Action>
        <Action label={s.status === "skipped" ? "Skipped" : "Skip"} danger onClick={skip}>
          <path d="M5 5l9 7-9 7z" /><path d="M19 5v14" />
        </Action>
      </div>

      {warmOpen && (
        <div style={{ margin: "14px 18px 0", background: "var(--paper)",
          border: "1px solid var(--teal)", borderRadius: "var(--r-card)",
          padding: "15px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em",
              textTransform: "uppercase", color: "var(--teal)" }}>Warm-up</span>
            <button onClick={() => setWarmOpen(false)} style={{ color: "var(--ink-40)", fontSize: 11,
              fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>Hide</button>
          </div>
          {WARMUP.map((w, i) => (
            <div key={w.name} style={{ display: "grid", gridTemplateColumns: "22px 1fr auto",
              gap: 12, alignItems: "center", padding: "10px 0",
              borderTop: i ? "1px solid var(--line-2)" : "none" }}>
              <span style={{ fontFamily: "var(--display)", fontSize: 15, fontWeight: 700,
                color: "var(--ink-40)" }}>{i + 1}</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{w.name}</span>
                <span style={{ fontSize: 11, color: "var(--ink-55)", lineHeight: 1.4 }}>{w.cue}</span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--teal)", whiteSpace: "nowrap" }}>{w.dose}</span>
            </div>
          ))}
        </div>
      )}

      {groups.length > 0 && (
        <div style={{ padding: "20px 18px 8px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em",
              textTransform: "uppercase", color: "var(--ink-55)" }}>What to do</span>
            <div style={{ display: "flex", gap: 3, background: "var(--paper)",
              border: "1px solid var(--line)", borderRadius: "var(--r-pill)", padding: 3 }}>
              {["Outdoor", "Treadmill"].map((m) => (
                <button key={m} onClick={() => setMode(m)} style={{
                  borderRadius: "var(--r-pill)", padding: "7px 13px", fontSize: 11, fontWeight: 700,
                  background: mode === m ? "var(--navy)" : "transparent",
                  color: mode === m ? "#fff" : "var(--ink-55)",
                }}>{m}</button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {groups.map((g, gi) => {
              let n = groups.slice(0, gi).reduce((a, x) => a + x.items.length, 0);
              return (
                <div key={gi} style={{ display: "flex", flexDirection: "column",
                  border: "1px solid var(--line)", borderRadius: "var(--r-card)", overflow: "hidden" }}>
                  <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".12em",
                    textTransform: "uppercase", color: "#fff", background: g.color, padding: "9px 14px" }}>
                    {g.label}
                  </div>
                  <div style={{ background: "var(--paper)" }}>
                    {g.items.map((it, ii) => {
                      n += 1;
                      return (
                        <div key={ii} style={{ display: "grid", gridTemplateColumns: "22px 1fr auto",
                          gap: 12, alignItems: "center", padding: "12px 14px",
                          borderTop: ii ? "1px solid var(--line-2)" : "none" }}>
                          <span style={{ fontFamily: "var(--display)", fontSize: 15, fontWeight: 700,
                            color: it.work ? "var(--ink-40)" : "var(--ink-40)" }}>{n}</span>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>{it.main}</span>
                            <span style={{ fontSize: 11, color: "var(--ink-55)" }}>{it.sub}</span>
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em",
                            textTransform: "uppercase", color: "var(--ink-40)" }}>
                            {mode === "Treadmill" ? "TM" : "Run"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {g.note && (
                    <div style={{ fontSize: 11, lineHeight: 1.5, color: "var(--ink-55)",
                      background: "var(--paper)", padding: "12px 14px 13px",
                      borderTop: "1px solid var(--line-2)" }}>{g.note}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ padding: "16px 18px 8px", display: "flex", flexDirection: "column", gap: 10 }}>
        <button onClick={async () => { await send({ action: "complete", done: !done }); await load(); onChanged(); }}
          style={{ width: "100%", background: "var(--lime)", borderRadius: "var(--r-pill)",
            color: "var(--on-lime)", padding: 17, fontSize: 13, fontWeight: 800,
            letterSpacing: ".06em", textTransform: "uppercase" }}>
          {done ? "Mark not done" : "Start session"}
        </button>
        {groups.length > 0 && (
          <button disabled={busy} onClick={async () => {
            setSent("Sending…");
            const r = await fetch(`/api/intervals/push/${id}`, { method: "POST" });
            const j = await r.json().catch(() => ({}));
            setSent(r.ok ? "Sent — it will appear on your watch." : (j.error ?? "Couldn't send it."));
          }} style={{ width: "100%", borderRadius: "var(--r-pill)", padding: 14, fontSize: 11,
            fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
            border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)" }}>
            {sent ?? "Send to Garmin watch"}
          </button>
        )}
        <div style={{ fontSize: 11, textAlign: "center", color: "var(--ink-40)", lineHeight: 1.5 }}>
          {pace
            ? `Watch alert set at ${say(pace - 3, "Outdoor")}. If rep 1 is the fastest, the session logs as failed.`
            : "Logged against the plan, not against feel."}
        </div>
      </div>

      <Rpe d={d} send={send} reload={load} />
      <Thread comments={d.comments} meId={meId} send={send} reload={load} />
    </div>
  );
}

function Action({ label, onClick, active, danger, children }: {
  label: string; onClick: () => void; active?: boolean; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} style={{ flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", gap: 7, padding: "4px 0", color: "var(--ink)" }}>
      <span style={{ width: 40, height: 40, borderRadius: "50%",
        background: active ? "var(--teal-tint2)" : "var(--off)",
        display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none"
          stroke={danger ? "#C07A3E" : active ? "#0A8FB0" : "#12314D"}
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
      </span>
      <span style={{ fontSize: 11, fontWeight: 600 }}>{label}</span>
    </button>
  );
}

/** A fixed warm-up. The plan prescribes sessions, not mobility, so this is ours. */
const WARMUP = [
  { name: "Easy jog", cue: "Conversational. Nothing to prove yet.", dose: "8 min" },
  { name: "Leg swings", cue: "Front-to-back then side-to-side, holding something.", dose: "10 each" },
  { name: "Walking lunge", cue: "Long step, back knee low, chest tall.", dose: "10 each" },
  { name: "A-skips", cue: "Quick ground contact, tall posture.", dose: "2 × 20 m" },
  { name: "Strides", cue: "Build to target pace, not past it.", dose: "4 × 20 s" },
];

/** RPE and how long it felt. Both are the athlete's report, not the watch's. */
export function Rpe({
  d, send, reload,
}: { d: SessionDetail; send: (b: Record<string, unknown>) => Promise<boolean>; reload: () => void }) {
  const rpe = d.feedback?.rpe ?? null;
  const feel = d.feedback?.length_feel ?? null;
  return (
    <div className="band">
      <span className="caps" style={{ color: "var(--ink)" }}>How did it feel?</span>
      <div style={{ display: "flex", gap: 4 }}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button key={n} onClick={async () => { await send({ action: "feedback", rpe: n }); reload(); }}
            style={{ flex: 1, height: 34, borderRadius: 8, fontSize: 12, fontWeight: 700,
              background: rpe === n ? "var(--navy)" : "var(--off)",
              color: rpe === n ? "#fff" : "var(--ink-55)" }}>{n}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {["short", "right", "long"].map((f) => (
          <button key={f} onClick={async () => { await send({ action: "feedback", length_feel: f }); reload(); }}
            style={{ flex: 1, padding: "9px 0", borderRadius: "var(--r-pill)", fontSize: 11,
              fontWeight: 700, border: "1px solid",
              background: feel === f ? "var(--teal-tint)" : "transparent",
              color: feel === f ? "var(--teal)" : "var(--ink-55)",
              borderColor: feel === f ? "var(--teal)" : "var(--line)" }}>
            {f === "short" ? "Too short" : f === "right" ? "About right" : "Too long"}
          </button>
        ))}
      </div>
    </div>
  );
}
