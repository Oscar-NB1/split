"use client";
import { useEffect, useState } from "react";
import Auth from "./Auth";

const TEAL = "#0A8FB0";
const INK55 = "var(--ink-55)";

/** Where the code waits while an account is being made. */
export const PENDING_INVITE = "hyrox-invite";

type State = "open" | "used" | "expired" | "own" | "unknown";

const SAYS: Record<State, string> = {
  open: "",
  used: "That invite has already been used. Codes work once — ask them for a new one.",
  expired: "That invite has expired. Ask them to send a new one.",
  own: "That is your own invite link. Send it to them instead.",
  unknown: "That link does not match an invite. It may have been replaced.",
};

/**
 * The invite landing.
 *
 * Signed in, accepting is one tap and the request goes to the person who made the
 * link. Signed out, this is the sign-up gate with the code held in the browser, so
 * the Shell can send it the moment there is an account — the alternative is asking
 * someone to find and type a code they were handed as a link.
 */
export default function Invite({
  code, signedIn, inviter, state,
}: {
  code: string | null; signedIn: boolean;
  inviter: string | null; state: State;
}) {
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (code && state === "open" && !signedIn) {
      localStorage.setItem(PENDING_INVITE, code);
    }
  }, [code, state, signedIn]);

  const accept = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/partners/redeem", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { localStorage.removeItem(PENDING_INVITE); setSent(j.note ?? "Sent."); }
      else setError(j.error ?? "That did not go through.");
    } finally { setBusy(false); }
  };

  const head = (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".1em",
        textTransform: "uppercase", color: TEAL }}>Training partner</span>
      <span style={{ fontFamily: "var(--display)", fontSize: 25, fontWeight: 700,
        lineHeight: 1.15, letterSpacing: "-.02em" }}>
        {inviter && state === "open"
          ? `${inviter} wants to train against you`
          : "This invite is not usable"}
      </span>
    </div>
  );

  if (state !== "open") {
    return (
      <div style={{ padding: "22px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        {head}
        <span style={{ fontSize: 13, lineHeight: 1.6, color: INK55 }}>{SAYS[state]}</span>
        <a href="/" style={{ ...cta, textAlign: "center", textDecoration: "none" }}>
          Open the app
        </a>
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "22px 20px 0", display: "flex",
          flexDirection: "column", gap: 10 }}>
          {head}
          <span style={{ fontSize: 13, lineHeight: 1.6, color: INK55 }}>
            Make an account and the request goes to {inviter} straight away. You
            compare how much of your own plan you each finish each week — not
            kilometres against kilometres.
          </span>
        </div>
        <Auth />
      </div>
    );
  }

  return (
    <div style={{ padding: "22px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
      {head}
      <span style={{ fontSize: 13, lineHeight: 1.6, color: INK55 }}>
        Accepting sends {inviter} a request. Once they confirm it is you, each week
        is scored as your share of your own plan, so the two of you are comparable
        whatever your plans look like.
      </span>

      {sent
        ? (
          <>
            <span style={{ fontSize: 13, fontWeight: 700, color: TEAL }}>{sent}</span>
            <a href="/" style={{ ...cta, textAlign: "center", textDecoration: "none" }}>
              Open the app
            </a>
          </>
        )
        : (
          <>
            <button onClick={accept} disabled={busy} style={cta}>
              {busy ? "Sending…" : "Accept"}
            </button>
            <a href="/" style={{ fontSize: 12, fontWeight: 700, color: INK55,
              textAlign: "center", textDecoration: "underline" }}>Not now</a>
          </>
        )}

      {error && (
        <span style={{ fontSize: 12, lineHeight: 1.55, color: "#8A6D14",
          background: "rgba(232,192,81,.14)", borderRadius: 10, padding: "11px 12px" }}>
          {error}
        </span>
      )}
    </div>
  );
}

const cta: React.CSSProperties = {
  width: "100%", background: "var(--lime)", border: 0, display: "block",
  borderRadius: "var(--r-pill)", padding: 16, fontSize: 12, fontWeight: 800,
  letterSpacing: ".06em", textTransform: "uppercase", color: "var(--on-lime)",
};
