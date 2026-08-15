"use client";

/**
 * Before a plan exists.
 *
 * The week and plan tabs show this rather than an empty calendar, because an
 * empty calendar looks like a loading failure. A plan-shaped outline, the
 * athlete's name, and one primary action — with a second route for a plan
 * written elsewhere.
 */
export default function Empty({
  name, onBuild,
}: { name: string; onBuild: () => void }) {
  const first = name.split(" ")[0];
  return (
    <div style={{ padding: "44px 22px 26px", display: "flex", flexDirection: "column",
      alignItems: "center", gap: 18, textAlign: "center" }}>
      <div style={{ width: 96, height: 116, border: "2px solid var(--line)",
        borderRadius: "14px 14px 48px 48px", background: "var(--paper)",
        display: "flex", flexDirection: "column", gap: 9, padding: "20px 16px 0",
        alignItems: "flex-start" }}>
        <span style={{ width: "100%", height: 6, borderRadius: 3, background: "var(--off)" }} />
        <span style={{ width: "70%", height: 6, borderRadius: 3, background: "var(--off)" }} />
        <span style={{ width: "85%", height: 6, borderRadius: 3, background: "var(--off)" }} />
        <span style={{ width: "55%", height: 6, borderRadius: 3, background: "var(--teal-tint2)" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <span style={{ fontFamily: "var(--display)", fontSize: 26, fontWeight: 700,
          lineHeight: 1.1, letterSpacing: "-.02em" }}>
          Hey {first} — no plan yet
        </span>
        <span style={{ fontSize: 14, lineHeight: 1.6, color: "var(--ink-55)" }}>
          Answer a dozen questions about your race, your week and where your running actually is.
          The block gets built from that, and the first week is a baseline test.
        </span>
      </div>
      <div style={{ width: "100%", display: "flex", flexDirection: "column",
        gap: 9, marginTop: 4 }}>
        <button onClick={onBuild} style={{ width: "100%", background: "var(--lime)", border: 0,
          borderRadius: "var(--r-pill)", color: "var(--on-lime)", padding: 17, fontSize: 12,
          fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase" }}>
          Build my plan
        </button>
      </div>
    </div>
  );
}
