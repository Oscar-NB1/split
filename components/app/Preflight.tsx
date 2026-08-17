"use client";
import { useEffect, useState } from "react";
import { EXPECTED_LAPS, FALLBACKS, isRunLap } from "@/lib/plan/capture";

const TEAL = "#0A8FB0", LIME = "#C6FF5B";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)", INK70 = "var(--ink-70)";
const LINE = "var(--line)", PAPER = "var(--paper)", NAVY = "var(--navy)";

export type Protocol = {
  variant: string;
  /** in order: the run and station doses, alternating */
  legs: { label: string; dose: string; load?: string | null }[];
  duration_min: number;
  note?: string;
};

/**
 * The benchmark, in one page.
 *
 * Read before the session and not during it — which is the whole reason the
 * capture is watch-first. Nobody wants to hold a phone between sled pushes, so
 * the page's job is to be finished with before the athlete starts.
 */
export default function Preflight({
  athleteId, onPush, onDone, pushable,
}: {
  athleteId?: string;
  /** send it to the watch as a structured workout */
  onPush: () => Promise<boolean>;
  onDone: () => void;
  pushable: boolean;
}) {
  const [state, setState] = useState<"idle" | "busy" | "sent" | "failed">("idle");
  /*
   * The protocol comes from the API rather than from a prop.
   *
   * It is a function of the kit they said they have and the division they entered — the
   * stations are substituted for anything they cannot reach and the loads are their own — so
   * it is not something a parent screen can know.
   */
  const [protocol, setProtocol] = useState<Protocol | null>(null);
  useEffect(() => {
    fetch(`/api/benchmarks${athleteId ? `?athlete=${athleteId}` : ""}`)
      .then((r) => r.json()).then((j) => setProtocol(j.protocol ?? null)).catch(() => {});
  }, [athleteId]);

  async function push() {
    setState("busy");
    setState((await onPush()) ? "sent" : "failed");
  }

  const legs = protocol?.legs ?? [];

  return (
    <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ ...caps, fontSize: 10, color: TEAL }}>Before you start</span>
        <span style={{ fontFamily: "var(--display)", fontSize: 25, fontWeight: 700,
          lineHeight: 1.15, letterSpacing: "-.02em" }}>
          The benchmark, in one page
        </span>
        {protocol && (
          <span style={{ fontSize: 12, color: INK55 }}>
            About {protocol.duration_min} minutes, warm-up aside.
          </span>
        )}
      </div>

      {/* What the test is for, before what to press. */}
      {protocol?.note && (
        <span style={{ fontSize: 12.5, lineHeight: 1.6, color: INK70 }}>{protocol.note}</span>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <button onClick={push} disabled={!pushable || state === "busy" || state === "sent"}
          style={{
            width: "100%", border: 0, borderRadius: "var(--r-pill)", padding: 16,
            fontSize: 12, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
            background: state === "sent" ? "var(--off)" : pushable ? LIME : "var(--off)",
            color: state === "sent" || !pushable ? INK55 : "#12314D",
          }}>
          {state === "sent" ? "On your watch"
            : state === "busy" ? "Sending…"
            : pushable ? "Send it to my watch" : "Connect a watch to send it"}
        </button>
        <span style={{ fontSize: 11, lineHeight: 1.55, color: state === "failed" ? "#C07A3E" : INK55 }}>
          {state === "failed"
            ? "That did not go through. The laps below work exactly the same by hand."
            : state === "sent"
              ? "It is a structured workout, so the watch prompts each segment and you only press lap."
              : pushable
                ? "It arrives as a structured workout: the watch prompts each segment, and you press lap at every boundary."
                : "Nothing here needs a watch. It is quicker with one, and every number below can be recorded by hand."}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={caps}>Recording it yourself</span>
        {legs.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {legs.map((l, i) => (
              <div key={i} style={{
                background: PAPER, border: `1px solid ${LINE}`, borderRadius: 12,
                padding: "11px 13px", display: "flex", flexDirection: "column", gap: 4,
              }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{l.label}</span>
                <span style={{ display: "flex", alignItems: "baseline",
                  justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 11, color: INK55 }}>
                    {l.dose}{l.load ? ` at ${l.load}` : ""}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 800, color: TEAL }}>lap {i + 1}</span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <span style={{ fontSize: 12, lineHeight: 1.6, color: INK55 }}>
            The protocol comes from the equipment you said you have and the division you
            entered. Answer the setup questions and it appears here.
          </span>
        )}

        <div style={{ background: NAVY, borderRadius: "var(--r-card)", padding: "15px 16px",
          display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.4, color: "#fff" }}>
            {EXPECTED_LAPS} laps, one press at every boundary.
          </span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,.7)" }}>
            Odd laps are runs, even laps are stations, in that order.
          </span>
        </div>

        {/* The one failure worth pre-empting: a missed press does not lose a
            segment, it shifts every later one, and the numbers still look
            plausible afterwards. */}
        {[
          "Miss a press and nothing is lost — the app checks the lap count against the protocol and asks you to confirm the mapping rather than guessing at it.",
          "Do not stop the watch between segments. A pause reads as a transition, and transitions are measured.",
          "If you have to stop the session early, say so afterwards. A test that ended at round three still measures speed; it says nothing about fade, and it will not be read as though it did.",
        ].map((t) => (
          <span key={t} style={{ fontSize: 12, lineHeight: 1.55, color: INK70 }}>{t}</span>
        ))}

        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 2 }}>
          <span style={{ ...caps, fontSize: 10, color: INK40 }}>If it does not sync</span>
          {FALLBACKS.map((f) => (
            <span key={f.when} style={{ fontSize: 11, lineHeight: 1.5, color: INK55 }}>
              <b style={{ color: INK70 }}>{f.when}</b> — {f.capture}
            </span>
          ))}
        </div>
      </div>

      <button onClick={onDone} style={{
        width: "100%", background: LIME, border: 0, borderRadius: "var(--r-pill)",
        color: "#12314D", padding: 16, fontSize: 12, fontWeight: 800,
        letterSpacing: ".06em", textTransform: "uppercase",
      }}>Got it</button>
    </div>
  );
}

const caps: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase",
  color: INK55,
};

/** Which lap is which, for anything that needs to label them. */
export const lapKind = (i: number) => (isRunLap(i) ? "run" : "station");
