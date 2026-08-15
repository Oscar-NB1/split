"use client";
import { useEffect, useState } from "react";
import Mark from "./Mark";

const LIME = "var(--lime)", NAVY = "var(--navy)", TEAL = "var(--teal)";
const INK = "var(--ink)", INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const OFF = "var(--off)", LINE = "var(--line)", PAPER = "var(--paper)";

/**
 * The gate. Nothing behind it is reachable until you are signed in.
 *
 * It sits inside the phone frame rather than over the page — the design's own
 * note about this is worth keeping: `position: absolute; inset: 0` resolves
 * against the nearest positioned ancestor, so a gate that renders full-page is
 * telling you it has become a sibling of the frame rather than a child.
 *
 * Sign up and log in are one screen with two headings. The only real difference
 * is which one a returning athlete expects to see, and building two would mean
 * maintaining the same provider list twice.
 */

type Provider = { id: string; label: string; grants: string; start: string };
type Mode = "welcome" | "signup" | "signin";

/** What the OAuth callback can come back saying. */
const OUTCOME: Record<string, string> = {
  cancelled: "You came back without finishing. Nothing has changed.",
  "email-in-use":
    "An account already uses that email. Sign in the way you did before, then add this from your profile.",
  "already-linked": "That account is already attached to someone else here.",
  state: "That sign-in took too long. Worth trying again.",
  failed: "That did not complete. Worth trying again.",
  unavailable: "That sign-in is not set up yet.",
};

export default function Auth() {
  const [mode, setMode] = useState<Mode>("welcome");
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((j) => setProviders(j.providers))
      .catch(() => setProviders([]));

    // the callback returns here with an outcome; read it, then clear it so a
    // reload does not re-announce a sign-in that happened ten minutes ago
    const said = new URLSearchParams(location.search).get("auth");
    if (said) {
      setNotice(OUTCOME[said] ?? OUTCOME.failed);
      setMode("signin");
      history.replaceState(null, "", location.pathname);
    }
  }, []);

  if (mode === "welcome") {
    return (
      <div style={{ position: "absolute", inset: 0, zIndex: 20, background: OFF,
        display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 26,
          background: NAVY, padding: "40px 26px" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
            gap: 12, textAlign: "center" }}>
            <span style={{ fontFamily: "var(--display)", fontSize: 13, fontWeight: 800,
              letterSpacing: ".18em", textTransform: "uppercase", color: LIME }}>
              NB1 Coach
            </span>
            <span style={{ fontFamily: "var(--display)", fontSize: 30, fontWeight: 700,
              lineHeight: 1.14, letterSpacing: "-.02em", color: "#fff" }}>
              Your plan, your partner, your race.
            </span>
            <span style={{ fontSize: 13, lineHeight: 1.6, color: "rgba(255,255,255,.65)",
              maxWidth: "30ch" }}>
              Built around one block at a time, and the sessions that decide it.
            </span>
          </div>
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 9 }}>
            <button onClick={() => setMode("signup")} style={{ width: "100%", background: LIME,
              border: 0, borderRadius: "var(--r-pill)", color: "var(--on-lime)", padding: 17,
              fontSize: 13, fontWeight: 800, letterSpacing: ".04em" }}>Sign up</button>
            <button onClick={() => setMode("signin")} style={{ width: "100%",
              background: "rgba(255,255,255,.92)", border: 0, borderRadius: "var(--r-pill)",
              color: "#12314D", padding: 17, fontSize: 13, fontWeight: 800,
              letterSpacing: ".04em" }}>Log in</button>
          </div>
        </div>
      </div>
    );
  }

  const isSignup = mode === "signup";

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 20, background: OFF,
      display: "flex", flexDirection: "column", overflowY: "auto" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column",
        padding: "18px 22px 30px", gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={() => { setMode("welcome"); setNotice(null); }}
            aria-label="Back" style={{ background: "none", border: 0, padding: 0,
              fontSize: 20, lineHeight: 1, color: INK }}>←</button>
          <span style={{ flex: 1, height: 4, borderRadius: 2, background: LINE, display: "flex" }}>
            <span style={{ width: "100%", height: 4, borderRadius: 2, background: TEAL }} />
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontFamily: "var(--display)", fontSize: 26, fontWeight: 700,
            lineHeight: 1.15, letterSpacing: "-.02em" }}>
            {isSignup ? "How do you want to sign up?" : "How do you want to log in?"}
          </span>
          <span style={{ fontSize: 13, lineHeight: 1.6, color: INK55 }}>
            {isSignup
              ? "One tap. We take your name from whichever you choose, so there is nothing to fill in."
              : "Whichever you used to sign up."}
          </span>
        </div>

        {notice && (
          <div style={{ background: PAPER, border: `1px solid ${LINE}`,
            borderRadius: "var(--r-card)", padding: "12px 14px", fontSize: 12,
            lineHeight: 1.55, color: INK55 }}>{notice}</div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {providers === null && <span style={{ fontSize: 12, color: INK40 }}>Loading…</span>}
          {providers?.length === 0 && (
            <span style={{ fontSize: 12, lineHeight: 1.55, color: INK40 }}>
              No sign-in is configured yet. Add a provider&apos;s credentials and it appears here.
            </span>
          )}
          {providers?.map((p) => (
            // a plain link: the round trip is a navigation, and a fetch would only
            // add a failure mode between the tap and the provider
            <a key={p.id} href={p.start} style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 11,
              width: "100%", background: PAPER, border: `1px solid ${LINE}`,
              borderRadius: "var(--r-pill)", padding: 15, fontSize: 13, fontWeight: 700,
              color: INK, textDecoration: "none",
            }}>
              <Mark id={p.id} label={p.label} />
              Continue with {p.label}
            </a>
          ))}
        </div>

        {providers && providers.length > 0 && (
          <span style={{ fontSize: 12, lineHeight: 1.55, color: INK55 }}>
            {providers.find((p) => p.id === "strava")?.grants ?? providers[0].grants}
          </span>
        )}

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 11, lineHeight: 1.55, color: INK40 }}>
            We never see a password. Signing in is handled by whichever provider you pick, and
            nothing is written back to it.
          </span>
          <button onClick={() => { setMode(isSignup ? "signin" : "signup"); setNotice(null); }}
            style={{ background: "none", border: 0, padding: 0, textAlign: "left",
              fontSize: 12, fontWeight: 700, color: TEAL }}>
            {isSignup ? "I already have an account" : "I do not have an account yet"}
          </button>
        </div>
      </div>
    </div>
  );
}
