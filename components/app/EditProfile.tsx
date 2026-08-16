"use client";
import { useEffect, useRef, useState } from "react";
import { zonesFor } from "@/lib/coach";
import type { Prof } from "./Profile";

const LIME = "#C6FF5B", NAVY_D = "#0E2740", TEAL = "#0A8FB0";
const TEAL_T = "var(--teal-tint)";

/** Offered rather than free text, and "prefer not to say" is a real answer. */
const GENDERS = ["Male", "Female", "Other", "Prefer not to say"];
const INK40 = "var(--ink-40)", INK55 = "var(--ink-55)";
const PAPER = "var(--paper)", LINE = "var(--line)";

/**
 * Editing the athlete.
 *
 * `hr_max` is the field that matters most and the one least obviously important:
 * every zone table in the app is derived from it, so the preview under the input
 * updates live — otherwise a number typed here has invisible consequences three
 * screens away.
 */
export default function EditProfile({ onSaved }: { onSaved: () => void }) {
  const [p, setP] = useState<Prof | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/profile").then(async (r) => r.ok && setP(await r.json()));
  }, []);

  if (!p) return <div style={{ padding: 18 }}><p className="empty">Loading…</p></div>;
  const set = (k: keyof Prof, v: unknown) => setP({ ...p, [k]: v } as Prof);

  async function save() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/profile", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: p!.display_name, hr_max: p!.hr_max,
        weight_kg: p!.weight_kg, dob: p!.dob,
        gender: p!.gender, avatar_url: p!.avatar_url ?? null,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      // The server's own words: "that image is too large" is worth reading, and
      // "that didn't save" for a photo problem sends people back to the fields.
      const j = await r.json().catch(() => ({}));
      setMsg(j.error ?? "That didn't save.");
      return;
    }
    onSaved();
  }

  /**
   * A chosen photo, resized before it goes anywhere.
   *
   * The picture is stored on the row rather than in an object store, so the size
   * matters: 256 px square, re-encoded as JPEG, lands around 20 KB whatever came
   * out of the camera. Cropped centrally, because an avatar is a circle and a
   * letterboxed portrait in a circle is mostly forehead.
   */
  async function pick(f: File) {
    setMsg(null);
    if (!f.type.startsWith("image/")) { setMsg("That is not an image."); return; }
    try {
      const url = URL.createObjectURL(f);
      const img = await new Promise<HTMLImageElement>((ok, no) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = () => no(new Error("unreadable"));
        i.src = url;
      });
      const S = 256;
      const canvas = document.createElement("canvas");
      canvas.width = S; canvas.height = S;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      const side = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side,
        0, 0, S, S);
      URL.revokeObjectURL(url);
      set("avatar_url", canvas.toDataURL("image/jpeg", 0.8));
      setMsg("Photo ready — save to keep it.");
    } catch {
      setMsg("That image could not be read.");
    }
  }

  const zones = zonesFor(p.hr_max);

  return (
    <div style={{ padding: "18px 18px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ fontFamily: "var(--display)", fontSize: 24, fontWeight: 700,
        lineHeight: 1.1, letterSpacing: "-.02em" }}>Edit profile</div>

      {/* Your own photo, or the one the sign-in provider gave us. */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button onClick={() => file.current?.click()} aria-label="Change your photo"
          style={{ width: 72, height: 72, flex: "none", borderRadius: "50%",
            overflow: "hidden", background: TEAL, color: "#fff", fontSize: 26,
            fontWeight: 800, display: "flex", alignItems: "center",
            justifyContent: "center", padding: 0, border: 0 }}>
          {p.avatar_url
            ? <img src={p.avatar_url} alt="" width={72} height={72}
                style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : (p.display_name ?? "?").slice(0, 1).toUpperCase()}
        </button>
        <span style={{ display: "flex", flexDirection: "column", gap: 6,
          alignItems: "flex-start" }}>
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => file.current?.click()} style={{
              background: PAPER, border: `1px solid ${LINE}`,
              borderRadius: "var(--r-pill)", padding: "8px 14px", fontSize: 11,
              fontWeight: 700, color: "var(--ink)",
            }}>{p.avatar_url ? "Change photo" : "Add a photo"}</button>
            {p.avatar_url && (
              <button onClick={() => { set("avatar_url", null); setMsg("Photo removed — save to keep it."); }}
                style={{ background: "none", border: 0, fontSize: 11, fontWeight: 700,
                  color: INK55, textDecoration: "underline" }}>Remove</button>
            )}
          </span>
          <span style={{ fontSize: 11, color: INK55, lineHeight: 1.5 }}>
            Square works best. It is resized to 256 px before it is saved.
          </span>
        </span>
        <input ref={file} type="file" accept="image/*" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ""; }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Name" value={p.display_name ?? ""} onChange={(v) => set("display_name", v)} />
        <Field label="Email" type="email" value={p.email ?? ""} onChange={() => {}} readOnly
          note="Your sign-in identity. Changing it would change which account this is." />
        <Field label="Date of birth" type="date" value={p.dob ?? ""} onChange={(v) => set("dob", v)} />
        <Field label="Weight (kg)" type="number" value={p.weight_kg ?? ""} onChange={(v) => set("weight_kg", v)} />
        <Field label="Max heart rate (bpm)" type="number" value={p.hr_max ?? ""}
          onChange={(v) => set("hr_max", v === "" ? null : Number(v))} />

        <div style={{ background: PAPER, border: `1px solid ${LINE}`,
          borderRadius: "var(--r-card)", padding: "12px 14px",
          display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
            textTransform: "uppercase", color: INK55 }}>Zones this produces</span>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {zones.map((z) => (
              <span key={z.tag} style={{ display: "flex", alignItems: "center", gap: 5,
                fontSize: 11, fontWeight: 600, background: "var(--off)",
                borderRadius: "var(--r-pill)", padding: "5px 10px" }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: z.colour }} />
                {z.tag} {z.label}
              </span>
            ))}
          </div>
          <span style={{ fontSize: 10, color: INK40, lineHeight: 1.5 }}>
            Every zone chart in the app comes from this number. Easy runs belong in Z2 —
            the plan&apos;s most repeated instruction.
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
            textTransform: "uppercase", color: INK55 }}>Gender</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {GENDERS.map((g) => {
              const on = p.gender === g;
              return (
                <button key={g} onClick={() => set("gender", on ? null : g)} style={{
                  padding: "9px 14px", borderRadius: "var(--r-pill)", fontSize: 11,
                  fontWeight: 600, border: `1px solid ${on ? TEAL : LINE}`,
                  background: on ? TEAL_T : PAPER, color: on ? TEAL : INK55,
                }}>{g}</button>
              );
            })}
          </div>
        </div>

      </div>


      {msg && <div className="errbox">{msg}</div>}

      <button onClick={save} disabled={busy} style={{
        width: "100%", background: LIME, borderRadius: "var(--r-pill)", color: NAVY_D,
        padding: 16, fontSize: 12, fontWeight: 800, letterSpacing: ".06em",
        textTransform: "uppercase",
      }}>{busy ? "Saving…" : "Save profile"}</button>
    </div>
  );
}

function Field({
  label, value, onChange, type = "text", readOnly = false, note,
}: {
  label: string; value: string | number; onChange: (v: string) => void;
  type?: string; readOnly?: boolean; note?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em",
        textTransform: "uppercase", color: INK55 }}>{label}</span>
      <input type={type} value={value} readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 12,
          padding: "13px 14px", fontSize: 14,
          color: readOnly ? INK55 : "var(--ink)" }} />
      {note && <span style={{ fontSize: 10, color: INK40, lineHeight: 1.5 }}>{note}</span>}
    </label>
  );
}
