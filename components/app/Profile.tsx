"use client";
import { useEffect, useState } from "react";
import { fmt } from "@/lib/dates";
import type { Zone } from "@/lib/zones";
import Mark from "./Mark";
import Notifications from "./Notifications";
import Away from "./Away";
import type { User } from "./Shell";
/* The same words the session note uses, so the tick and the session read as one feature. */
import { saysWhat, type TrainingConstraint } from "@/lib/plan/constraints";

const TEAL = "#0A8FB0", NAVY = "#12314D";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const OFF = "var(--off)", PAPER = "var(--paper)", LINE = "var(--line)";

export type Prof = {
  hr_max: number | null; notify: Record<string, boolean>; display_name: string;
  email: string; dob: string | null; weight_kg: number | null; injury_notes: string | null;
  connected: string[]; activities: number; since: string | null;
  coachees?: { id: string; display_name: string; email: string }[];
  coached_by?: { id: string; display_name: string; email: string }[];
  has_plan?: boolean;
  avatar_url?: string | null;
  gender?: string | null;
  /** which plan this screen is reading, for when something looks wrong */
  plan_source?: string | null;
};

export default function Profile({
  me, openEdit, openConnect, openWatch, openBuild, openCoachee, openNotes, openBench,
  openPreflight,
}: {
  me: User; openEdit: () => void; openConnect: () => void; openWatch: () => void;
  openBuild: () => void;
  /** enter someone else's week — coaching is a relationship, not a toggle */
  openCoachee: (id: string) => void;
  /** write what they read in their week */
  openNotes: (id: string) => void;
  openBench: () => void;
  openPreflight: () => void;
}) {
  const [p, setP] = useState<Prof | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [units, setUnits] = useState("Metric");
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem("split-theme") === "dark" ? "dark" : "light";
    setTheme(t);
    document.documentElement.dataset.theme = t;
    setUnits(localStorage.getItem("split-units") === "Imperial" ? "Imperial" : "Metric");
    fetch("/api/profile").then(async (r) => r.ok && setP(await r.json()));
  }, []);

  const connected = (p?.connected ?? []).includes("strava");
  /*
   * Read separately from the profile payload: the watch connection lives in its own endpoint
   * because it is the only one that can report what has actually been sent.
   */
  const [watchOn, setWatchOn] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/intervals").then((r) => r.json())
      .then((j) => setWatchOn(Boolean(j?.connected))).catch(() => setWatchOn(false));
  }, []);

  function flip(t: "light" | "dark") {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    localStorage.setItem("split-theme", t);
    /*
     * And the strip iOS paints around the home indicator.
     *
     * It reads `theme-color`, not the page background, so without this a dark app
     * keeps a white band across the bottom of the installed PWA — the blank space
     * that no amount of tab-bar padding could remove, because it is outside the
     * document entirely.
     */
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      if (!m.getAttribute("media")) m.setAttribute("content", t === "dark" ? "#0F2233" : "#F1F4F7");
    });
  }


  return (
    <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
      <button onClick={openEdit} style={{
        display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left",
        background: PAPER, border: `1px solid ${LINE}`, borderRadius: "var(--r-card)",
        padding: 16, color: "var(--ink)",
      }}>
        <span style={{ width: 56, height: 56, flex: "none", borderRadius: "50%",
          overflow: "hidden", background: TEAL, color: "#fff", fontSize: 22,
          fontWeight: 800, display: "flex", alignItems: "center",
          justifyContent: "center" }}>
          {p?.avatar_url
            ? <img src={p.avatar_url} alt="" width={56} height={56}
                style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : (p?.display_name ?? me.display_name).slice(0, 1).toUpperCase()}
        </span>
        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontFamily: "var(--display)", fontSize: 19, fontWeight: 700 }}>
            {p?.display_name ?? me.display_name}
          </span>
          <span style={{ fontSize: 12, color: INK55 }}>{p?.email ?? ""}</span>
          <span style={{ fontSize: 11, color: INK40 }}>
            {p ? `${p.activities} activities${p.since ? ` since ${fmt(p.since, { month: "short", year: "numeric" })}` : ""}` : ""}
          </span>
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em",
          textTransform: "uppercase", color: TEAL }}>Edit ›</span>
      </button>

      {/* One connection, and a row rather than a toggle: connecting a service is
          an authorisation, and a switch implies the app can grant it. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={caps}>Connected apps</span>
        <div style={{ background: PAPER, border: `1px solid ${LINE}`,
          borderRadius: "var(--r-card)", padding: "4px 16px" }}>
          <button onClick={openConnect} style={{ display: "flex", alignItems: "center",
            gap: 12, width: "100%", padding: "13px 0", background: "none",
            color: "var(--ink)", textAlign: "left" }}>
            <Mark id="strava" label="Strava" size={34} radius={9} />
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Strava</span>
              <span style={{ fontSize: 11, fontWeight: 700,
                color: connected ? TEAL : INK40 }}>
                {p == null ? "…" : connected ? "Connected" : "Not connected"}
              </span>
            </span>
            <span style={{ fontSize: 18, color: INK40 }}>›</span>
          </button>

          {/*
            * The other half of a connection, and the one that was unreachable.
            *
            * Strava brings finished sessions in; this sends planned ones out to the watch. The
            * panel existed only on the /settings web page, which nothing in the app links to —
            * so the push route told people to add their key in Settings and there was no way to
            * get there. It belongs here, under the heading somebody actually looks under.
            */}
          <button onClick={openWatch} style={{ display: "flex", alignItems: "center",
            gap: 12, width: "100%", padding: "13px 0", background: "none",
            color: "var(--ink)", textAlign: "left", borderTop: `1px solid ${LINE}` }}>
            <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 9,
              background: OFF, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 17 }}>⌚</span>
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Your watch</span>
              <span style={{ fontSize: 11, fontWeight: 700,
                color: watchOn ? TEAL : INK40 }}>
                {watchOn == null ? "…" : watchOn ? "Connected · sessions are sent" : "Not connected"}
              </span>
            </span>
            <span style={{ fontSize: 18, color: INK40 }}>›</span>
          </button>
        </div>
      </div>

      {/*
        * Injuries and trips live here rather than behind Edit profile.
        *
        * Both are things an athlete changes when something happens — a niggle, a
        * holiday booked — not when they are editing their name and weight. Two
        * taps deep is where they were, and a trip nobody records is a trip the
        * plan trains straight through.
        */}
      <Injuries notes={p?.injury_notes ?? ""} />

      <Away />

      <Zones />

      <Notifications prefs={p?.notify ?? {}} />

      {/* Both preferences are local to the device, not the account: which
          units you read and whether the screen is dark are properties of the
          phone in your hand, and syncing them across devices would be wrong. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span style={caps}>Preferences</span>
        <Group label="Units" options={["Metric", "Imperial"]} value={units}
          onPick={(v) => { setUnits(v); localStorage.setItem("split-units", v); }} />
        <Group label="Theme" options={["Light", "Dark"]}
          value={theme === "dark" ? "Dark" : "Light"}
          onPick={(v) => flip(v === "Dark" ? "dark" : "light")} />
      </div>

      {(p?.coachees ?? []).length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <span style={caps}>Coaching</span>
          {(p?.coachees ?? []).map((c) => (
            <button key={`notes-${c.id}`} onClick={() => openNotes(c.id)} style={{
              ...planRow, display: "flex", flexDirection: "column",
              alignItems: "flex-start", gap: 3,
            }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                Messages for {c.display_name}
              </span>
              <span style={{ fontSize: 11, fontWeight: 400, color: INK55 }}>
                Write what she reads in her week
              </span>
            </button>
          ))}
          {(p?.coachees ?? []).map((c) => (
            <button key={c.id} onClick={() => openCoachee(c.id)} style={{
              width: "100%", textAlign: "left", background: PAPER, border: `1px solid ${LINE}`,
              borderRadius: "var(--r-card)", padding: "15px 16px", color: "var(--ink)",
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <span style={{ width: 32, height: 32, flex: "none", borderRadius: "50%",
                background: NAVY, color: "var(--lime)", fontSize: 12, fontWeight: 800,
                display: "flex", alignItems: "center", justifyContent: "center" }}>
                {c.display_name.slice(0, 1).toUpperCase()}
              </span>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{c.display_name}</span>
                <span style={{ fontSize: 11, color: INK55 }}>
                  Open their plan and write their week
                </span>
              </span>
              <span style={{ fontSize: 13, color: INK40 }}>›</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <span style={caps}>Training plan</span>
        <button onClick={openBuild} style={planRow}>
          {p?.has_plan ? "Rebuild my plan" : "Build a new plan"}
        </button>
        <button onClick={openBench} style={{
          ...planRow, display: "flex", flexDirection: "column",
          alignItems: "flex-start", gap: 3,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Benchmark results</span>
          <span style={{ fontSize: 11, fontWeight: 400, color: INK55 }}>
            What the test found, and what it changed
          </span>
        </button>
        <button onClick={openPreflight} style={{
          ...planRow, display: "flex", flexDirection: "column",
          alignItems: "flex-start", gap: 3,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Benchmark instructions</span>
          <span style={{ fontSize: 11, fontWeight: 400, color: INK55 }}>
            The lap protocol, and what to do if you miss one
          </span>
        </button>
        {/* Two taps, because it deletes a block. The confirm is the same button
            saying what it is about to do rather than a dialog — there is nothing
            here a dialog would add except a place to mis-tap. */}
        {p?.has_plan && (
          <button onClick={async () => {
            if (!cleared) { setCleared(true); return; }
            await fetch("/api/plan", { method: "DELETE" });
            setCleared(false);
            setP(await (await fetch("/api/profile")).json());
          }} style={{
            ...planRow, color: cleared ? "#C07A3E" : INK55,
            borderColor: cleared ? "#C07A3E" : LINE,
          }}>
            {cleared ? "Tap again to delete every planned session" : "Clear current plan"}
          </button>
        )}
      </div>

      <a href="/api/auth/logout" style={{
        width: "100%", background: "none", border: `1px solid ${LINE}`,
        borderRadius: "var(--r-pill)", padding: 15, fontSize: 12, fontWeight: 800,
        letterSpacing: ".06em", textTransform: "uppercase", color: INK55,
        textAlign: "center", display: "block",
      }}>Sign out</a>

      {/* Which plan this screen is looking at. Invisible until something goes
          wrong, and then the first thing worth knowing. */}
      {p?.plan_source && (
        <div style={{ fontSize: 10, color: INK40, textAlign: "center" }}>
          {p.plan_source}
        </div>
      )}
    </div>
  );
}

/** A segmented preference. Two or three options, one of them always on. */
function Group({
  label, options, value, onPick,
}: {
  label: string; options: string[]; value: string; onPick: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-70)" }}>{label}</span>
      <div style={{ display: "flex", gap: 3, background: OFF,
        borderRadius: "var(--r-pill)", padding: 3 }}>
        {options.map((o) => (
          <button key={o} onClick={() => onPick(o)} style={{
            flex: 1, borderRadius: "var(--r-pill)", padding: "9px 12px", fontSize: 11,
            fontWeight: 700, background: value === o ? NAVY : "transparent",
            color: value === o ? "#fff" : INK55,
          }}>{o}</button>
        ))}
      </div>
    </div>
  );
}

const caps: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase",
  color: INK55,
};

const planRow: React.CSSProperties = {
  width: "100%", textAlign: "left", background: PAPER, border: `1px solid ${LINE}`,
  borderRadius: "var(--r-card)", padding: "15px 16px", color: "var(--ink)",
  fontSize: 13, fontWeight: 600,
};

type Constraint = TrainingConstraint;
type Reading = {
  constraints: Constraint[];
  unactionable: { quote: string; why: string }[];
};

/**
 * Anything to train around, and what the plan does about it.
 *
 * This box used to end with an admission: "Nothing parses it automatically, so an injury
 * that should stop a session still needs saying out loud." That was honest and it was also
 * the app asking a question it then ignored — somebody who writes "left knee hates deep
 * lunging" has said something specific, and the gym session went on prescribing split
 * squats every week.
 *
 * It is now read, and then shown back before anything happens. The confirm step is not
 * ceremony: this is health information, and a plan that quietly reshaped itself from a
 * sentence in a text box would be making a call about somebody's body that it has no
 * standing to make. They see their own words, see what follows, and tick what is right.
 *
 * What the plan can do is deliberately small — take a movement out and put a substitute in.
 * Nothing here changes a volume, a pace or a week, and anything the vocabulary cannot
 * express is said out loud rather than quietly producing no effect.
 */
function Injuries({ notes }: { notes: string }) {
  const [text, setText] = useState(notes);
  const [saved, setSaved] = useState<string | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [confirmed, setConfirmed] = useState<Constraint[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<"read" | "apply" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    fetch("/api/constraints").then((r) => r.json()).then((j) => {
      setConfirmed(j.confirmed ?? []);
      setStale(Boolean(j.stale));
    }).catch(() => {});
  }, []);

  async function save(v: string) {
    if (v.trim() === notes.trim()) return;
    const r = await fetch("/api/profile", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ injury_notes: v }),
    });
    setSaved(r.ok ? "Saved." : "That did not save.");
  }

  async function read() {
    setBusy("read"); setDone(null);
    /* Read what is in the box, not what was last saved — they may still be typing it. */
    const r = await fetch("/api/constraints", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) { setDone(j.error ?? "That did not go through."); return; }
    setReading(j.reading ?? null);
    /* Nothing pre-ticked. Agreeing to something has to be an action they took. */
    setPicked(new Set());
  }

  async function apply() {
    if (!reading) return;
    setBusy("apply");
    const r = await fetch("/api/constraints", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ constraints: reading.constraints.filter((_, i) => picked.has(i)) }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) { setDone(j.error ?? "That did not go through."); return; }
    setConfirmed(j.confirmed ?? []); setReading(null); setStale(false);
    setDone(j.note ?? null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={caps}>Anything to train around</span>
      <textarea rows={4} value={text}
        onChange={(e) => { setText(e.target.value); setSaved(null); }}
        onBlur={(e) => save(e.target.value)}
        placeholder="Old injuries, niggles, anything you are managing…"
        style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 12,
          padding: "13px 14px", fontSize: 14, lineHeight: 1.5, resize: "vertical",
          color: "var(--ink)" }} />

      {/* What is already being worked around, so it is a fact on the screen and not a memory. */}
      {confirmed.length > 0 && !reading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5,
          border: `1px solid ${LINE}`, borderRadius: 12, padding: "11px 13px" }}>
          <span style={{ fontSize: 11.5, fontWeight: 700 }}>
            Your gym sessions currently leave out
          </span>
          {confirmed.map((c) => (
            <span key={c.quote + (c.avoid_pattern ?? c.avoid_movement ?? "")}
              style={{ fontSize: 12, color: INK55, lineHeight: 1.5 }}>
              · {saysWhat(c)} — {c.because}
            </span>
          ))}
          {stale && (
            <span style={{ fontSize: 11.5, color: "#C07A3E", lineHeight: 1.5 }}>
              You have changed this note since. Read it again so the plan matches what you
              wrote.
            </span>
          )}
        </div>
      )}

      {/* The proposal: their words, what follows, and nothing ticked until they tick it. */}
      {reading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 9,
          border: `1px solid ${TEAL}`, borderRadius: 12, padding: "12px 13px" }}>
          {reading.constraints.length === 0 && reading.unactionable.length === 0 && (
            <span style={{ fontSize: 12.5, color: INK55, lineHeight: 1.5 }}>
              Nothing in there that changes a session. Your plan stays as it is.
            </span>
          )}
          {reading.constraints.length > 0 && (
            <span style={{ fontSize: 11.5, fontWeight: 700 }}>
              Tick what is right. Nothing changes until you do.
            </span>
          )}
          {reading.constraints.map((c, i) => (
            <button key={i} onClick={() => setPicked((p) => {
              const n = new Set(p);
              if (n.has(i)) n.delete(i); else n.add(i);
              return n;
            })} style={{ display: "flex", gap: 10, alignItems: "flex-start",
              textAlign: "left", padding: "8px 0", color: "var(--ink)" }}>
              <span aria-hidden="true" style={{ width: 18, height: 18, flex: "none",
                marginTop: 2, borderRadius: 5, border: `1.5px solid ${picked.has(i) ? TEAL : LINE}`,
                background: picked.has(i) ? TEAL : "transparent", color: "#fff",
                fontSize: 12, display: "flex", alignItems: "center",
                justifyContent: "center" }}>{picked.has(i) ? "✓" : ""}</span>
              <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  Leave out {saysWhat(c)}
                </span>
                {/* Their words, quoted, so this reads as us having listened rather than decided. */}
                <span style={{ fontSize: 11.5, color: INK55, lineHeight: 1.5 }}>
                  You wrote “{c.quote}” — {c.because}.
                </span>
              </span>
            </button>
          ))}

          {/* Said plainly, because a silent no-op reads like the plan took it in. */}
          {reading.unactionable.map((u) => (
            <span key={u.quote} style={{ fontSize: 11.5, color: "#C07A3E",
              lineHeight: 1.5, borderTop: `1px solid ${LINE}`, paddingTop: 8 }}>
              {u.why}
            </span>
          ))}

          {reading.constraints.length > 0 && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setReading(null)} style={{ padding: "10px 14px",
                fontSize: 12.5, fontWeight: 700, color: INK55 }}>
                Not now
              </button>
              <button onClick={apply} disabled={busy === "apply"}
                style={{ flex: 1, padding: "10px 0", borderRadius: 999, background: NAVY,
                  color: "#fff", fontSize: 12.5, fontWeight: 700,
                  opacity: busy === "apply" ? .6 : 1 }}>
                {busy === "apply" ? "Rebuilding your sessions…"
                  : picked.size === 0 ? "Work around nothing" : `Work around ${picked.size}`}
              </button>
            </div>
          )}
        </div>
      )}

      {!reading && (
        <button onClick={read} disabled={busy === "read" || text.trim().length < 3}
          style={{ alignSelf: "flex-start", padding: "9px 14px", borderRadius: 999,
            border: `1px solid ${LINE}`, fontSize: 12, fontWeight: 700, color: NAVY,
            opacity: busy === "read" || text.trim().length < 3 ? .5 : 1 }}>
          {busy === "read" ? "Reading…" : confirmed.length ? "Read this again" : "See what the plan can work around"}
        </button>
      )}

      <span style={{ fontSize: 10, color: INK40, lineHeight: 1.5 }}>
        {done ?? saved ?? "The plan can take a movement out and put a substitute in. It cannot judge an injury — if something hurts in a way that should stop a session, stop the session and speak to someone qualified."}
      </span>
    </div>
  );
}

/**
 * Heart-rate zones, editable two ways.
 *
 * The maximum moves and all five recalculate; a single ceiling moves and stays
 * between its neighbours. Both go to /api/zones, which owns the invariant — no
 * crossing, no gaps, labels agreeing with their numbers — so a table can never
 * be written from here that the rest of the app cannot read.
 */
function Zones() {
  const [z, setZ] = useState<{
    hr_max: number | null; zones: Zone[]; edited: boolean;
  } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetch("/api/zones").then(async (r) => r.ok && setZ(await r.json())); }, []);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    const r = await fetch("/api/zones", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (r.ok) setZ(await r.json());
  }

  if (!z) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={caps}>Heart rate zones</span>

      <div style={{ background: PAPER, border: `1px solid ${LINE}`,
        borderRadius: "var(--r-card)", padding: "13px 16px",
        display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline",
          justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-70)" }}>
            Max heart rate
          </span>
          <span style={{ fontFamily: "var(--display)", fontSize: 19, fontWeight: 700 }}>
            {z.hr_max ?? 189}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {([["−5", -5], ["−1", -1], ["+1", 1], ["+5", 5]] as const).map(([l, d]) => (
            <button key={l} disabled={busy}
              onClick={() => send({ action: "max", hr_max: (z.hr_max ?? 189) + d })}
              style={{ flex: 1, padding: "10px 0", borderRadius: "var(--r-pill)",
                border: `1px solid ${LINE}`, background: OFF, fontSize: 12,
                fontWeight: 700, color: "var(--ink)" }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ background: PAPER, border: `1px solid ${LINE}`,
        borderRadius: "var(--r-card)", padding: "6px 16px" }}>
        {z.zones.map((row, i) => (
          <div key={row.tag} style={{ display: "flex", flexDirection: "column", gap: 9,
            padding: "11px 0", borderBottom: "1px solid var(--line-2)" }}>
            <button onClick={() => setOpen(open === i ? null : i)} disabled={i === 4}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 10, width: "100%", background: "none", padding: 0, color: "var(--ink)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: row.colour }} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>{row.tag}</span>
              </span>
              <span style={{ fontSize: 13, color: "var(--ink-70)" }}>{row.label}</span>
            </button>
            {open === i && i < 4 && (
              <div style={{ display: "flex", gap: 5 }}>
                {([["−5", -5], ["−1", -1], ["+1", 1], ["+5", 5]] as const).map(([l, d]) => (
                  <button key={l} disabled={busy}
                    onClick={() => send({ action: "nudge", index: i, delta: d })}
                    style={{ flex: 1, padding: "8px 0", borderRadius: "var(--r-pill)",
                      border: `1px solid ${LINE}`, background: OFF, fontSize: 11,
                      fontWeight: 700, color: "var(--ink)" }}>{l}</button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 10, color: INK40, lineHeight: 1.5 }}>
          {z.edited
            ? "Edited by hand. Every HR chart in the app reads this table."
            : `Derived from ${z.hr_max ?? 189} bpm as percentages, so the table is yours rather than the other athlete's.`}
        </span>
        {z.edited && (
          <button onClick={() => send({ action: "reset" })} disabled={busy}
            style={{ flex: "none", background: "none", border: 0, fontSize: 10,
              fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase",
              color: TEAL }}>Reset</button>
        )}
      </div>
    </div>
  );
}
