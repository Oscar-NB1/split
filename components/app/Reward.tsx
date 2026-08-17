"use client";
import { useEffect, useState } from "react";
import { fmt } from "@/lib/dates";

/**
 * The screen after the hard one.
 *
 * Every other screen in this app is about what is still to come: the next session, the week's
 * target, how far behind the volume is. That is what a plan is for, and it means the app never
 * once tells somebody they did the thing. This is the exception, and it is the first screen after
 * a key session rather than something to go and find — she is standing outside with a phone in a
 * sweaty hand, and the moment is now.
 *
 * The picture is hers, of her own cat, and that is the point: a stock trophy graphic would be
 * worth nothing. Which is also why an athlete with no picture set never sees this at all rather
 * than seeing somebody else's in-joke.
 *
 * One tap and it is gone for good. A reward that has to be dismissed twice is a nag.
 */

export type Pending = {
  session_id: string | null; title: string; kind: string; date: string | null; image: string;
  /** key_session or race — the two have nothing in common except that both are behind her */
  reward_kind?: string;
};

/** A reward can be a photo or a short clip; the path is the only thing that says which. */
const isVideo = (src: string) => /\.(mp4|mov|webm)$/i.test(src);

export default function Reward({ r, onDone }: { r: Pending; onDone: () => void }) {
  const [going, setGoing] = useState(false);
  /* Held until the picture is there: half a reward screen is worse than a moment of nothing. */
  const [ready, setReady] = useState(false);
  /*
   * Muted to begin with, because that is the only way a phone will play it unprompted — iOS blocks
   * autoplay with sound, and a reward screen that needs a second tap before anything happens is
   * not a reward. The sound is offered rather than forced.
   */
  const [muted, setMuted] = useState(true);
  const video = isVideo(r.image);

  useEffect(() => {
    if (video) { setReady(true); return; }
    const img = new Image();
    img.onload = () => setReady(true);
    img.onerror = () => setReady(true);
    img.src = r.image;
  }, [r.image, video]);

  async function dismiss() {
    setGoing(true);
    /* Marked seen and then closed regardless: a failed write must not trap her on this screen. */
    await fetch("/api/rewards", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: r.session_id }),
    }).catch(() => {});
    onDone();
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 60, background: "#0E2740",
      display: "flex", flexDirection: "column",
      opacity: ready ? 1 : 0, transition: "opacity .35s ease",
    }}>
      {/* The picture, or the clip, filling whatever the phone gives it. */}
      {video ? (
        /*
         * Centred in the space rather than filling it.
         *
         * The clip is landscape and the phone is not, so a full-bleed treatment left it floating in a
         * tall navy band with empty space above and below — which reads as something that failed to
         * load rather than as a composition. Centred, with the words directly underneath, it is a card.
         */
        <div style={{
          flex: 1, minHeight: 0, position: "relative", display: "flex",
          alignItems: "center", justifyContent: "center", padding: "0 0 6px",
        }}>
          <video
            src={r.image}
            autoPlay loop playsInline muted={muted}
            /*
             * `contain` rather than `cover`: the clip is landscape and the phone is not, so cropping
             * to fill would cut most of the subject out of frame. Letterboxed on the same navy the
             * rest of the screen uses, which reads as deliberate rather than as a gap.
             */
            style={{ width: "100%", height: "100%", objectFit: "contain", background: "#0E2740" }}
          />
          <button onClick={() => setMuted(!muted)}
            aria-label={muted ? "Sound on" : "Sound off"}
            style={{
              position: "absolute", top: "calc(14px + env(safe-area-inset-top))", right: 14,
              width: 40, height: 40, borderRadius: "50%", fontSize: 16,
              background: "rgba(14,39,64,.55)", color: "#fff", border: 0,
              backdropFilter: "blur(6px)",
            }}>{muted ? "🔇" : "🔊"}</button>
        </div>
      ) : (
        <div style={{
          flex: 1, minHeight: 0, backgroundImage: `url(${r.image})`,
          backgroundSize: "cover", backgroundPosition: "center",
        }} />
      )}

      <div style={{
        padding: "22px 22px calc(26px + env(safe-area-inset-bottom))",
        display: "flex", flexDirection: "column", gap: 14,
        /*
         * A photo bleeds to the edges and the words sit on top of it, so they need a gradient under
         * them and a negative margin to overlap. A centred clip needs neither: the text is already on
         * solid ground.
         */
        ...(video ? {} : {
          background: "linear-gradient(to top, #0E2740 62%, rgba(14,39,64,0))",
          marginTop: -90,
        }),
        position: "relative",
      }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".14em",
          textTransform: "uppercase", color: "#C6FF5B" }}>
          {r.reward_kind === "welcome" ? "Welcome"
            : r.reward_kind === "race" ? "Raced"
            : r.reward_kind === "strength" ? "Lifted" : "Done"}
          {r.date ? ` · ${fmt(r.date, { weekday: "long", day: "numeric", month: "long" })}` : ""}
        </span>
        <span style={{ fontFamily: "var(--display)", fontSize: 29, fontWeight: 750,
          lineHeight: 1.1, letterSpacing: "-.02em", color: "#fff" }}>
          {r.title}
        </span>
        <span style={{ fontSize: 13.5, lineHeight: 1.55, color: "rgba(255,255,255,.72)" }}>
          {r.reward_kind === "welcome"
            ? "Ten weeks, three runs and a gym session a week, and one race at the end of it with me. Every hard session gets you one of these."
            : r.reward_kind === "race"
            ? "Ten weeks of Tuesdays and Sundays, for this. Whatever the clock said, you have raced a Hyrox — and the next one starts from a completely different place."
            : r.reward_kind === "strength"
              ? "Squats, split squats and calves. Nobody enjoys this one and it is the reason the lunges do not end your race."
              : "That was the session the week turns on. Everything else this week exists to make it possible — and it is behind you."}
        </span>
        <button onClick={dismiss} disabled={going} style={{
          width: "100%", border: 0, borderRadius: 100, padding: 16,
          background: "#C6FF5B", color: "#0E2740", fontSize: 12, fontWeight: 800,
          letterSpacing: ".06em", textTransform: "uppercase", opacity: going ? .6 : 1,
        }}>
          {going ? "…" : r.reward_kind === "welcome" ? "Let's go"
            : r.reward_kind === "race" ? "Go and sit down"
            : r.reward_kind === "strength" ? "Protein and a sit down" : "Recovery mode"}
        </button>
      </div>
    </div>
  );
}
