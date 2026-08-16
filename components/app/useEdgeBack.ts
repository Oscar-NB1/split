"use client";
import { useEffect, useRef } from "react";

/**
 * Swipe in from the left edge to go back.
 *
 * iOS gives this gesture to every native app and to Safari, but a standalone
 * PWA has no browser chrome and no history stack worth popping — so without
 * this, the only way back is the small arrow in the corner, which is the one
 * control a thumb cannot reach one-handed.
 *
 * Deliberately narrow about what counts:
 *
 * - it must start within `EDGE` of the left edge, so a horizontal drag inside a
 *   chart or a scrolling row is never stolen;
 * - it must move further across than it does down, decided once and then
 *   committed to, so a diagonal thumb-flick does not fight the scroll;
 * - it must clear `THRESHOLD`, or a fast flick, so a nudge does not navigate.
 *
 * Nothing is registered at all when there is nowhere to go back to, which means
 * the tab screens keep their normal scrolling behaviour untouched.
 */

/** How close to the edge a swipe has to start. Matches iOS's own gesture. */
const EDGE = 28;
/** How far it has to travel to count. */
const THRESHOLD = 70;
/** Or how fast, for a flick that never gets that far. */
const VELOCITY = 0.5; // px per ms

export function useEdgeBack(
  ref: React.RefObject<HTMLElement | null>,
  onBack: (() => void) | null,
) {
  // Kept in a ref so changing the handler mid-gesture cannot strand a listener.
  const back = useRef(onBack);
  back.current = onBack;

  useEffect(() => {
    const el = ref.current;
    if (!el || !onBack) return;

    let startX = 0, startY = 0, startedAt = 0;
    let tracking = false, decided: "back" | "scroll" | null = null;

    const reset = () => {
      tracking = false; decided = null;
      el.style.transform = "";
      el.style.transition = "";
    };

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || t.clientX > EDGE) return;
      startX = t.clientX; startY = t.clientY;
      startedAt = e.timeStamp;
      tracking = true; decided = null;
      el.style.transition = "";
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX, dy = t.clientY - startY;

      // Decide once, at the point the gesture has a direction, and hold it.
      if (decided === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        decided = Math.abs(dx) > Math.abs(dy) ? "back" : "scroll";
      }
      if (decided === "scroll") { tracking = false; return; }

      // Follows the thumb, damped, so it reads as dragging the screen aside
      // rather than as a button that fires late.
      e.preventDefault();
      el.style.transform = `translateX(${Math.max(0, dx) * 0.35}px)`;
    };

    const onEnd = (e: TouchEvent) => {
      if (!tracking || decided !== "back") { reset(); return; }
      const t = e.changedTouches[0];
      const dx = t ? t.clientX - startX : 0;
      const ms = Math.max(1, e.timeStamp - startedAt);
      const far = dx > THRESHOLD || dx / ms > VELOCITY;

      el.style.transition = "transform .18s ease-out";
      el.style.transform = "";
      tracking = false; decided = null;
      if (far) back.current?.();
    };

    // `passive: false` on move only — it is the one that may preventDefault.
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", reset);
      reset();
    };
  }, [ref, onBack]);
}
