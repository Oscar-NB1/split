"use client";
import { useEffect, useState } from "react";
import { fmt } from "@/lib/dates";

const LIME = "#C6FF5B", NAVY_D = "#0E2740", TEAL = "#0A8FB0";
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const OFF = "var(--off)", PAPER = "var(--paper)", LINE = "var(--line)";

/**
 * Connections.
 *
 * The design has no screen for this — its Profile just links out to one — so this
 * is composed in the same language rather than ported: the same card radius, the
 * same uppercase micro-labels, teal for state and lime for the action. It replaces
 * a pre-design page still on the old stylesheet, which the Profile screen linked
 * straight into.
 *
 * The three connections are deliberately not interchangeable, and the screen says
 * which is which: Strava is an OAuth round trip, intervals.icu is a pasted key,
 * Runna is a calendar URL. A single "connect" affordance for all three would be a
 * lie about two of them.
 */

type Conn = { provider: string; updated_at: string | null };

export default function Connect() {
  const [conns, setConns] = useState<Conn[] | null>(null);
  const [feed, setFeed] = useState("");
  const [icu, setIcu] = useState({ athlete_id: "", api_key: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () =>
    fetch("/api/profile").then(async (r) => {
      if (r.status === 401) { location.href = "/login"; return; }
      const j = await r.json();
      setConns((j.connections ?? j.connected.map((p: string) => ({ provider: p, updated_at: null }))));
    });

  useEffect(() => { load(); }, []);

  // Strava's callback cannot render anything itself, so it redirects back with the
  // outcome in the URL. Reading it here is what turns a silent bounce into a
  // sentence — a denied scope in particular looks exactly like success otherwise.
  useEffect(() => {
    const said = new URLSearchParams(location.search).get("strava");
    if (!said) return;
    setMsg(
      said === "connected" ? { ok: true, text: "Strava connected. Activities will start arriving." }
      : said === "denied" ? { ok: false, text: "Strava sign-in was cancelled, so nothing is connected." }
      : said === "scope" ? { ok: false, text: "Strava was connected without permission to read activities. Reconnect and leave every box ticked." }
      : { ok: false, text: "Strava did not complete the connection. Worth trying again." },
    );
    // cleared once read, so a reload does not re-announce a week-old connection
    history.replaceState(null, "", location.pathname);
  }, []);

  const at = (p: string) => conns?.find((c) => c.provider === p);
  const on = (p: string) => !!at(p);

  async function send(method: "POST" | "PUT", body: unknown, label: string, key: string) {
    setBusy(key); setMsg(null);
    const res = await fetch("/api/intervals", {
      method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.status === 401) { location.href = "/login"; return; }
    if (!res.ok) {
      // say why: nearly every failure here is a mistyped key or a webcal:// URL
      setMsg({ ok: false, text: json.error ?? `That didn't save (${res.status}).` });
      return;
    }
    setMsg({
      ok: true,
      text: typeof json.pushed === "number"
        ? `${label} connected. ${json.pushed} ${json.pushed === 1 ? "workout" : "workouts"} pushed.`
        : `${label} connected.`,
    });
    if (key === "intervals") setIcu({ athlete_id: "", api_key: "" });
    if (key === "runna") setFeed("");
    await load();
  }

  return (
    <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em",
          textTransform: "uppercase", color: "var(--teal)" }}>Connections</div>
        <div style={{ fontFamily: "var(--display)", fontSize: 24, fontWeight: 700,
          lineHeight: 1.1, letterSpacing: "-.02em", marginTop: 5 }}>
          Where the data comes from.
        </div>
        <div style={{ fontSize: 13, color: INK55, lineHeight: 1.5, marginTop: 7 }}>
          Each of you connects your own accounts. Nothing here is shared between you.
        </div>
      </div>

      {msg && (
        <div style={{ background: msg.ok ? "var(--teal-tint2)" : "#FDECE8",
          border: `1px solid ${msg.ok ? TEAL : "#E9B8AC"}`, borderRadius: "var(--r-card)",
          padding: "12px 14px", fontSize: 12, lineHeight: 1.5,
          color: msg.ok ? TEAL : "#8E3521" }}>
          {msg.text}
        </div>
      )}

      {/* ---------------------------------------------------------- Strava */}
      <Card
        name="Strava"
        state={on("strava")}
        since={at("strava")?.updated_at}
        sub="Activities, per-kilometre splits, laps and the HR and pace streams. This is the spine — everything the app shows about what you actually did comes from here."
      >
        {on("strava") ? (
          <Note>Connected. New activities arrive on their own; nothing to do here.</Note>
        ) : (
          <>
            <Note>
              Strava needs its own sign-in rather than a key, so this leaves the app and
              comes back.
            </Note>
            <a href="/api/strava/connect" style={{
              display: "block", textAlign: "center", width: "100%", background: LIME,
              borderRadius: "var(--r-pill)", color: NAVY_D, padding: 15, fontSize: 12,
              fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
              textDecoration: "none",
            }}>Connect Strava</a>
          </>
        )}
      </Card>

      {/* --------------------------------------------------- intervals.icu */}
      <Card
        name="intervals.icu"
        state={on("intervals")}
        since={at("intervals")?.updated_at}
        sub="How a programmed session reaches the watch. Garmin's own Training API is business-only, so workouts go to intervals.icu and its Garmin integration syncs them into Garmin Connect."
      >
        <Note>
          In intervals.icu: Settings → Developer for the API key, and
          Settings → Connections → Garmin with “Upload planned workouts” ticked.
        </Note>
        <Field label="Athlete ID" placeholder="i12345" value={icu.athlete_id}
          onChange={(v) => setIcu({ ...icu, athlete_id: v })} />
        <Field label="API key" placeholder="paste the key" value={icu.api_key}
          onChange={(v) => setIcu({ ...icu, api_key: v })} />
        <Action
          busy={busy === "intervals"}
          disabled={!icu.athlete_id.trim() || !icu.api_key.trim()}
          label={on("intervals") ? "Replace key" : "Connect intervals.icu"}
          onClick={() => send("POST", { athlete_id: icu.athlete_id.trim(), api_key: icu.api_key.trim() },
            "intervals.icu", "intervals")}
        />
      </Card>

      {/* ----------------------------------------------------------- Runna */}
      <Card
        name="Runna"
        state={on("runna")}
        since={at("runna")?.updated_at}
        sub="The running spine of the plan, read from Runna's calendar feed. Its sessions arrive as prose rather than structure, so they are shown as written and never reinterpreted."
      >
        <Note>Copy the calendar feed URL from Runna, and swap webcal:// for https://.</Note>
        <Field label="Feed URL" placeholder="https://…" value={feed} onChange={setFeed} />
        <Action
          busy={busy === "runna"}
          disabled={!/^https?:\/\//.test(feed.trim())}
          label={on("runna") ? "Replace feed" : "Connect Runna"}
          onClick={() => send("PUT", { feed_url: feed.trim() }, "Runna", "runna")}
        />
      </Card>

      <div style={{ fontSize: 10, color: INK40, lineHeight: 1.5 }}>
        Keys are stored server-side against your account and never sent to the browser again.
      </div>
    </div>
  );
}

function Card({
  name, sub, state, since, children,
}: {
  name: string; sub: string; state: boolean; since?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div style={{ background: PAPER, border: `1px solid ${LINE}`,
      borderRadius: "var(--r-card)", padding: 16,
      display: "flex", flexDirection: "column", gap: 11 }}>
      <div style={{ display: "flex", alignItems: "flex-start",
        justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontFamily: "var(--display)", fontSize: 17, fontWeight: 700 }}>{name}</span>
          {since && (
            <span style={{ fontSize: 10, color: INK40 }}>
              since {fmt(since.slice(0, 10), { day: "numeric", month: "short", year: "numeric" })}
            </span>
          )}
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em",
          textTransform: "uppercase", borderRadius: "var(--r-pill)", padding: "5px 11px",
          flex: "none", background: state ? "var(--teal-tint2)" : OFF,
          color: state ? TEAL : INK40, border: `1px solid ${state ? TEAL : LINE}` }}>
          {state ? "Connected" : "Not connected"}
        </span>
      </div>
      <span style={{ fontSize: 12, color: INK55, lineHeight: 1.5 }}>{sub}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 9,
        borderTop: `1px solid var(--line-2)`, paddingTop: 11 }}>
        {children}
      </div>
    </div>
  );
}

const Note = ({ children }: { children: React.ReactNode }) => (
  <span style={{ fontSize: 11, color: INK40, lineHeight: 1.5 }}>{children}</span>
);

function Field({
  label, value, placeholder, onChange,
}: { label: string; value: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
        textTransform: "uppercase", color: INK55 }}>{label}</span>
      <input value={value} placeholder={placeholder} spellCheck={false} autoCapitalize="none"
        onChange={(e) => onChange(e.target.value)}
        style={{ background: OFF, border: `1px solid ${LINE}`, borderRadius: 12,
          padding: "13px 14px", fontSize: 14 }} />
    </label>
  );
}

function Action({
  label, onClick, busy, disabled,
}: { label: string; onClick: () => void; busy: boolean; disabled: boolean }) {
  const off = disabled || busy;
  return (
    <button onClick={onClick} disabled={off} style={{
      width: "100%", borderRadius: "var(--r-pill)", padding: 15, fontSize: 12,
      fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
      background: off ? OFF : LIME, color: off ? INK40 : NAVY_D,
      border: off ? `1px solid ${LINE}` : "none",
    }}>{busy ? "Saving…" : label}</button>
  );
}
