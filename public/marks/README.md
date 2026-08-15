# Provider marks

Drop the official assets here:

- `strava.png` — in the design project at `assets/strava-mark.png`
- `google.png` — from Google's branding guidelines, if Google sign-in is enabled

Named after the provider id, which is what `components/app/Auth.tsx` looks up.
Until a file is here the button shows a lettered tile instead. That is
deliberate: an approximate logo is worse than none on a sign-in button, where
the exact mark is the recognition cue, so nothing here is drawn by hand.
