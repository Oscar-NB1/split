/**
 * Reading an authored plan into the app's own session document.
 *
 * The plan is a document somebody wrote. This turns it into sessions the app can show, push
 * to a watch, compare a recorded activity against, and log strength into — and it changes
 * nothing about what was written. Where it cannot express something faithfully it says so and
 * refuses, because a session quietly turned into a different session is worse than an import
 * that stopped and told you which line it could not read.
 *
 * The document is the record. There is no form behind it and no arithmetic that could
 * reproduce it, which is why `plan_templates.origin` exists and why `rememberDay` declines to
 * touch an imported block.
 *
 * Two things make this trustworthy rather than hopeful:
 *
 *   Every session's prescription is checked against the app's own reader. A target
 *   `parseSteps` returns nothing for is an empty session screen and a watch with nothing to
 *   send, so it is a problem rather than a row.
 *
 *   Every week's running is summed and checked against the kilometres the document states for
 *   that week. The author already did the arithmetic; if this module's reading disagrees with
 *   it, this module is wrong. That check is the whole reason to trust the rest.
 */

export type ImportedSession = {
  /** 0 = Monday */
  day: number;
  kind: string;
  title: string;
  /** the plan's own name for it, where that differs from the kind */
  purpose?: string;
  target: string;
  note?: string;
  minutes: number;
  km: number;
  slot?: "AM" | "PM";
  significance?: "key" | "hard";
  /** true for something the athlete already does, scheduled around rather than prescribed */
  commitment?: boolean;
};

export type ImportedWeek = {
  n: number;
  monday: string;
  phase: string;
  /** the kilometres the document states for this week */
  stated_km: number;
  label: string;
  note: string;
  deload: boolean;
  taper: boolean;
  sessions: ImportedSession[];
};

export type Imported = {
  title: string;
  weeks: ImportedWeek[];
  /** things that stop the import: a line that could not be read, a session with no work in it */
  problems: string[];
  /**
   * Things the import resolved and wants said out loud.
   *
   * Separate from `problems` because they are not failures — they are places where the document
   * disagreed with itself and this module chose a side. A blocking list that also carries
   * decisions cannot be used to block, and one that hides them is worse.
   */
  notes: string[];
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dayOf = (s: string) => DAYS.indexOf(s.trim());

/** En dashes, non-breaking spaces and the rest of what a word processor leaves behind. */
const clean = (s: string) =>
  s.replace(/[–—]/g, "-").replace(/ /g, " ")
    .replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

/** `5:25-5:45` or `4:35` → the pace exactly as written, normalised. */
function paceOf(s: string): string | null {
  const m = /(\d{1,2}:[0-5]\d)\s*(?:-\s*(\d{1,2}:[0-5]\d))?\s*(?:\/\s*km)?/.exec(s);
  if (!m) return null;
  return m[2] ? `${m[1]}-${m[2]}` : m[1];
}

const paceSeconds = (p: string): number => {
  const all = [...p.matchAll(/(\d{1,2}):([0-5]\d)/g)].map((m) => Number(m[1]) * 60 + Number(m[2]));
  return all.reduce((a, b) => a + b, 0) / (all.length || 1);
};

const km1 = (n: number) => Math.round(n * 10) / 10;
const doseKm = (km: number) => (km >= 1 ? `${km1(km)}km` : `${Math.round(km * 1000)}m`);

/** `3 min` / `90 s` / `75 s` → seconds. */
function restOf(s: string): { seconds: number; word: string } | null {
  const m = /(\d+(?:\.\d+)?)\s*(min|minute|s|sec|second)s?\s*(walk|standing|jog)?/i.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  const seconds = /^m/i.test(m[2]) ? n * 60 : n;
  const word = /standing/i.test(s) ? "standing" : /jog/i.test(s) ? "jog" : "walk";
  return { seconds: Math.round(seconds), word };
}

/**
 * The zone a session's work sits in.
 *
 * Taken from what the plan calls the session rather than inferred from its pace, because the
 * author already decided: "Quality - Threshold" is threshold work whatever the number beside
 * it, and a pace that drifts across the block does not change what the session is for.
 */
function zoneFor(name: string): string {
  const n = name.toLowerCase();
  if (/openers|stride/.test(n)) return "Z5";
  if (/race session|race pace|time trial|1000 m|hard/.test(n)) return "Z4";
  if (/threshold|tempo|pace block|sim/.test(n)) return "Z3";
  return "Z2";
}

/* ------------------------------------------------------------------ sessions */

/**
 * A quality session: "8 km total · 3 × 8 min @ 4:35 · 3 min walk recovery".
 *
 * The total is the author's and is honoured exactly. The work comes out of it and whatever is
 * left becomes the warm-up and cool-down — two kilometres in front where there is room for it,
 * because that is what the rest of the plan assumes, and the remainder behind.
 */
function quality(
  detail: string, name: string,
): { target: string; km: number; minutes: number; over: number } | null {
  const total = /(\d+(?:\.\d+)?)\s*km\s*total/i.exec(detail);
  if (!total) return null;
  const km = Number(total[1]);
  const zone = zoneFor(name);

  const tt = /(\d+(?:\.\d+)?)\s*km\s+time trial/i.exec(detail);
  const reps = /(\d+)\s*[×x]\s*(\d+(?:\.\d+)?)\s*(km|m|min)\b/i.exec(detail);
  const pace = paceOf(detail.split("·").find((p) => /@/.test(p)) ?? "");
  /*
   * The rest comes from the segment that talks about rest.
   *
   * Reading it from everything after the total matched "8 min" out of "3 × 8 min @ 4:35" and
   * prescribed a 480-second walk between reps — eight minutes of standing around inside a
   * threshold session, from a document that says three.
   */
  const rest = restOf(
    detail.split("·").find((seg) => /rest|recovery|walk|standing|jog/i.test(seg)) ?? "",
  );

  let workKm = 0;
  const work: string[] = [];

  if (tt) {
    workKm = Number(tt[1]);
    work.push(`- ${doseKm(workKm)} ${zone} time trial — nonstop, negative split`);
  } else if (reps) {
    const n = Number(reps[1]), size = Number(reps[2]), unit = reps[3].toLowerCase();
    const paceS = pace ? paceSeconds(pace) : 0;
    const perKm = unit === "km" ? size
      : unit === "m" ? size / 1000
      : paceS ? (size * 60) / paceS : 0;
    if (!perKm) return null;
    workKm = perKm * n;
    const dose = unit === "min" ? `${size}m` : unit === "km" ? `${size}km` : `${size}m`;
    work.push(`- ${n}x`);
    work.push(`- ${dose} ${zone}${pace ? ` @ ${pace}/km` : ""}`);
    if (rest) work.push(`- ${rest.seconds}s Z1 ${rest.word}`);
  } else {
    return null;
  }

  /*
   * What is left after the work, in front and behind.
   *
   * Where the stated total cannot hold the work plus a warm-up, the work wins and the total
   * gives. Week 4 asks for 10 km containing 3 × 15 min at 4:33, which is 9.9 km of work on its
   * own — the session is right and the total was arithmetic. Trimming the reps to fit a number
   * would be changing the plan, which is the one thing an import must not do, so the session
   * comes out longer than stated and the caller is told by how much.
   */
  let spare = km1(km - workKm);
  let over = 0;
  /* A warm-up and a short cool-down is about a mile and a half. Below that there is no room. */
  const FLOOR = 1.5;
  if (spare < FLOOR) {
    over = km1(FLOOR - spare);
    spare = FLOOR;
  }
  /* The warm-up is never shorter than the cool-down: 2 km in and 3 km out of a time trial is
     the wrong way round, and a cool-down is the part you shorten when you are short of room. */
  const warm = km1(Math.min(3, Math.max(0.5, spare * 0.6)));
  const cool = km1(spare - warm);
  const lines = [`- ${doseKm(warm)} Z2 warm up`];
  lines.push(...work);
  if (cool >= 0.4) lines.push(`- ${doseKm(cool)} Z1 cool down`);
  else lines[0] = `- ${doseKm(km1(warm + cool))} Z2 warm up`;

  const workS = pace ? workKm * paceSeconds(pace) : workKm * 270;
  const restS = reps && rest ? Number(reps[1]) * rest.seconds : 0;
  return {
    target: lines.join("\n"),
    km: km1(km + over),
    minutes: Math.round((spare * 330 + workS + restS) / 60),
    over,
  };
}

/**
 * An easy or long run: "10.5 km @ 5:22-5:42 · HR under 152 · 6 × 20 s strides",
 * "16.0 km @ 5:12-5:28 · last 3 km @ 5:00", "18.0 km @ 5:08-5:22 · 3 × 1 km @ 4:30 from km 8".
 *
 * The distance and the pace are the author's. A pace block inside the run is written as its own
 * step so the run's total stays what was stated: the block's kilometres come out of the easy
 * body rather than being added to the end.
 */
function run(detail: string, name: string): { target: string; km: number; minutes: number; note?: string } | null {
  const first = /(\d+(?:\.\d+)?)\s*km/i.exec(detail);
  if (!first) return null;
  const km = Number(first[1]);
  const parts = detail.split("·").map(clean);
  const pace = paceOf(parts[0].replace(/^[\d.]+\s*km/i, ""));
  const easy = name.toLowerCase().includes("long") ? "Z2" : "Z2";
  const lines: string[] = [];
  const notes: string[] = [];

  /* "last 3 km @ 4:30" — a finishing block. */
  const last = /last\s+(\d+(?:\.\d+)?)\s*km\s*@\s*(\d{1,2}:[0-5]\d)/i.exec(detail);
  /* "3 × 1 km @ 4:30 embedded from km 8" — blocks inside the run. */
  const emb = /(\d+)\s*[×x]\s*(\d+(?:\.\d+)?)\s*km\s*@\s*(\d{1,2}:[0-5]\d)[^·]*?from km\s*(\d+)/i.exec(detail);
  /* "6 × 20 s strides" — on the end of an easy run, and they are part of its distance. */
  const strides = /(\d+)\s*[×x]\s*(\d+)\s*s\s*strides?/i.exec(detail);
  const hr = /HR under (\d+)/i.exec(detail);
  if (hr) notes.push(`Keep it under ${hr[1]} bpm.`);

  if (emb) {
    /*
     * Embedded blocks are written out one at a time rather than as a repeat.
     *
     * A repeat block in this syntax runs until a warm-up or cool-down closes it, so
     * "- 3x / - 1km Z3 / - 7km Z2" is read by the app as three lots of 1 km AND 7 km — an
     * 18 km long run that the session screen showed as 32. Written explicitly there is
     * nothing to absorb: each block and each float is its own line, and the total is the
     * total.
     *
     * The float between blocks is a kilometre. "3 × 1 km" separates them, otherwise it would
     * say 3 km, and a kilometre is the conventional read — it is the only number here that is
     * this module's rather than the author's, and it is taken out of the easy body so the run
     * still totals what was written.
     */
    const n = Number(emb[1]), each = Number(emb[2]), bp = emb[3], from = Number(emb[4]);
    const FLOAT = 1;
    const floats = n - 1;
    const tail = km1(km - from - n * each - floats * FLOAT);
    if (tail < 0) return null;
    const at = pace ? ` @ ${pace}/km` : "";
    lines.push(`- ${doseKm(from)} ${easy}${at}`);
    for (let i = 0; i < n; i += 1) {
      lines.push(`- ${doseKm(each)} Z3 @ ${bp}/km`);
      if (i < n - 1) lines.push(`- ${doseKm(FLOAT)} ${easy} float${at}`);
    }
    if (tail >= 0.4) lines.push(`- ${doseKm(tail)} ${easy}${at}`);
  } else if (last) {
    const block = Number(last[1]);
    const body = km1(km - block);
    if (body < 0.5) return null;
    lines.push(`- ${doseKm(body)} ${easy}${pace ? ` @ ${pace}/km` : ""}`);
    lines.push(`- ${doseKm(block)} Z3 @ ${last[2]}/km`);
  } else {
    lines.push(`- ${doseKm(km)} ${easy}${pace ? ` @ ${pace}/km` : ""}`);
  }

  if (strides) {
    /*
     * Strides sit inside the stated distance, not on top of it. Six twenty-second strides is
     * about half a kilometre, and adding it would put every easy run in the block half a
     * kilometre over what the author wrote — which the weekly total would then catch.
     */
    const n = Number(strides[1]), secs = Number(strides[2]);
    lines.push(`- ${n}x`);
    lines.push(`- ${secs}s Z5 stride`);
    lines.push("- 60s Z1 walk");
  }

  const paceS = pace ? paceSeconds(pace) : 330;
  return {
    target: lines.join("\n"),
    km,
    minutes: Math.round((km * paceS) / 60) + (strides ? 3 : 0),
    note: notes.length ? notes.join(" ") : undefined,
  };
}

/**
 * A Hyrox class: "4.0 km of running inside the class · run reps at 4:35/km · time transitions".
 *
 * Written as the running it contains plus what to do inside it. The class is not a prescription
 * — somebody else is running it — so this says what the athlete controls: the pace of the run
 * legs, and the clock on the transitions.
 */
function hyroxClass(detail: string, name: string): { target: string; km: number; minutes: number; note?: string } | null {
  /*
   * The distance is optional, because the plan stopped stating it for the moderate class.
   *
   * It used to say "2.5 km of running inside the class"; it now says only what to do in there,
   * because the running inside a class became a bonus on top of the week rather than part of
   * its number. A class with no stated distance therefore prescribes no distance — inventing
   * one would put kilometres back into the week that the author deliberately took out.
   */
  const m = /(\d+(?:\.\d+)?)\s*km\s*of\s*running/i.exec(detail);
  const km = m ? Number(m[1]) : 0;
  const pace = /at\s*(\d{1,2}:[0-5]\d)/i.exec(detail);
  const hard = /hard|sim/i.test(name);
  const zone = hard ? "Z4" : "Z2";
  const minutes = hard ? 70 : 60;
  /* With no distance stated, every clause is a cue — there is no leading dose to skip. */
  const cues = (m ? detail.split("·").slice(1) : detail.split("·")).map(clean).filter(Boolean);
  const what = /sim/i.test(name) ? "full simulation" : "Hyrox class";
  const lines = km > 0
    ? [`- ${doseKm(km)} ${zone} running inside the class${pace ? ` @ ${pace[1]}/km` : ""}`]
    /*
     * A class with no prescribed running still has to say what to do in it, and it is stated in
     * minutes rather than as a distance — the plan no longer counts the running inside it.
     *
     * `min` rather than a bare `m`: sixty of those is sixty metres, because the dose grammar
     * reads `m` under sixty as minutes and everything above it as metres. A one-hour session
     * would have gone in as a sixty-metre one.
     */
    : [`- ${minutes} min ${zone} ${what}${pace ? ` — run reps @ ${pace[1]}/km` : ""}`];
  return {
    target: lines.join("\n"),
    km,
    minutes,
    note: cues.length ? `${cues.join(". ")}.` : undefined,
  };
}

/**
 * Strength, into the app's own lift syntax so the session screen can log it.
 *
 * `Trap bar deadlift 4 × 5 @ 75-80%` becomes `Trap bar deadlift 4x5 rest 180s`, and the
 * percentage goes in the note. The app prescribes load from what was last lifted and an RPE
 * target; a percentage of a maximum nobody has tested is a third opinion, so it is preserved
 * as the author's words rather than converted into a number.
 */
function strength(detail: string): { target: string; minutes: number; note?: string } | null {
  const items = detail.split("·").map(clean).filter(Boolean);
  if (items.length === 0) return null;
  const lines: string[] = [];
  const notes: string[] = [];
  for (const item of items) {
    const m = /^(.+?)\s+(\d+)\s*[×x]\s*(\d+(?:\.\d+)?)\s*(s|m|km)?\b(.*)$/i.exec(item);
    if (!m) {
      /* "Dead hang 3 × max" and anything else without a number: kept as a note, not invented. */
      notes.push(item);
      continue;
    }
    const [, rawName, sets, reps, unit, tail] = m;
    const name = clean(rawName);
    /*
     * Rest from the movement rather than from a table: the heavy compound gets three minutes,
     * everything else ninety seconds. The author did not state rests, and a rest is part of a
     * prescription — so this is the one number here that is this module's and it is stated.
     */
    const heavy = /deadlift|squat|press|pull-up/i.test(name) && Number(reps) <= 6;
    lines.push(`${name} ${sets}x${Math.round(Number(reps))} rest ${heavy ? 180 : 90}s`);
    const extra = clean(`${unit === "s" ? "seconds" : unit === "m" ? "metres" : ""} ${tail}`);
    if (extra) notes.push(`${name}: ${extra}`);
  }
  if (lines.length === 0) return null;
  return {
    target: lines.join("\n"),
    minutes: 45,
    note: notes.length ? notes.join(" · ") : undefined,
  };
}

/* -------------------------------------------------------------------- rows */

/** What the plan calls a session, mapped to what the app calls one. */
function kindOf(name: string): { kind: string; hard: boolean } | null {
  const n = name.toLowerCase();
  if (/^rest$|^off$|^—$|^-$/.test(n)) return null;
  if (/b-race|^race$/.test(n)) return { kind: "race", hard: true };
  if (/full sim/.test(n)) return { kind: "hyrox", hard: true };
  if (/hyrox class/.test(n)) return { kind: "hyrox", hard: /hard/i.test(n) };
  if (/^quality|openers/.test(n)) return { kind: "quality_run", hard: true };
  if (/^strength/.test(n)) return { kind: "strength", hard: false };
  if (/long run/.test(n)) return { kind: "long_run", hard: false };
  if (/easy run|shakeout/.test(n)) return { kind: "easy_run", hard: false };
  return null;
}

function sessionsFrom(
  day: number, name: string, detail: string,
  problems: string[], notes: string[], week: number,
): ImportedSession[] {
  const out: ImportedSession[] = [];
  const k = kindOf(name);
  const where = `week ${week} ${DAYS[day]}`;

  if (k) {
    let built: {
      target: string; km?: number; minutes: number; note?: string; over?: number;
    } | null = null;
    if (k.kind === "quality_run") built = quality(detail, name);
    else if (k.kind === "long_run" || k.kind === "easy_run") built = run(detail, name);
    else if (k.kind === "hyrox") built = hyroxClass(detail, name);
    else if (k.kind === "strength") built = strength(detail);
    else if (k.kind === "race") built = { target: "", minutes: 90, km: 0, note: clean(detail) };

    if (!built && k.kind !== "race") {
      problems.push(`${where}: could not read "${name}" — ${detail}`);
    } else if (built) {
      if (built.over) {
        /*
         * Reported so it reaches the import summary, and worded so it is obvious which side
         * won: the work is the plan, the total was arithmetic, and the session is longer than
         * the document says by exactly this much.
         */
        notes.push(
          `week ${week} ${DAYS[day]}: "${detail}" states a total the work does not fit inside `
          + `— the session comes to ${built.over} km more, and the work is what was kept.`,
        );
      }
      out.push({
        day, kind: k.kind,
        title: clean(name).replace(/\s*·\s*Kickboxing PM$/i, ""),
        purpose: clean(name).replace(/\s*·\s*Kickboxing PM$/i, ""),
        target: built.target,
        note: built.note ?? (k.kind === "race" ? clean(detail) : undefined),
        minutes: built.minutes,
        km: built.km ?? 0,
        ...(k.hard ? { significance: "key" as const } : {}),
      });
    }
  } else if (!/^rest$|^off$|^—$|^-$/i.test(clean(name))) {
    problems.push(`${where}: unrecognised session "${name}"`);
  }

  /*
   * "Easy run · Kickboxing PM" is two sessions, not one with a footnote. The kickboxing is
   * something he already does and the plan is scheduled around it — so it is a commitment on
   * the calendar, in the evening, and it carries no prescription because it is not the plan's
   * to write.
   */
  if (/kickboxing/i.test(name)) {
    out.push({
      day, kind: "kickboxing", title: "Kickboxing", target: "",
      minutes: 60, km: 0, slot: "PM", commitment: true,
    });
  }
  return out;
}

/* ------------------------------------------------------------------- weeks */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** "17-23 Aug" / "31 Aug - 6 Sep" / "23-28 Nov" → the Monday, in the plan's year. */
function mondayOf(head: string, year: number): string | null {
  const m = /(\d{1,2})\s*(?:([A-Za-z]{3,})\s*)?-/.exec(clean(head))
    ?? /(\d{1,2})\s+([A-Za-z]{3,})/.exec(clean(head));
  if (!m) return null;
  const day = Number(m[1]);
  const month = m[2]
    ? MONTHS[m[2].slice(0, 3).toLowerCase()]
    /* "17-23 Aug": the month is stated after the range, so read it from the whole string. */
    : MONTHS[(/([A-Za-z]{3,})/.exec(clean(head))?.[1] ?? "").slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  const d = new Date(Date.UTC(year, month, day));
  return d.toISOString().slice(0, 10);
}

export function parsePlan(text: string, year = 2026): Imported {
  const lines = text.split("\n").map((l) => l.replace(/^\[\w+\]\s*/, ""));
  const problems: string[] = [];
  const notes: string[] = [];
  const weeks: ImportedWeek[] = [];
  const title = clean(lines.find((l) => /week block/i.test(l)) ?? "Imported plan");

  let i = 0;
  let cur: ImportedWeek | null = null;
  while (i < lines.length) {
    const line = clean(lines[i]);

    const head = /^Week (\d+)\s*[·:]\s*(.+)$/.exec(line);
    if (head) {
      const label = head[2];
      const monday = mondayOf(label, year);
      if (!monday) problems.push(`week ${head[1]}: could not read the dates from "${label}"`);
      /* The line after the header is "Phase · NN km". */
      const meta = clean(lines[i + 1] ?? "");
      const pm = /^(\w+)\s*·\s*(\d+(?:\.\d+)?)\s*km$/i.exec(meta);
      cur = {
        n: Number(head[1]),
        monday: monday ?? "",
        phase: (pm?.[1] ?? "base").toLowerCase(),
        stated_km: pm ? Number(pm[2]) : 0,
        label: clean(label),
        note: "",
        deload: /down week/i.test(label),
        taper: /taper|race week/i.test(label) || /taper/i.test(pm?.[1] ?? ""),
        sessions: [],
      };
      if (!pm) problems.push(`week ${cur.n}: could not read the phase and kilometres from "${meta}"`);
      weeks.push(cur);
      i += 2;
      continue;
    }

    if (cur && DAYS.includes(line) && i + 2 < lines.length) {
      const name = clean(lines[i + 1]);
      const detail = clean(lines[i + 2]);
      /* A day row is three cells. Anything else and the table has been misread. */
      if (DAYS.includes(name)) { i += 1; continue; }
      cur.sessions.push(
        ...sessionsFrom(dayOf(line), name, detail, problems, notes, cur.n));
      i += 3;
      continue;
    }

    /*
     * The paragraph after a week's table, where there is one, is the author's note about the
     * week. Kept, because it is the part that says why the week is shaped as it is.
     */
    if (cur && cur.sessions.length > 0 && line && !DAYS.includes(line)
      && !/^(Day|Session|Detail)$/i.test(line) && !cur.note && !/^Week \d/.test(line)) {
      cur.note = line;
    }
    i += 1;
  }

  return { title, weeks, problems, notes };
}

/**
 * The week's own running, which is what the author's weekly number counts.
 *
 * The convention changed between revisions of his document, and it matters more than any single
 * distance did. It used to be "every kilometre in this document is running you will actually do
 * — including the running inside the Hyrox classes". It is now "every kilometre below is running
 * you will actually do on your own two feet. The Hyrox classes contain running too — that is a
 * bonus on top, not part of the weekly number. Skip a class and the week still stands."
 *
 * So the classes come out of the figure checked against the document, and are reported beside
 * it. That is also the better design: the classes are the variable, and a week that still stands
 * when one is missed is a week somebody can actually keep.
 */
export const weekKm = (w: ImportedWeek): number =>
  km1(w.sessions
    .filter((s) => s.kind !== "hyrox" && s.kind !== "easy_hyrox")
    .reduce((n, s) => n + (s.km ?? 0), 0));

/** And the running inside the classes, which sits on top of it. */
export const classKm = (w: ImportedWeek): number =>
  km1(w.sessions
    .filter((s) => s.kind === "hyrox" || s.kind === "easy_hyrox")
    .reduce((n, s) => n + (s.km ?? 0), 0));
