"use client";
import { useState } from "react";

/**
 * A provider's own mark.
 *
 * Falls back to a lettered tile when the asset is missing rather than to a
 * hand-drawn shape: an approximate logo is worse than none where the exact mark
 * is the recognition cue, so nothing here is drawn by hand. Drop the official
 * file into public/marks/<id>.png and every place that shows it picks it up.
 */
export default function Mark({
  id, label, size = 20, radius = 5,
}: { id: string; label: string; size?: number; radius?: number }) {
  const [failed, setFailed] = useState(false);
  const box: React.CSSProperties = {
    width: size, height: size, flex: "none", borderRadius: radius, objectFit: "contain",
  };
  if (failed) {
    return (
      <span aria-hidden style={{ ...box, background: "var(--off)", color: "var(--ink-40)",
        fontSize: Math.round(size * 0.45), fontWeight: 800, display: "flex",
        alignItems: "center", justifyContent: "center" }}>
        {label.slice(0, 1)}
      </span>
    );
  }
  return <img src={`/marks/${id}.png`} alt="" style={box} onError={() => setFailed(true)} />;
}
