"use client";
import { useEffect, useState } from "react";
import { fmt } from "@/lib/dates";
import { hms } from "@/lib/analysis";

const TEAL = "#0A8FB0", LIME = "#C6FF5B", NAVY = "#12314D";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const OFF = "var(--off)", PAPER = "var(--paper)", LINE = "var(--line)";

/** The tier faces from the design, as radial gradients. */
const TIERS = {
  Bronze: { face: "radial-gradient(circle at 32% 28%, #E8B98C 0%, #C07A3E 45%, #8A4E22 100%)", ring: "#8A4E22", ink: "#3D2110" },
  Silver: { face: "radial-gradient(circle at 32% 28%, #FFFFFF 0%, #C9D4DD 45%, #8B9BA8 100%)", ring: "#8B9BA8", ink: "#33414D" },
  Gold: { face: "radial-gradient(circle at 32% 28%, #FFF0B8 0%, #E8C051 45%, #B08514 100%)", ring: "#B08514", ink: "#4A3705" },
  Platinum: { face: "radial-gradient(circle at 32% 28%, #FFFFFF 0%, #D9F2F8 40%, #8FC4D4 100%)", ring: "#0A8FB0", ink: "#0E3A47" },
} as const;
type TierName = keyof typeof TIERS;

type Medal = {
  cat: string; unit: string; value: number; icon: string; steps: number[];
  tier: number; tierName: TierName | null; next?: number; pct: number;
  earned_on: string | null; tally: (string | null)[];
};
type RecRow = { seconds: number; id: string; name: string; local_date: string };
type Data = {
  totals: { km: number; sessions: number; hours: number; races: number; since: string | null };
  medals: Medal[];
  records: { dist: string; note: string; rows: RecRow[] }[];
};

const num = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString() : n >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(1);

export default function Awards({
  meId, openActivity, openRecord,
}: { meId: string; openActivity: (id: string) => void; openRecord: (dist: string) => void }) {
  const [d, setD] = useState<Data | null>(null);

  useEffect(() => {
    fetch("/api/awards").then(async (r) => {
      if (r.status === 401) { location.href = "/login"; return; }
      if (r.ok) setD(await r.json());
    });
  }, [meId]);

  if (!d) return <div style={{ padding: 18 }}><p className="empty">Loading…</p></div>;

  // how many of each tier are held, for the tally strip
  const tally = (["Bronze", "Silver", "Gold", "Platinum"] as TierName[]).map((name) => ({
    name, n: d.medals.filter((m) => m.tierName === name).length,
  }));
  const held = d.medals.filter((m) => m.tier >= 0).length;

  // the one closest to its next tier, which is the useful thing to be told
  const next = d.medals
    .filter((m) => m.next !== undefined)
    .sort((a, b) => b.pct - a.pct)[0];

  return (
    <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em",
          textTransform: "uppercase", color: "var(--teal)" }}>Accomplishments</div>
        <div style={{ fontFamily: "var(--display)", fontSize: 24, fontWeight: 700,
          lineHeight: 1.1, letterSpacing: "-.02em", marginTop: 5 }}>
          Everything you have banked.
        </div>
        {d.totals.since && (
          <div style={{ fontSize: 12, color: INK55, marginTop: 6 }}>
            Since {fmt(d.totals.since, { month: "long", year: "numeric" })}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[
          ["Distance", num(d.totals.km), "km"],
          ["Sessions", String(d.totals.sessions), "logged"],
          ["Moving", num(d.totals.hours), "hours"],
          ["Hyrox", String(d.totals.races), "races imported"],
        ].map(([l, v, u]) => (
          <div key={l} style={{ background: PAPER, border: `1px solid ${LINE}`,
            borderRadius: "var(--r-card)", padding: 14 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em",
              textTransform: "uppercase", color: INK55 }}>{l}</div>
            <div style={{ fontFamily: "var(--display)", fontSize: 26, fontWeight: 700,
              lineHeight: 1.05, marginTop: 5 }}>{v}</div>
            <div style={{ fontSize: 11, color: INK40, marginTop: 2 }}>{u}</div>
          </div>
        ))}
      </div>

      {/* ------------------------------------------------------- the medal case */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
          <span style={caps}>Medal case</span>
          <span style={{ fontSize: 11, color: INK40 }}>{held} of {d.medals.length} · current tier</span>
        </div>

        <div style={{ display: "flex", gap: 14, background: PAPER, border: `1px solid ${LINE}`,
          borderRadius: "var(--r-card)", padding: "12px 14px" }}>
          {tally.map((t) => (
            <div key={t.name} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 14, height: 14, borderRadius: "50%",
                background: TIERS[t.name].face,
                boxShadow: `0 0 0 1.5px ${TIERS[t.name].ring}` }} />
              <span style={{ fontSize: 12, fontWeight: 700 }}>{t.n}</span>
              <span style={{ fontSize: 10, color: INK40 }}>{t.name}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {d.medals.map((m) => {
            const t = m.tierName ? TIERS[m.tierName] : null;
            return (
              <div key={m.cat} style={{ background: PAPER, border: `1px solid ${LINE}`,
                borderRadius: "var(--r-card)", padding: 13, display: "flex",
                flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                <span style={{ width: 46, height: 46, flex: "none", borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
                  background: t ? t.face : OFF, color: t ? t.ink : INK40,
                  boxShadow: t ? `0 0 0 2px ${t.ring}` : "none" }}>{m.icon}</span>
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".12em",
                  textTransform: "uppercase", color: t ? t.ink : INK40 }}>
                  {m.tierName ?? "Not yet"}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>{m.cat}</span>
                <span style={{ fontFamily: "var(--display)", fontSize: 15, fontWeight: 700 }}>
                  {num(m.value)} <span style={{ fontSize: 10, color: INK40 }}>{m.unit}</span>
                </span>
                <div style={{ width: "100%", height: 4, background: OFF, borderRadius: 2,
                  overflow: "hidden" }}>
                  <div style={{ height: 4, width: `${m.pct}%`, background: TEAL }} />
                </div>
                <span style={{ fontSize: 10, color: INK40 }}>
                  {m.next === undefined ? "Top tier"
                    : `Next at ${num(m.next)} ${m.unit}`}
                </span>
                {m.earned_on && (
                  <span style={{ fontSize: 10, color: INK40 }}>
                    Earned {fmt(m.earned_on, { month: "short", year: "numeric" })}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {next && (
          <div style={{ background: NAVY, borderRadius: "var(--r-card)", padding: 16,
            display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em",
              textTransform: "uppercase", color: "rgba(255,255,255,.55)" }}>Closest medal</span>
            <div style={{ display: "flex", alignItems: "baseline",
              justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontFamily: "var(--display)", fontSize: 19, fontWeight: 700,
                color: "#fff" }}>
                {next.cat} · {TIERS[(["Bronze","Silver","Gold","Platinum"] as TierName[])[next.tier + 1]] ? (["Bronze","Silver","Gold","Platinum"] as TierName[])[next.tier + 1] : "next"}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: LIME }}>
                {Math.round(next.pct)}%
              </span>
            </div>
            <div style={{ height: 8, background: "rgba(255,255,255,.15)", borderRadius: 4,
              overflow: "hidden" }}>
              <div style={{ height: 8, width: `${next.pct}%`, background: LIME }} />
            </div>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,.75)" }}>
              {(() => {
                const left = Math.max(0, (next.next ?? 0) - next.value);
                // "1 sessions to go" is the kind of thing that makes a screen
                // look unfinished, and the unit is a plural by default
                const unit = left === 1 && next.unit.endsWith("s")
                  ? next.unit.slice(0, -1) : next.unit;
                return `${num(left)} ${unit} to go.`;
              })()}
            </span>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------ personal records */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={caps}>Personal records</span>
        {d.records.length === 0 && <p className="empty">No kilometre splits imported yet.</p>}
        <div style={{ background: PAPER, border: `1px solid ${LINE}`,
          borderRadius: "var(--r-card)", padding: "14px 16px",
          display: "flex", flexDirection: "column", gap: 14 }}>
          {d.records.map((rec) => {
            const best = rec.rows[0];
            const worst = rec.rows[rec.rows.length - 1];
            const span = Math.max(1, worst.seconds - best.seconds);
            return (
              <button key={rec.dist} onClick={() => openRecord(rec.dist)}
                style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%",
                  textAlign: "left", padding: 0, color: "var(--ink)" }}>
                <div style={{ display: "flex", alignItems: "baseline",
                  justifyContent: "space-between", gap: 10, width: "100%" }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{rec.dist}</span>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontFamily: "var(--display)", fontSize: 17, fontWeight: 700 }}>
                      {hms(best.seconds)}
                    </span>
                    <span style={{ fontSize: 13, color: TEAL }}>›</span>
                  </span>
                </div>
                <div style={{ height: 6, width: "100%", background: OFF, borderRadius: 3,
                  overflow: "hidden" }}>
                  <div style={{ height: 6, width: `${100 - ((best.seconds - best.seconds) / span) * 100}%`,
                    background: TEAL }} />
                </div>
                <span style={{ fontSize: 10, color: INK40 }}>
                  {fmt(best.local_date, { day: "numeric", month: "short", year: "numeric" })} · {best.name}
                </span>
              </button>
            );
          })}
        </div>
        <p className="empty">
          Records come from stored kilometre splits, so they cover activities whose detail has
          been imported. They are runs of whole-kilometre splits rather than rolling-window
          times — a true 5K PR is a second or two quicker.
        </p>
      </div>
    </div>
  );
}

const caps: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase",
  color: INK55,
};
