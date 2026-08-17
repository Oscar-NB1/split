"use client";
import { useState } from "react";
import { fmt } from "@/lib/dates";
import { restFor, tonnage } from "@/lib/prescription";
import Thread from "./Thread";
import { Rpe, WarmupCard, useSession, type SetRow } from "./Brief";
import type { Rest } from "./RestTimer";

/**
 * Strength logging.
 *
 * The prescription and the log are shown together on every row, because the
 * question the plan actually asks is not "what did you lift" but "did you lift
 * what was written". A set that came in 10 kg under is the signal; a set with no
 * prescription to compare against is just a number.
 */
/**
 * How much one tap moves a load.
 *
 * 2.5 kg was the smallest plate pair, which is the right step for a barbell and far too
 * coarse for a dumbbell or a kettlebell progression — and it made the stepper unusable
 * for nudging a number the plan had estimated. Half a kilo, rounded so floating-point
 * addition cannot leave 47.50000000000001 in the box.
 */
const STEP = 0.5;
const round = (n: number) => Math.round(n * 2) / 2;

/**
 * And how much one tap moves a rep count.
 *
 * Typed before, which is the wrong control for a number between five and fifteen: it opens
 * a keyboard over the session, it accepts 55 as readily as 5, and it asks for two-handed
 * precision from somebody who has just put a barbell down. A rep is a tap.
 */
const REP_MAX = 60;

export default function Strength({
  id, meId, onChanged, startRest,
}: {
  id: string; meId: string; onChanged: () => void;
  startRest: (r: Rest | null) => void;
}) {
  const { d, setD, err, load, send } = useSession(id);
  /** Which lift has its description open. One at a time, or the session disappears. */
  const [open, setOpen] = useState<number | null>(null);
  /*
   * Closed, like every other session screen.
   *
   * It opened by default on the reasoning that a cold heavy first set is the most
   * avoidable injury in the plan — but six expanded rows push the actual session
   * below the fold, so the screen opens on somebody else's mobility list rather than
   * on the lifts. An athlete who wants the warm-up taps once; an athlete who knows it
   * gets their sets.
   */
  const [warmOpen, setWarmOpen] = useState(false);

  if (err) return <div className="pad"><div className="errbox" role="alert">{err}</div></div>;
  if (!d) return <div className="pad"><p className="empty">Loading…</p></div>;

  const s = d.session;
  const byExercise: { name: string; ord: number; sets: SetRow[] }[] = [];
  for (const st of d.sets) {
    let g = byExercise.find((x) => x.ord === st.ord);
    if (!g) { g = { name: st.exercise, ord: st.ord, sets: [] }; byExercise.push(g); }
    g.sets.push(st);
  }
  const doneCount = d.sets.filter((x) => x.done).length;
  const total = tonnage(d.sets);

  /** Optimistic: the stepper has to feel instant under a thumb mid-set. */
  function patch(setId: string, changes: Partial<SetRow>) {
    setD({ ...d!, sets: d!.sets.map((x) => (x.id === setId ? { ...x, ...changes } : x)) });
    const row = d!.sets.find((x) => x.id === setId)!;
    const next = { ...row, ...changes };
    send({ action: "set", set_id: setId, load_kg: next.load_kg, reps: next.reps, done: next.done });

    // Ticking a set starts the rest. Un-ticking does not — that is a correction,
    // not the end of a set.
    if (changes.done === true) startRest(restAfter(row));
  }

  /**
   * What follows this set: the next set of the same lift, the first set of the
   * next lift, or the end of the session.
   */
  function restAfter(row: SetRow): Rest {
    // The rest the plan prescribed for this lift, where it prescribed one.
    const rest = restFor(row.prescribed_reps, d!.lifts[row.ord]?.rest ?? null);
    const sameLift = d!.sets.filter((x) => x.ord === row.ord).sort((a, b) => a.set_no - b.set_no);
    const nextInLift = sameLift.find((x) => x.set_no === row.set_no + 1);
    const load = (x: SetRow) => (x.load_kg != null ? `${x.load_kg} kg` : "BW");

    if (nextInLift) {
      return { rest, left: rest, next: {
        name: row.exercise,
        line: `Set ${nextInLift.set_no} · ${load(nextInLift)} × ${nextInLift.reps ?? "—"}`,
      } };
    }
    const nextLift = d!.sets
      .filter((x) => x.ord === row.ord + 1)
      .sort((a, b) => a.set_no - b.set_no)[0];
    if (nextLift) {
      return { rest, left: rest, next: {
        name: nextLift.exercise,
        line: `Set 1 · ${load(nextLift)} × ${nextLift.reps ?? "—"}`,
      } };
    }
    return { rest, left: rest, next: { name: "Session complete", line: "All sets logged" } };
  }

  return (
    <div>
      <div className="hero">
        <div className="eyebrow">
          {fmt(s.planned_date, { weekday: "long", day: "numeric", month: "long" })}
          {s.slot ? ` · ${s.slot}` : ""}
          {s.user_id !== meId ? ` · ${s.display_name}` : ""}
        </div>
        <h1 className="h1" style={{ marginTop: 7 }}>{s.title}</h1>
        {s.coach_note && (
          <p className="muted" style={{ marginTop: 9 }}>{s.coach_note.split("\n")[0]}</p>
        )}
        <div style={{ display: "flex", gap: 14, marginTop: 14, fontSize: 12, fontWeight: 600 }}>
          <span>{doneCount}/{d.sets.length} sets</span>
          <span style={{ color: "var(--ink-55)", fontWeight: 500 }}>
            {total > 0 ? `${total.toLocaleString()} kg lifted` : "nothing logged yet"}
          </span>
        </div>
      </div>

      {/* Spacing below either state: the warm-up card sat flush against the first
          exercise, so the two read as one block. */}
      <div style={{ paddingBottom: 14 }}>
        {warmOpen
          ? <WarmupCard kind="strength" title={d.session.title}
            onHide={() => setWarmOpen(false)} />
          : (
            <div style={{ padding: "14px 18px 0" }}>
              <button onClick={() => setWarmOpen(true)} style={{ fontSize: 11, fontWeight: 700,
                letterSpacing: ".06em", textTransform: "uppercase", color: "var(--teal)" }}>
                Show warm-up
              </button>
            </div>
          )}
      </div>

      {/*
        * The one question that makes the pre-filled weights possible.
        *
        * Every starting estimate is a multiple of bodyweight, so without it the loads are
        * blank and the screen looks broken rather than uninformed. Asked here, once, where
        * the consequence is visible — not added to the intake, which is long enough.
        */}
      {d.needs_bodyweight && <AskWeight onSaved={load} />}

      {byExercise.length === 0 && (
        <div className="band">
          <p className="empty" style={{ padding: 0 }}>
            No lifts prescribed for this one. Add them to the session&apos;s target as
            <span className="mono"> Back squat 3x5 @ 105</span> and they appear here.
          </p>
        </div>
      )}

      {byExercise.map((ex) => {
        const p = ex.sets[0];
        const g = d.guidance?.find((x) => x.name === ex.name);
        const isOpen = open === ex.ord;
        return (
          <div className="band" key={ex.ord}>
            <div className="rowsplit">
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="disp" style={{ fontSize: 17 }}>{ex.name}</span>
                {/*
                  * The description, behind a tap.
                  *
                  * "Rear-foot elevated split squat" is a sentence in a language somebody has
                  * to already speak. The text has been travelling with the session since the
                  * loads were pre-filled and there was no way to read it.
                  */}
                {(g?.what || g?.how) && (
                  <button onClick={() => setOpen(isOpen ? null : ex.ord)}
                    aria-label={`What is a ${ex.name}?`} aria-expanded={isOpen}
                    style={{
                      width: 19, height: 19, borderRadius: "50%", flex: "none",
                      border: `1px solid ${isOpen ? "var(--teal)" : "var(--line)"}`,
                      color: isOpen ? "var(--teal)" : "var(--ink-40)",
                      fontSize: 11, fontWeight: 700, fontStyle: "italic",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>i</button>
                )}
              </span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--teal)" }}>
                  {ex.sets.length} × {p.prescribed_reps ?? "—"}
                  {p.prescribed_load != null ? ` @ ${p.prescribed_load} kg` : ""}
                </span>
                <span style={{ fontSize: 10, color: "var(--ink-40)" }}>prescribed</span>
              </span>
            </div>

            {isOpen && (g?.what || g?.how) && (
              <div style={{ background: "var(--off)", borderRadius: 11, padding: "11px 13px",
                display: "flex", flexDirection: "column", gap: 6 }}>
                {g?.what && (
                  <span style={{ fontSize: 12.5, lineHeight: 1.55 }}>{g.what}</span>
                )}
                {g?.how && (
                  <span style={{ fontSize: 12, lineHeight: 1.55, color: "var(--ink-55)" }}>
                    <b style={{ color: "var(--ink)" }}>How: </b>{g.how}
                  </span>
                )}
              </div>
            )}

            {/*
              * The effort, and where the number came from.
              *
              * A prescribed weight without an RPE is a guess about a stranger. With one it is
              * a complete instruction that works on a good day and a bad one — and it is what
              * lets next week's load come from what happened this week rather than from a
              * percentage table. Said in reps left, because that is the only form of it that
              * means anything mid-set.
              */}
            {g && (g.rpe || g.source) && (
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {g.rpe && (
                  <span style={{ fontSize: 11.5, color: "var(--ink-55)" }}>
                    Take each set to <b style={{ color: "var(--ink)" }}>RPE {g.rpe}</b>
                    {g.rpe_means ? ` — ${g.rpe_means}` : ""}
                  </span>
                )}
                {g.progression && (
                  /* How last week moved it, so the change is explained rather than mysterious. */
                  <span style={{ fontSize: 11.5, color: "var(--teal)" }}>
                    {g.progression.why}
                  </span>
                )}
                {g.source && !g.progression && (
                  <span style={{ fontSize: 11.5, color: "var(--ink-40)" }}>
                    {g.source === "your last session"
                      ? "The weight is what you lifted last time."
                      : "The weight is a starting estimate from your bodyweight — a place to begin, not a target."}
                    {g.note ? ` ${g.note}` : ""}
                  </span>
                )}
              </div>
            )}

            <div style={{
              display: "grid", gridTemplateColumns: "18px 1fr 92px 40px", gap: 8,
              fontSize: 9, fontWeight: 700, letterSpacing: ".1em",
              textTransform: "uppercase", color: "var(--ink-40)",
            }}>
              <span>Set</span><span>Load</span><span style={{ textAlign: "center" }}>Reps</span><span />
            </div>

            {ex.sets.map((st) => {
              const under = st.prescribed_load != null && st.load_kg != null
                && st.load_kg < st.prescribed_load;
              return (
                <div key={st.id} style={{
                  display: "grid", gridTemplateColumns: "18px 1fr 92px 40px",
                  gap: 8, alignItems: "center",
                }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: st.done ? "var(--teal)" : "var(--ink-40)" }}>
                    {st.set_no}
                  </span>

                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Step onClick={() => patch(st.id, { load_kg: Math.max(0, round((st.load_kg ?? 0) - STEP)) })}>−</Step>
                    <div style={{
                      flex: 1, textAlign: "center", padding: "7px 0", borderRadius: 9,
                      background: "var(--off)", display: "flex", flexDirection: "column", gap: 1,
                    }}>
                      <span className="mono" style={{ fontSize: 14, fontWeight: 700 }}>
                        {st.load_kg == null ? "—" : st.load_kg}
                      </span>
                      {under && (
                        <span style={{ fontSize: 9, color: "#C07A3E", fontWeight: 600 }}>
                          {(st.load_kg! - st.prescribed_load!).toFixed(1)} kg
                        </span>
                      )}
                    </div>
                    <Step onClick={() => patch(st.id, { load_kg: round((st.load_kg ?? 0) + STEP) })}>+</Step>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Step small onClick={() => patch(st.id, {
                      reps: Math.max(0, (st.reps ?? st.prescribed_reps ?? 0) - 1),
                    })}>−</Step>
                    <span className="mono" aria-label={`Reps, set ${st.set_no}`}
                      style={{ flex: 1, textAlign: "center", fontSize: 14, fontWeight: 700 }}>
                      {st.reps ?? "—"}
                    </span>
                    <Step small onClick={() => patch(st.id, {
                      reps: Math.min(REP_MAX, (st.reps ?? st.prescribed_reps ?? 0) + 1),
                    })}>+</Step>
                  </div>

                  <button onClick={() => patch(st.id, { done: !st.done })}
                    aria-label={st.done ? "Mark not done" : "Mark done"}
                    style={{
                      width: 34, height: 34, borderRadius: "50%", fontSize: 14, fontWeight: 800,
                      background: st.done ? "var(--lime)" : "var(--off)",
                      color: st.done ? "var(--on-lime)" : "var(--ink-40)",
                    }}>✓</button>
                </div>
              );
            })}
          </div>
        );
      })}

      <Rpe d={d} send={send} reload={load} />
      <Thread comments={d.comments} meId={meId} send={send} reload={load} />

      <div className="pad">
        <button className="btn-primary" onClick={async () => {
          await send({ action: "complete", done: s.status !== "done" });
          await load(); onChanged();
        }}>
          {s.status === "done" ? "Mark not done" : "Finish session"}
        </button>
      </div>
    </div>
  );
}

/** Bodyweight, asked where it is needed and nowhere else. */
function AskWeight({ onSaved }: { onSaved: () => void }) {
  const [kg, setKg] = useState("");
  const [busy, setBusy] = useState(false);
  const n = Number(kg);
  const ok = Number.isFinite(n) && n >= 30 && n <= 250;

  return (
    <div className="band" style={{ gap: 9 }}>
      <span style={{ fontSize: 13.5, fontWeight: 700 }}>What do you weigh?</span>
      <span style={{ fontSize: 12, color: "var(--ink-55)", lineHeight: 1.5 }}>
        Every starting weight below is worked out from it. One number, once — after your
        first session the loads come from what you actually lifted instead.
      </span>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input className="mono" inputMode="decimal" value={kg}
          onChange={(e) => setKg(e.target.value)} placeholder="kg" aria-label="Bodyweight in kg"
          style={{ width: 92, textAlign: "center", padding: "10px 0", borderRadius: 9,
            fontSize: 15, fontWeight: 700 }} />
        <button disabled={!ok || busy} onClick={async () => {
          setBusy(true);
          const r = await fetch("/api/profile", {
            method: "PATCH", headers: { "content-type": "application/json" },
            body: JSON.stringify({ weight_kg: n }),
          });
          setBusy(false);
          if (r.ok) onSaved();
        }} style={{ padding: "10px 16px", borderRadius: "var(--r-pill)",
          background: "var(--navy, #12314D)", color: "#fff", fontSize: 13, fontWeight: 700,
          opacity: !ok || busy ? .5 : 1 }}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

const Step = (
  { onClick, children, small }: { onClick: () => void; children: string; small?: boolean },
) => (
  <button onClick={onClick} style={{
    /* The rep steppers sit in a narrower column than the load ones and still have to be
       hittable with a thumb, so they lose width rather than height. */
    width: small ? 26 : 30, height: small ? 28 : 30,
    borderRadius: "50%", border: "1px solid var(--line)",
    fontSize: small ? 14 : 15, color: "var(--ink-55)", flex: "none",
  }}>{children}</button>
);
