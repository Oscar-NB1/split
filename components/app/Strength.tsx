"use client";
import { fmt } from "@/lib/dates";
import { tonnage } from "@/lib/prescription";
import Thread from "./Thread";
import { Rpe, useSession, type SetRow } from "./Brief";

/**
 * Strength logging.
 *
 * The prescription and the log are shown together on every row, because the
 * question the plan actually asks is not "what did you lift" but "did you lift
 * what was written". A set that came in 10 kg under is the signal; a set with no
 * prescription to compare against is just a number.
 */
export default function Strength({
  id, meId, onChanged,
}: { id: string; meId: string; onChanged: () => void }) {
  const { d, setD, err, load, send } = useSession(id);

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
        return (
          <div className="band" key={ex.ord}>
            <div className="rowsplit">
              <span className="disp" style={{ fontSize: 17 }}>{ex.name}</span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--teal)" }}>
                  {ex.sets.length} × {p.prescribed_reps ?? "—"}
                  {p.prescribed_load != null ? ` @ ${p.prescribed_load} kg` : ""}
                </span>
                <span style={{ fontSize: 10, color: "var(--ink-40)" }}>prescribed</span>
              </span>
            </div>

            <div style={{
              display: "grid", gridTemplateColumns: "18px 1fr 52px 40px", gap: 8,
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
                  display: "grid", gridTemplateColumns: "18px 1fr 52px 40px",
                  gap: 8, alignItems: "center",
                }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: st.done ? "var(--teal)" : "var(--ink-40)" }}>
                    {st.set_no}
                  </span>

                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Step onClick={() => patch(st.id, { load_kg: Math.max(0, (st.load_kg ?? 0) - 2.5) })}>−</Step>
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
                    <Step onClick={() => patch(st.id, { load_kg: (st.load_kg ?? 0) + 2.5 })}>+</Step>
                  </div>

                  <input className="mono" inputMode="numeric" value={st.reps ?? ""}
                    onChange={(e) => patch(st.id, { reps: e.target.value === "" ? null : Number(e.target.value) })}
                    aria-label={`Reps, set ${st.set_no}`}
                    style={{ textAlign: "center", padding: "8px 0", borderRadius: 9, fontSize: 14, fontWeight: 700 }} />

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

const Step = ({ onClick, children }: { onClick: () => void; children: string }) => (
  <button onClick={onClick} style={{
    width: 30, height: 30, borderRadius: "50%", border: "1px solid var(--line)",
    fontSize: 15, color: "var(--ink-55)", flex: "none",
  }}>{children}</button>
);
