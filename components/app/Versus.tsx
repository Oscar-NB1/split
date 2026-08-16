"use client";
import { useEffect, useState } from "react";
import { fmt } from "@/lib/dates";

const TEAL = "#0A8FB0", LIME = "#C6FF5B", NAVY = "#12314D";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)", INK70 = "var(--ink-70)";
const OFF = "var(--off)", PAPER = "var(--paper)", LINE = "var(--line)", CREAM = "var(--cream)";

type Share = {
  adherence_pct: number | null; volume_pct: number | null; station_pct: number | null;
  sessions_done: number; sessions_planned: number;
};
type Row = {
  label: string; mine: number | null; theirs: number | null;
  mineAbs: string; theirAbs: string; i_win: boolean; they_win: boolean;
};
type Week = { week_start: string; winner: string; mine: Share; theirs: Share };
type Rivalry = {
  id: string;
  rival: { id: string; display_name: string; avatar_url: string | null };
  one_sided: boolean;
  weeks_won: { mine: number; theirs: number };
  consistency: { mine: number; theirs: number };
  rows: Row[];
  current: Week;
  history: Week[];
  scoring_note: string;
};

const NUDGES = [
  "Two sessions up. Your move.",
  "Tempo Saturday. Loser buys coffee.",
  "I saw that skipped shake-out.",
  "Nice week. Still behind though.",
];

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/**
 * The head-to-head, scored on each athlete's own plan.
 *
 * Every row is a percentage of what that person was prescribed, with the raw
 * number underneath it in smaller type. That ordering is the whole design: a
 * twelve-kilometre week finished beats a thirty-four-kilometre week half-done,
 * and putting the absolute first would say the opposite.
 */
export default function Versus({ onConnect }: { onConnect?: () => void }) {
  const [d, setD] = useState<{
    empty: boolean;
    /** the signed-in athlete, so the scoreboard can show their own face */
    me?: { id: string; display_name: string; avatar_url: string | null };
    rivalries: Rivalry[];
  } | null>(null);
  const [at, setAt] = useState(0);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/versus").then(async (r) => {
      if (r.status === 401) { location.href = "/"; return; }
      if (r.ok) setD(await r.json());
    });
  }, []);

  if (!d) return <div style={{ padding: 18 }}><p className="empty">Loading…</p></div>;

  if (d.empty || d.rivalries.length === 0) {
    return (
      <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700,
          letterSpacing: "-.02em" }}>No head-to-heads yet</span>
        <span style={{ fontSize: 13, lineHeight: 1.6, color: INK55 }}>
          Training is more fun with someone chasing you. Connect with a training
          partner and compare how much of your plan you each finish.
        </span>
        {onConnect && (
          <button onClick={onConnect} style={{
            width: "100%", background: "var(--lime)", border: 0,
            borderRadius: "var(--r-pill)", padding: 16, fontSize: 12,
            fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
            color: "var(--on-lime)", marginTop: 4,
          }}>Connect someone</button>
        )}
        <span style={{ fontSize: 11, lineHeight: 1.55, color: INK40 }}>
          You send them a link or a code. Nothing is shared until they accept, and
          what is shared is the share of your own plan you finished — never the plan
          itself.
        </span>
      </div>
    );
  }

  const r = d.rivalries[Math.min(at, d.rivalries.length - 1)];
  const name = r.rival.display_name;
  const lead = r.weeks_won.mine === r.weeks_won.theirs ? "All square"
    : r.weeks_won.mine > r.weeks_won.theirs ? "You lead" : `${name} leads`;

  return (
    <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ ...caps, color: TEAL }}>Head to head</div>
        <div style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700,
          letterSpacing: "-.02em" }}>You vs {name}</div>
      </div>

      {/* Who you are up against, and the way to add another. The row shows even
          with one rival, because the plus is the only route to a second. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, display: "flex", gap: 3, background: OFF,
          borderRadius: "var(--r-pill)", padding: 3 }}>
          {d.rivalries.map((x, i) => (
            <button key={x.id} onClick={() => setAt(i)} style={{
              flex: 1, borderRadius: "var(--r-pill)", padding: "9px 12px", fontSize: 11,
              fontWeight: 700, background: i === at ? NAVY : "transparent",
              color: i === at ? "#fff" : INK55,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            }}>
              {/* Their face on the tab as well: with more than one rivalry the name
                  is the smallest thing on the screen to aim a thumb at. */}
              <span style={{ width: 18, height: 18, borderRadius: "50%", flex: "none",
                overflow: "hidden", background: i === at ? "rgba(255,255,255,.2)" : OFF,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9, fontWeight: 800 }}>
                {x.rival.avatar_url
                  ? <img src={x.rival.avatar_url} alt="" width={18} height={18}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : x.rival.display_name.slice(0, 1).toUpperCase()}
              </span>
              {x.rival.display_name}
            </button>
          ))}
        </div>
        {onConnect && (
          <button onClick={onConnect} aria-label="Connect another partner" style={{
            flex: "none", width: 32, height: 32, borderRadius: "50%",
            border: `1px solid ${LINE}`, background: "var(--paper)", fontSize: 15,
            color: INK55,
          }}>+</button>
        )}
      </div>

      {/* The rivalry does not start until both have a plan. Saying so beats
          showing a scoreboard of dashes. */}
      {r.one_sided && (
        <div style={{ background: CREAM, border: `1px solid ${LINE}`,
          borderRadius: "var(--r-card)", padding: 16,
          display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Not started yet</span>
          <span style={{ fontSize: 12, lineHeight: 1.55, color: INK70 }}>
            One of you has no plan running, so there is nothing to be a share of.
            Weeks stay undecided until you both have one.
          </span>
        </div>
      )}

      <div style={{ background: NAVY, borderRadius: "var(--r-card)", padding: "18px 16px",
        display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Tally initial={(d.me?.display_name ?? "You").slice(0, 1).toUpperCase()}
            avatar={d.me?.avatar_url} weeks={r.weeks_won.mine} label="You" />
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".1em",
            color: "rgba(255,255,255,.5)", textAlign: "center", lineHeight: 1.5 }}>
            WEEKS<br />WON
          </span>
          <Tally initial={name.slice(0, 1).toUpperCase()} avatar={r.rival.avatar_url}
            weeks={r.weeks_won.theirs} label={name} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{lead}</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,.65)" }}>
            {r.consistency.mine} of your last 11 weeks at 80% or better · {name}{" "}
            {r.consistency.theirs}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,.5)" }}>
            Last 11 weeks. A dash is a week nobody won.
          </span>
          <div style={{ display: "flex", gap: 3 }}>
            {r.history.map((h) => (
              <span key={h.week_start} title={h.week_start} style={{
                flex: 1, textAlign: "center", fontSize: 9, fontWeight: 800,
                borderRadius: 4, padding: "4px 0",
                background: h.winner === "requester" ? LIME
                  : h.winner === "addressee" ? "rgba(255,255,255,.28)"
                  : "rgba(255,255,255,.10)",
                color: h.winner === "requester" ? NAVY : "#fff",
              }}>
                {h.winner === "requester" ? "W" : h.winner === "addressee" ? "L"
                  : h.winner === "tie" ? "=" : "·"}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={caps}>
          This week · {fmt(r.current.week_start, { day: "numeric", month: "short" })}
        </span>
        {r.rows.map((row) => (
          <div key={row.label} style={{ background: PAPER, border: `1px solid ${LINE}`,
            borderRadius: "var(--r-card)", padding: "13px 14px",
            display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 5 }}>
                {row.i_win && <Tick />}
                <span style={{ fontSize: 17, fontWeight: 700,
                  color: row.i_win ? TEAL : "var(--ink)" }}>{pct(row.mine)}</span>
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em",
                textTransform: "uppercase", color: INK55 }}>{row.label}</span>
              <span style={{ flex: 1, display: "flex", alignItems: "center",
                justifyContent: "flex-end", gap: 5 }}>
                <span style={{ fontSize: 17, fontWeight: 700,
                  color: row.they_win ? TEAL : "var(--ink)" }}>{pct(row.theirs)}</span>
                {row.they_win && <Tick />}
              </span>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <Bar value={row.mine} mine />
              <Bar value={row.theirs} />
            </div>
            {/* The raw numbers, deliberately smaller and deliberately second. */}
            <div style={{ display: "flex", justifyContent: "space-between",
              fontSize: 10, color: INK40 }}>
              <span>{row.mineAbs}</span>
              <span>{row.theirAbs}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={caps}>{sent ? "Sent" : "Say something"}</span>
        {NUDGES.map((n) => (
          <button key={n} onClick={() => setSent(n)} style={{
            width: "100%", textAlign: "left", background: sent === n ? CREAM : PAPER,
            border: `1px solid ${sent === n ? TEAL : LINE}`, borderRadius: "var(--r-pill)",
            padding: "11px 14px", fontSize: 12, color: "var(--ink)",
          }}>{n}</button>
        ))}
      </div>

      <span style={{ fontSize: 11, lineHeight: 1.55, color: INK55 }}>{r.scoring_note}</span>
    </div>
  );
}

/**
 * One side of the scoreboard.
 *
 * The picture where there is one, the initial where there is not — a face is how
 * anyone tells two columns of numbers apart at a glance, and both athletes already
 * have one on file from their profile or their sign-in.
 */
function Tally({ initial, avatar, weeks, label }: {
  initial: string; avatar?: string | null; weeks: number; label: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <span style={{ width: 32, height: 32, borderRadius: "50%", overflow: "hidden",
        background: "rgba(255,255,255,.14)", color: "#fff", fontSize: 12, fontWeight: 800,
        display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
        {avatar
          ? <img src={avatar} alt="" width={32} height={32}
              style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : initial}
      </span>
      <span style={{ fontFamily: "var(--display)", fontSize: 30, fontWeight: 700,
        color: "#fff", lineHeight: 1 }}>{weeks}</span>
      <span style={{ fontSize: 10, color: "rgba(255,255,255,.6)" }}>{label}</span>
    </div>
  );
}

/** Capped at full: over-delivery is not a longer bar, it is still 100% done. */
function Bar({ value, mine = false }: { value: number | null; mine?: boolean }) {
  return (
    <div style={{ flex: 1, height: 6, borderRadius: 3, background: OFF, overflow: "hidden" }}>
      <div style={{ height: "100%", borderRadius: 3,
        width: `${Math.min(100, Math.round((value ?? 0) * 100))}%`,
        background: mine ? TEAL : "var(--ink-40)" }} />
    </div>
  );
}

const Tick = () => (
  <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke={TEAL}
    strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 13l5 5L20 7" />
  </svg>
);

const caps: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase",
  color: INK55,
};
