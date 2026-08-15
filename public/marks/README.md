# Provider marks

`strava.png` and `google.png` are the official assets, supplied by the athlete
who owns the app registrations.

Named after the provider id, which is what `components/app/Mark.tsx` looks up.
When a file is missing the button falls back to a lettered tile rather than a
hand-drawn shape: an approximate logo is worse than none where the exact mark is
the recognition cue.

One component renders them everywhere they appear — the sign-in buttons, the
profile row and the Strava screen — so a replacement file lands in all three.
