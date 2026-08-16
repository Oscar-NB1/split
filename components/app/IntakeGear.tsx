"use client";

const TEAL = "#0A8FB0", TEAL_T = "var(--teal-tint)";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const LINE = "var(--line)", PAPER = "var(--paper)";

export const ACCESS: [string, string][] = [
  ["Open floor, any time", "Sleds and rig free when you arrive"],
  ["Busy — expect to queue", "Stations shared, some waiting"],
  ["Classes only", "Fixed slots, coach decides the session"],
];

export const RUN_LINK: [string, string][] = [
  ["Yes, running is right there", "Treadmill or a loop beside the floor"],
  ["Yes, with a walk between", "A few minutes each transition"],
  ["No, separate places", "Running and stations on different days"],
];

/**
 * Kit, access, and whether a run can follow a station.
 *
 * Three questions on one screen because they are one question: what can this
 * athlete actually train. Kit alone is not access — a race-weight sled you have to
 * queue for is not a full setup — and neither answers whether compromised running
 * is possible, which is the session that decides a Hyrox.
 *
 * All three feed deriveVariant, and until now only the first was being asked. The
 * other two were defaulting to "open floor" and "short walk" for everyone, which
 * quietly gave every athlete the most permissive variant the app has.
 *
 * The week's load summary is deliberately not here. It belongs on the steps that
 * change it — days, sessions, commitments — and nothing this step asks about
 * moves the number.
 */
export default function IntakeGear({
  kit, options, access, runLink, onKit, onAccess, onRunLink,
}: {
  kit: string[];
  options: string[];
  access: string | null;
  runLink: string | null;
  onKit: (k: string[]) => void;
  onAccess: (v: string) => void;
  onRunLink: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={caps}>Kit you can reach</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {options.map((o) => {
            const on = kit.includes(o);
            return (
              <button key={o}
                onClick={() => onKit(on ? kit.filter((x) => x !== o) : [...kit, o])}
                style={{
                  padding: "9px 13px", borderRadius: "var(--r-pill)", fontSize: 11,
                  fontWeight: 600, border: `1px solid ${on ? TEAL : LINE}`,
                  background: on ? TEAL_T : PAPER, color: on ? TEAL : INK55,
                }}>{o}</button>
            );
          })}
        </div>
      </div>

      <Choice label="How freely can you use it" options={ACCESS}
        value={access} onPick={onAccess} />

      <Choice label="Can you run straight off a station" options={RUN_LINK}
        value={runLink} onPick={onRunLink}
        note="Compromised running — a station straight into a run — is the session that decides a Hyrox. This is what tells me whether you can train it." />

    </div>
  );
}

function Choice({
  label, options, value, onPick, note,
}: {
  label: string; options: [string, string][]; value: string | null;
  onPick: (v: string) => void; note?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={caps}>{label}</span>
      {options.map(([l, sub]) => {
        const on = value === l;
        return (
          <button key={l} onClick={() => onPick(l)} style={{
            width: "100%", textAlign: "left", padding: "12px 14px",
            borderRadius: "var(--r-card)", border: `1px solid ${on ? TEAL : LINE}`,
            background: on ? TEAL_T : PAPER,
            display: "flex", flexDirection: "column", gap: 2,
          }}>
            <span style={{ fontSize: 13, fontWeight: 700,
              color: on ? TEAL : "var(--ink)" }}>{l}</span>
            <span style={{ fontSize: 11, color: INK55 }}>{sub}</span>
          </button>
        );
      })}
      {note && (
        <span style={{ fontSize: 10, lineHeight: 1.5, color: INK40 }}>{note}</span>
      )}
    </div>
  );
}

const Row = ({ label, value, aside, bold }: {
  label: string; value: string; aside?: string; bold?: boolean;
}) => (
  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
    <span style={{ fontSize: bold ? 13 : 12, fontWeight: bold ? 700 : 500,
      color: bold ? "var(--ink)" : INK55 }}>{label}</span>
    <span style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
      <span style={{ fontSize: bold ? 17 : 13, fontWeight: 700 }}>{value}</span>
      {aside && <span style={{ fontSize: 11, color: TEAL }}>{aside}</span>}
    </span>
  </div>
);

const caps: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase",
  color: INK55,
};
