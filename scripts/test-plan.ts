/**
 * Rebuild Oscar's block through the new generator, as a test.
 *
 *   npx tsx scripts/test-plan.ts
 *
 * Reads nothing and writes nothing: it prints what the new pipeline would
 * produce so it can be compared with the hand-written block before anything
 * replaces it.
 *
 * Most inputs are taken from his actual training data or stated in the plan
 * document. Three were never answered — partner deltas, commitments, division —
 * and are filled in here with stated assumptions, at his direction, so the
 * pipeline can be exercised end to end. They are printed as assumptions rather
 * than presented as his answers.
 */
import { sql } from "../lib/db";
import { addDays, mondayOf } from "../lib/dates";
import { generate, type Params } from "../lib/plan/generate";
import { measuredRecent } from "../lib/recent";
import { anchorFrom } from "../lib/plan/paces";

const START = "2026-08-17";
const RACE = "2026-11-28";

async function main() {
  const [me] = await sql<{ id: string; hr_max: number | null }[]>`
    select id, hr_max from users where email = 'opouw33@gmail.com'
  `;

  // --- what the data says -------------------------------------------------
  const [stats] = await sql<{ activities: number; longest_km: string; years: string }[]>`
    select count(*)::int as activities,
           round(max(distance_m)/1000.0, 1) as longest_km,
           round(extract(epoch from (max(start_time) - min(start_time))) / 31557600.0, 1) as years
      from activities where user_id = ${me.id}
  `;
  const [best] = await sql<{ half_s: number }[]>`
    select total as half_s from (
      select sum(s.moving_seconds) over (
               partition by s.activity_id order by s.split rows between 20 preceding and current row) as total,
             count(*) over (
               partition by s.activity_id order by s.split rows between 20 preceding and current row) as have
        from activity_splits s join activities a on a.id = s.activity_id
       where a.user_id = ${me.id} and a.sport_type ilike '%run%'
         and s.moving_seconds > 0 and s.distance_m >= 995
    ) x where have = 21 order by total asc limit 1
  `;
  const [races] = await sql<{ n: number }[]>`
    select count(*)::int as n from activities
     where user_id = ${me.id} and name ilike '%hyrox%'
  `;

  console.log("From his data:");
  console.log(`  ${stats.activities} activities over ${stats.years} years`);
  console.log(`  longest run ${stats.longest_km} km · best half ${Math.floor(best.half_s / 60)}:${String(best.half_s % 60).padStart(2, "0")}`);
  // Not asked for and not guessed: read from his own activities.
  const recent = await measuredRecent(me.id);
  console.log(`  ${races.n} Hyrox session(s) on file · max HR ${me.hr_max}`);
  console.log(recent
    ? `  recent: biggest week ${recent.peak_week_km} km (last 4), longest run ${recent.long_run_km} km (last 8), measured\n`
    : "  recent: nothing recent on file, so the bracket decides week 1\n");

  const params: Params = {
    // derived from the data above
    general_training_age: "advanced",          // 499 activities across six years
    running_base: "half_marathon_fit",         // 24 km longest, half in 1:42
    hyrox_experience: { months: 12, sessions_per_week: 2, races_done: races.n },
    // stated in the plan document
    length: Math.ceil((Date.parse(RACE) - Date.parse(START) + 86400000) / 604800000),
    discipline: "doubles",
    goal: "compete",                           // "target 55:00–56:30"
    target_sessions: 6,
    available_days: 6,
    days: [0, 1, 2, 3, 4, 5],
    allow_doubles: true,
    want_rest_day: true,
    variant: "full",
    max_hr: me.hr_max,
    // no benchmark has been run, so there is no anchor and no measurement
    confidence: "estimated",
    anchor: anchorFrom([]),
    // ASSUMED for the test — see the note at the end
    partner: { run_delta: 1, station_delta: -1 },   // Olivier quicker on foot; sled pull is Oscar's
    commitments: [{
      activity: "kickboxing", per_week: 2, fixed_days: [0, 3],
      intensity: "high", mode: "add", locked: true,
    }],
    absences: [],
    exclusions: [],
    recent,
    week_start: (n) => addDays(mondayOf(START), (n - 1) * 7),
  };

  const plan = generate(params);
  const r = plan.resolved;

  console.log(`Generator ${plan.version} · role ${plan.role} · ${plan.weeks.length} weeks`);
  console.log(`  training age ${r.training_age} · start ${r.start_volume} km · ramp ${(r.ramp_rate * 100).toFixed(0)}% · peak ceiling ${r.peak_ceiling} km`);
  console.log(`  matrix said ${r.matrix_volume} km, running ceiling ${r.ceiling ?? "none"}\n`);

  console.log("wk  phase     km    sessions");
  for (const w of plan.weeks) {
    const mark = w.benchmark ? " ⌾" : w.deload ? " ↓" : w.taper ? " T" : "  ";
    console.log(
      `${String(w.n).padStart(2)}${mark} ${w.phase.padEnd(9)} ${String(w.km).padStart(5)}  ` +
      w.sessions.map((s) => s.kind).join(", ").slice(0, 60),
    );
  }

  const alloc = plan.weeks[plan.weeks.length - 3].allocation;
  console.log(`\nSpecific-phase split: ${alloc.running}% run · ${alloc.station}% station · ${alloc.strength}% strength`);

  console.log(`\nFlags (${plan.flags.length}):`);
  for (const f of [...new Map(plan.flags.map((f) => [f.message, f])).values()]) {
    console.log(`  · ${f.message}`);
  }
  console.log(`\nAssertion failures: ${plan.violations.length === 0 ? "none" : JSON.stringify(plan.violations)}`);

  console.log(`
Assumed, not answered — change these and the block changes:
  · partner: Olivier quicker on foot, Oscar stronger at the stations
    → role '${plan.role}'. A different pair of signs is a different block.
  · commitments: kickboxing twice a week, Monday and Thursday, locked.
    Credited at 0x — it costs the legs and builds none of this.
  · division: not set, so station loads are still a share of race weight
    rather than kilos.`);
  process.exit(0);
}

main();
