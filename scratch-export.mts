import { sql } from "./lib/db";
import { parseSteps } from "./lib/prescription";
import { loadIntakeRow, toIntake } from "./lib/intake-store";
import { paramsFrom } from "./lib/plan/from-intake";
import { generate } from "./lib/plan/generate";
import { recentFor } from "./lib/recent";
import { measuredFor } from "./lib/race/measured";
import { prefsFor } from "./lib/day-prefs";
import { writeFileSync } from "node:fs";

const ID = process.argv[2];
const OUT = process.argv[3];

const x = toIntake((await loadIntakeRow(ID))!);
const [u] = await sql<{ hr_max: number | null; display_name: string }[]>`
  select hr_max, display_name from users where id = ${ID}`;
const [conn] = await sql<{ ok: boolean }[]>`
  select exists (select 1 from oauth_accounts where user_id = ${ID} and provider='strava') as ok`;
const [{ races }] = await sql<{ races: number }[]>`select count(*)::int as races from races where user_id = ${ID}`;
const [tpl] = await sql<{ volume_feel_delta: number }[]>`
  select volume_feel_delta from plan_templates where athlete_id = ${ID} and active order by start_date desc limit 1`;
const { recent } = await recentFor(ID, conn?.ok ?? false);
const measured = await measuredFor(ID);
const [around] = await sql<{ confirmed: unknown }[]>`
  select confirmed from training_constraints where user_id = ${ID}`;

const p = paramsFrom(x, {
  recent, absences: [], max_hr: u?.hr_max ?? null, measured: x.benchmark === "logged",
  hyrox_races: races + (x.pastRaces?.length ?? 0),
  measured_race_run_split_s: measured.run_split_s,
  volume_feel_delta: tpl?.volume_feel_delta ?? 0,
  constraints: (around?.confirmed as never) ?? [],
});
const g = generate({ ...p, day_prefs: await prefsFor(ID) });

function paceS(pace: string | null): number | null {
  if (!pace) return null;
  const all = [...pace.matchAll(/(\d{1,2}):([0-5]\d)/g)].map((m) => Number(m[1]) * 60 + Number(m[2]));
  return all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;
}
function doseOf(dose: string, pace: number | null): { km: number; s: number } {
  const m = /^(\d+(?:\.\d+)?)\s*(km|k|m|min|s|sec|mi)\b/i.exec(dose.trim());
  if (!m) return { km: 0, s: 0 };
  const n = Number(m[1]), unit = m[2].toLowerCase();
  if (unit === "km" || unit === "k") return { km: n, s: pace ? n * pace : 0 };
  if (unit === "mi") return { km: n * 1.609, s: pace ? n * 1.609 * pace : 0 };
  if (unit === "m") return n < 60 ? { km: pace ? (n*60)/pace : 0, s: n*60 } : { km: n/1000, s: pace ? (n/1000)*pace : 0 };
  if (unit === "min") return { km: pace ? (n*60)/pace : 0, s: n*60 };
  return { km: pace ? n/pace : 0, s: n };
}
const DAY = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

const weeks = g.weeks.map((w) => {
  const zones: Record<string, { km: number; s: number }> = {};
  const sessions = (w.sessions as never as {
    day: number; kind: string; label: string; purpose?: string; target_text?: string;
    note_text?: string; why_text?: string; minutes?: number; km?: number; hard: boolean;
    commitment?: boolean; ladder?: string;
  }[]).map((s) => {
    const groups = parseSteps(s.target_text ?? null);
    const zs: Record<string, { km: number; s: number }> = {};
    for (const gr of groups) for (const st of gr.items) {
      if (!st.zone) continue;
      const { km, s: sec } = doseOf(st.dose, paceS(st.pace));
      const z = st.zone.toUpperCase();
      zs[z] ??= { km: 0, s: 0 }; zs[z].km += km * gr.repeat; zs[z].s += sec * gr.repeat;
      zones[z] ??= { km: 0, s: 0 }; zones[z].km += km * gr.repeat; zones[z].s += sec * gr.repeat;
    }
    return {
      day: DAY[s.day], kind: s.kind, title: s.purpose || s.label,
      subtitle: s.purpose && s.purpose !== s.label ? s.label : null,
      km: s.km ?? null, minutes: s.minutes ?? null, hard: s.hard,
      commitment: Boolean(s.commitment), ladder: s.ladder ?? null,
      why: s.why_text ?? null, note: s.note_text ?? null, target: s.target_text ?? null,
      steps: groups.map((gr) => ({ label: gr.label, repeat: gr.repeat,
        items: gr.items.map((st) => ({ dose: st.dose, pace: st.pace, zone: st.zone, label: st.label, rest: st.rest })) })),
      zones: zs,
    };
  });
  return {
    n: w.n, phase: w.phase, monday: p.week_start(w.n), note: w.note ?? "",
    deload: Boolean(w.deload), taper: Boolean(w.taper),
    target_km: Math.round((w.target_km ?? w.km) * 10) / 10,
    km: Math.round(w.km * 10) / 10,
    hard: sessions.filter((s) => s.hard).length,
    minutes: sessions.reduce((n, s) => n + (s.minutes ?? 0), 0),
    benchmark: Boolean(w.benchmark), suggestion: w.suggestion ?? null,
    zones, sessions,
  };
});

writeFileSync(OUT, JSON.stringify({
  athlete: u?.display_name ?? "Athlete", start: p.week_start(1), race: x.raceDate,
  discipline: x.discipline, division: x.division, goal: x.goal,
  anchor: p.anchor ? { cv: p.anchor.cv_pace_s_per_km, race: p.anchor.race_pace_s_per_km } : null,
  flags: g.flags, weeks,
}, null, 1));

console.log(`${u?.display_name}: ${weeks.length} weeks, ${weeks.reduce((n,w)=>n+w.sessions.length,0)} sessions`);
for (const w of weeks) {
  const tot = Object.values(w.zones).reduce((n,v)=>n+v.s,0) || 1;
  const zs = ["Z1","Z2","Z3","Z4","Z5"].map((z) => `${z} ${String(Math.round(100*(w.zones[z]?.s ?? 0)/tot)).padStart(2)}%`).join(" ");
  console.log(`w${String(w.n).padStart(2)} ${w.phase.padEnd(8)} ${String(w.km).padStart(5)}km ${String(w.sessions.length).padStart(2)}s ${w.hard}hard | ${zs}`);
}
const lad: Record<string, number> = {};
for (const w of weeks) for (const s of w.sessions) if (s.ladder) lad[s.ladder] = (lad[s.ladder] ?? 0) + 1;
console.log("ladders:", JSON.stringify(lad));
await sql.end();
