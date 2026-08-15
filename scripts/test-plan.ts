/**
 * Rebuild Oscar's block through the new generator, as a test.
 *
 *   npx tsx scripts/test-plan.ts
 *
 * Reads nothing and writes nothing: it prints what the new pipeline would
 * produce so it can be compared with the hand-written block before anything
 * replaces it.
 *
 * Every input below is either taken from his actual training data or stated in
 * the plan document. The two that are neither are left neutral and named at the
 * bottom, because a test plan built on invented answers tests nothing.
 */
import { sql } from "../lib/db";
import { addDays, mondayOf } from "../lib/dates";
import { generate, type Params } from "../lib/plan/generate";
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
  console.log(`  ${races.n} Hyrox session(s) on file · max HR ${me.hr_max}\n`);

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
    // left neutral on purpose — see the note at the end
    partner: null,
    commitments: [],
    absences: [],
    exclusions: [],
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
Not answered, so left neutral:
  · partner deltas — how he compares with Olivier on running and on stations.
    Without them the role is 'balanced' and the split does not specialise.
  · commitments — kickboxing and strength are in the hand-written block, and
    nobody has said which are locked or how often.
  · division — needed for station loads, and it decides real kilos.`);
  process.exit(0);
}

main();
