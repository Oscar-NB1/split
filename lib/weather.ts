/**
 * The weather, and what it does to a pace target.
 *
 * A session run at 28°C in full sun is a different session from the same one run at
 * 12°C, and an athlete who misses their targets in a heatwave has not got slower.
 * The calibration engine reads pace against prescription and had no idea what the
 * air was doing, so a hot fortnight would have quietly recommended slowing the whole
 * plan down — permanently, from a temporary cause.
 *
 * Two jobs here, and they are deliberately separate:
 *
 *   what it will be     a forecast for a session, so the athlete can decide when to
 *                       run and what to carry before they get out of bed
 *   what it cost        a retrospective adjustment, used by calibration to discount
 *                       a session run in conditions nobody can hold a pace in
 *
 * Open-Meteo, because it needs no key and no account: this is a running app, not a
 * weather company, and a feature that only works once somebody signs up for a third
 * party is a feature that does not work. Attribution and terms are theirs
 * (open-meteo.com, CC-BY 4.0, free for non-commercial use).
 */

export type Forecast = {
  /** the day this describes, ISO */
  date: string;
  /** °C, and what it feels like once humidity and sun are in it */
  temp_c: number;
  feels_c: number;
  humidity: number;
  /** km/h, and the gust, because a headwind is what ruins an interval session */
  wind_kmh: number;
  gust_kmh: number;
  /** mm over the hours the session is likely to be in */
  rain_mm: number;
  /** how the plan reads the above, in one word */
  verdict: Verdict;
  /** seconds per km this costs, at the prescribed effort */
  cost_s: number;
  /** what to say about it, in one sentence */
  headline: string;
  /**
   * Whether this is a forecast or what that day is usually like.
   *
   * A forecast reaches sixteen days. A race is booked months out, which is exactly
   * when an athlete wants to know what they are training for — so beyond the horizon
   * this becomes the same calendar day averaged over recent years. It is labelled,
   * because "23°C on race day" and "usually about 23°C on that date" are different
   * claims and only one of them is a forecast.
   */
  typical?: boolean;
};

export type Verdict = "fine" | "warm" | "hot" | "cold" | "wet" | "windy";

/**
 * What heat costs a runner, in seconds per kilometre.
 *
 * From the shape every published heat-adjustment table agrees on: nothing below
 * about 15°C, then a cost that accelerates rather than climbing in a straight line —
 * the difference between 25° and 30° hurts far more than the one between 15° and
 * 20°. Humidity is the multiplier, because it is what stops sweat working, and at
 * 30°C and 80% humidity there is no pace target worth chasing.
 *
 * Deliberately conservative. An adjustment that is too generous hands an athlete an
 * excuse; this one only recognises conditions that genuinely change what is
 * possible.
 */
export function heatCost(tempC: number, humidity: number): number {
  if (tempC <= 15) return 0;
  const over = tempC - 15;
  // ~1 s/km at 18°, ~4 at 22°, ~11 at 27°, ~20 at 32° in dry air
  const dry = 0.055 * over ** 1.75;
  // humid air multiplies it; 50% is the neutral point rather than a penalty
  const humid = 1 + Math.max(0, humidity - 50) / 100;
  return Math.round(dry * humid);
}

/**
 * What a headwind costs.
 *
 * Only the wind that is strong enough to be felt as resistance rather than as
 * weather. A loop course gets some of it back as a tailwind, which is why this is
 * roughly half of what a pure headwind would cost — and why it stays small.
 */
export function windCost(kmh: number): number {
  if (kmh <= 15) return 0;
  return Math.round((kmh - 15) * 0.45);
}

/** Cold costs almost nothing above freezing, and ice is not a pace problem. */
export function coldCost(tempC: number): number {
  if (tempC >= 2) return 0;
  return Math.min(12, Math.round((2 - tempC) * 1.2));
}

/**
 * Everything the conditions cost, together.
 *
 * Capped at 25 s/km. Past that the honest answer is not a slower target but a
 * different session, and a plan that offers to adjust a pace by forty seconds is
 * pretending the session was still the session.
 */
export const conditionsCost = (f: {
  temp_c: number; humidity: number; wind_kmh: number;
}): number => Math.min(25,
  heatCost(f.temp_c, f.humidity) + windCost(f.wind_kmh) + coldCost(f.temp_c));

/** Which single thing about the day matters most. */
export function verdictFor(f: {
  temp_c: number; humidity: number; wind_kmh: number; rain_mm: number;
}): Verdict {
  if (f.temp_c >= 27 || heatCost(f.temp_c, f.humidity) >= 8) return "hot";
  if (f.wind_kmh >= 30) return "windy";
  if (f.temp_c <= 1) return "cold";
  if (f.rain_mm >= 4) return "wet";
  if (f.temp_c >= 21) return "warm";
  return "fine";
}

/**
 * The sentence.
 *
 * Written as advice rather than as data. "24°C, 71% humidity" is a readout; "warm
 * enough to cost you a few seconds a kilometre — take the pace, not the target" is
 * something an athlete can act on before they open the door.
 */
export function headlineFor(f: {
  verdict: Verdict; temp_c: number; wind_kmh: number; rain_mm: number; cost_s: number;
  humidity?: number;
}): string {
  const cost = f.cost_s > 0 ? ` Expect about ${f.cost_s} s/km slower for the same effort.` : "";
  switch (f.verdict) {
    case "hot":
      // Only called humid when it is. Dry heat at forty degrees is its own problem
      // and an athlete reading the wrong cause takes the wrong precautions.
      return `${Math.round(f.temp_c)}°C${(f.humidity ?? 0) >= 65 ? " and humid" : ""}. Run by effort today, not by the pace on the card — and start earlier if you can.${cost}`;
    case "warm":
      return `${Math.round(f.temp_c)}°C. Warm enough to notice on the hard reps.${cost}`;
    case "windy":
      return `${Math.round(f.wind_kmh)} km/h wind. Take the intervals into it and the recoveries with it, so every rep is honest.${cost}`;
    case "cold":
      return `${Math.round(f.temp_c)}°C. Add ten minutes to the warm-up and keep the first rep controlled — cold muscles are where hamstrings go.`;
    case "wet":
      return `${f.rain_mm < 10 ? f.rain_mm : Math.round(f.rain_mm)} mm of rain about. No pace penalty in the rain, but the corners are worth respecting.`;
    default:
      return `${Math.round(f.temp_c)}°C and settled. No excuses in the forecast.`;
  }
}

/**
 * Whether the conditions were bad enough to discount a session.
 *
 * The threshold is deliberately higher than "it cost something", because the
 * calibration engine already tolerates ±2 s/km of noise. This is for the days that
 * genuinely change what was possible.
 */
export const wasAdverse = (cost: number): boolean => cost >= 6;

const HOURLY =
  "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,wind_speed_10m,wind_gusts_10m";

/** The hours a session is plausibly in. Nobody trains at 3am, and the daily
 *  maximum would call an evening run hot because the afternoon was. */
const SESSION_HOURS = [6, 21] as const;

type Hourly = {
  time?: string[]; temperature_2m?: number[]; relative_humidity_2m?: number[];
  apparent_temperature?: number[]; precipitation?: number[];
  wind_speed_10m?: number[]; wind_gusts_10m?: number[];
};

/** The training-hours average of one day's hourly series. */
function reduceDay(h: Hourly | undefined, day?: string) {
  if (!h?.time?.length) return null;
  const hours = h.time
    .map((t, i) => ({ hour: Number(t.slice(11, 13)), on: t.slice(0, 10), i }))
    .filter(({ hour, on }) =>
      hour >= SESSION_HOURS[0] && hour <= SESSION_HOURS[1] && (!day || on === day))
    .map(({ i }) => i);
  if (hours.length === 0) return null;

  const mean = (a?: number[]) => a
    ? hours.reduce((s, i) => s + (a[i] ?? 0), 0) / hours.length : 0;
  const peak = (a?: number[]) => a ? Math.max(...hours.map((i) => a[i] ?? 0)) : 0;
  const sum = (a?: number[]) => a
    ? hours.reduce((s, i) => s + (a[i] ?? 0), 0) : 0;

  return {
    temp_c: Math.round(mean(h.temperature_2m) * 10) / 10,
    feels_c: Math.round(mean(h.apparent_temperature) * 10) / 10,
    humidity: Math.round(mean(h.relative_humidity_2m)),
    wind_kmh: Math.round(mean(h.wind_speed_10m)),
    gust_kmh: Math.round(peak(h.wind_gusts_10m)),
    // summed, not averaged: 1 mm an hour for six hours is a wet session
    rain_mm: Math.round(sum(h.precipitation) * 10) / 10,
  };
}

/** Open-Meteo forecasts sixteen days; fifteen is the safe side of that. */
export function beyondHorizon(date: string, today = new Date()): boolean {
  const days = (Date.parse(`${date}T12:00:00Z`) - today.getTime()) / 86_400_000;
  return days > 15;
}

/**
 * What that calendar day is usually like, from the reanalysis archive.
 *
 * The same date across the last five complete years, averaged. Five is enough to
 * stop one freak year deciding what an athlete packs, and short enough to describe
 * the climate they will actually race in rather than the one from a decade ago.
 *
 * Reported with `typical: true` so nothing downstream can present it as a forecast.
 */
export async function typicalFor(
  lat: number, lon: number, date: string,
): Promise<Forecast | null> {
  const md = date.slice(5);
  const thisYear = Number(date.slice(0, 4));
  // ERA5 lags by about five days, so the current year is never one of them
  const years = [1, 2, 3, 4, 5].map((n) => thisYear - n);

  const days: NonNullable<ReturnType<typeof reduceDay>>[] = [];
  for (const y of years) {
    const on = `${y}-${md}`;
    const q = new URLSearchParams({
      latitude: lat.toFixed(3), longitude: lon.toFixed(3),
      hourly: HOURLY, start_date: on, end_date: on, timezone: "auto",
    });
    try {
      const r = await fetch(`https://archive-api.open-meteo.com/v1/archive?${q}`, {
        // A past day never changes. Cached for a week so a race screen opened
        // daily for four months is five requests, not six hundred.
        next: { revalidate: 604_800 },
      });
      if (!r.ok) continue;
      const one = reduceDay(((await r.json()) as { hourly?: Hourly }).hourly, on);
      if (one) days.push(one);
    } catch {
      // one missing year is not a reason to have no answer
    }
  }
  if (days.length === 0) return null;

  const avg = (pick: (d: (typeof days)[number]) => number) =>
    days.reduce((s, d) => s + pick(d), 0) / days.length;
  const base = {
    temp_c: Math.round(avg((d) => d.temp_c) * 10) / 10,
    feels_c: Math.round(avg((d) => d.feels_c) * 10) / 10,
    humidity: Math.round(avg((d) => d.humidity)),
    wind_kmh: Math.round(avg((d) => d.wind_kmh)),
    gust_kmh: Math.round(avg((d) => d.gust_kmh)),
    rain_mm: Math.round(avg((d) => d.rain_mm) * 10) / 10,
  };
  const cost_s = conditionsCost(base);
  const verdict = verdictFor(base);
  return {
    date, ...base, cost_s, verdict, typical: true,
    /*
     * One sentence, not two.
     *
     * Stitching the forecast headline on the end produced "Usually about 7°C on this
     * date… 7°C and settled", which says the temperature twice and reads like two
     * systems talking over each other. What an athlete wants from a date four months
     * out is the number, the feel, and whether it changes how they should train.
     */
    headline: [
      `Usually about ${Math.round(base.temp_c)}°C on this date`,
      Math.abs(base.feels_c - base.temp_c) >= 3
        ? ` — feels more like ${Math.round(base.feels_c)}°C with the wind` : "",
      `, averaged over the last ${days.length} years.`,
      cost_s >= 6
        ? ` Warm enough to plan for: expect about ${cost_s} s/km on race pace, and train some sessions in the heat.`
        : verdict === "cold"
          ? " Plan the warm-up and what you take off at the start line."
          : " Nothing in the climate to plan around.",
    ].join(""),
  };
}

/**
 * One day's forecast, from Open-Meteo.
 *
 * Averaged across the hours a session is plausibly in — 6am to 9pm — rather than
 * taken at the daily maximum, which would call an evening run hot because the
 * afternoon was. Returns null rather than throwing: a weather service being down is
 * not a reason for a training app to show an error.
 */
export async function forecast(
  lat: number, lon: number, date: string,
): Promise<Forecast | null> {
  /*
   * Beyond the forecast horizon, what that day is usually like.
   *
   * Sixteen days is as far as any forecast reaches, and a race is booked months out —
   * which is precisely when an athlete wants to know whether they are training for a
   * cold morning or a hot one. Past the horizon this hands over to the archive and
   * says so, rather than returning nothing for every date that matters most.
   */
  if (beyondHorizon(date)) return typicalFor(lat, lon, date);

  const q = new URLSearchParams({
    latitude: lat.toFixed(3), longitude: lon.toFixed(3),
    hourly: HOURLY,
    start_date: date, end_date: date, timezone: "auto",
  });
  let json: { hourly?: Hourly };
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, {
      // A day's forecast is worth keeping for an hour; it does not change faster
      // than that, and the athlete may open the screen a dozen times.
      next: { revalidate: 3600 },
    });
    if (!r.ok) return null;
    json = await r.json();
  } catch {
    return null;
  }

  const base = reduceDay(json.hourly, date);
  if (!base) return null;

  const cost_s = conditionsCost(base);
  const verdict = verdictFor(base);
  return {
    date, ...base, cost_s, verdict,
    headline: headlineFor({ ...base, verdict, cost_s }),
  };
}
