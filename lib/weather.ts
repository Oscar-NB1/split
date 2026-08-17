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

const HOURLY = "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,"
  + "wind_speed_10m,wind_gusts_10m,weather_code,cloud_cover";

/** The hours a session is plausibly in. Nobody trains at 3am, and the daily
 *  maximum would call an evening run hot because the afternoon was. */
const SESSION_HOURS = [6, 21] as const;

type Hourly = {
  time?: string[]; temperature_2m?: number[]; relative_humidity_2m?: number[];
  apparent_temperature?: number[]; precipitation?: number[];
  wind_speed_10m?: number[]; wind_gusts_10m?: number[];
  weather_code?: number[]; cloud_cover?: number[];
};

/**
 * What the sky looks like, which is a different question from what it costs.
 *
 * `verdict` answers "does this change my session" — heat, wind, cold. This answers
 * "what am I walking out into", and an athlete glancing at their week wants the
 * second: seven days, seven icons, no reading.
 *
 * From the WMO code Open-Meteo reports, with cloud cover breaking the tie between a
 * clear morning and a grey one — codes 0 to 3 are all nominally "clear to overcast"
 * and the difference between them is exactly what somebody wants to see.
 */
export type Sky =
  | "clear" | "mostly_clear" | "partly_cloudy" | "cloudy"
  | "rain" | "storm" | "snow" | "fog";

export function skyFor(code: number | null, cloud: number | null, rainMm = 0): Sky {
  const c = code ?? -1;
  // Order matters: a thunderstorm is also raining, and snow is also precipitation.
  if (c >= 95) return "storm";
  if ((c >= 71 && c <= 77) || (c >= 85 && c <= 86)) return "snow";
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || rainMm >= 1) return "rain";
  if (c === 45 || c === 48) return "fog";
  const cover = cloud ?? 0;
  if (cover < 20) return "clear";
  if (cover < 50) return "mostly_clear";
  if (cover < 80) return "partly_cloudy";
  return "cloudy";
}

/**
 * The emoji for a sky, which is what the design asks for and what actually renders.
 *
 * Not an SVG and not a text glyph. The first version of the weather card used
 * typographic symbols and one of them — U+224B for wind — is missing from Inter and
 * from most system fallbacks, so it drew an empty box. Emoji come from the platform's
 * own colour font, so they are the one category of icon that cannot fail to render,
 * and on a week strip seven of them read faster than seven drawings.
 */
export const SKY_EMOJI: Record<Sky, string> = {
  clear: "\u2600\uFE0F",
  mostly_clear: "\uD83C\uDF24\uFE0F",
  partly_cloudy: "\u26C5",
  cloudy: "\u2601\uFE0F",
  rain: "\uD83C\uDF27\uFE0F",
  storm: "\u26C8\uFE0F",
  snow: "\u2744\uFE0F",
  fog: "\uD83C\uDF2B\uFE0F",
};

/** One day of a week strip: enough to draw an icon and say the temperature. */
export type DaySky = {
  date: string;
  sky: Sky;
  emoji: string;
  temp_c: number;
  feels_c: number;
  rain_mm: number;
  wind_kmh: number;
  /** what the conditions cost a pace target, so a hard day can be flagged */
  cost_s: number;
  /** true where this is the climate for the date rather than a forecast */
  typical?: boolean;
};

/**
 * A whole week in one request.
 *
 * Seven days as seven calls would be seven round trips to a third party every time
 * somebody opens their week, which is the sort of thing that makes a screen feel slow
 * for no reason. Open-Meteo takes a date range, so this takes one.
 *
 * Days beyond the forecast horizon are simply absent rather than filled from the
 * climate: a week strip is about what is coming, and "usually 12°C" next to six real
 * forecasts would read as a seventh forecast.
 */
export async function forecastWeek(
  lat: number, lon: number, from: string, to: string,
): Promise<DaySky[]> {
  const q = new URLSearchParams({
    latitude: lat.toFixed(3), longitude: lon.toFixed(3),
    hourly: HOURLY, start_date: from, end_date: to, timezone: "auto",
  });
  let json: { hourly?: Hourly };
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, {
      next: { revalidate: 3600 },
    });
    if (!r.ok) return [];
    json = await r.json();
  } catch {
    return [];
  }

  const days = [...new Set((json.hourly?.time ?? []).map((t) => t.slice(0, 10)))];
  const out: DaySky[] = [];
  for (const date of days) {
    const d = reduceDay(json.hourly, date);
    if (!d) continue;
    const sky = skyFor(d.code, d.cloud, d.rain_mm);
    out.push({
      date, sky, emoji: SKY_EMOJI[sky],
      temp_c: d.temp_c, feels_c: d.feels_c, rain_mm: d.rain_mm,
      wind_kmh: d.wind_kmh, cost_s: conditionsCost(d),
    });
  }
  return out;
}

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

  /*
   * The dominant code across the training hours, not the day's worst.
   *
   * A single thundery hour at 3pm should not make a Tuesday evening run a storm —
   * but it should not be averaged away either, since a code is a category and the
   * mean of two categories is not a category. The most frequent one wins, with the
   * highest code breaking a tie, because the more severe reading is the safer one to
   * show somebody deciding what to wear.
   */
  const codes = h.weather_code ? hours.map((i) => h.weather_code?.[i] ?? 0) : [];
  const tally = new Map<number, number>();
  for (const c of codes) tally.set(c, (tally.get(c) ?? 0) + 1);
  const code = codes.length
    ? [...tally.entries()].sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]))[0][0]
    : null;

  return {
    code,
    cloud: h.cloud_cover ? Math.round(mean(h.cloud_cover)) : null,
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
