"use client";
import { useCallback, useEffect, useState } from "react";
import { fmt } from "@/lib/dates";
import { hms } from "@/lib/analysis";

type Split = { ord: number; label: string; kind: string; seconds: number; place: number | null };
type Race = {
  id: string; user_id: string; display_name: string; source_url: string;
  event_name: string | null; division: string | null; age_group: string | null;
  race_date: string | null; overall_seconds: number | null;
  rank_overall: number | null; rank_age_group: number | null; bib: string | null;
  activity_id: string | null; activity_name: string | null; activity_date: string | null;
  activity_seconds: number | null;
  splits: Split[];
};

/** Strip the distance prefix: "1000m SkiErg" is just "SkiErg" in a table of stations. */
const shortLabel = (l: string) => l.replace(/^\d+m?\s+/, "").replace(/\s*Time$/, "");

export default function Races({ meId }: { meId: string }) {
  const [races, setRaces] = useState<Race[] | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/races");
    if (res.status === 401) { location.href = "/login"; return; }
    if (res.ok) setRaces((await res.json()).races);
    else setError("Couldn't load races.");
  }, []);
  useEffect(() => { load(); }, [load]);

  async function importRace() {
    setBusy(true); setError(null); setNote(null);
    try {
      const res = await fetch("/api/races", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) { location.href = "/login"; return; }
      if (!res.ok) { setError(json.error ?? "That didn't import."); return; }
      setNote(
        `Imported ${json.event_name ?? "race"} — ${json.splits} splits` +
        (json.linked_activity ? ", linked to your Strava activity." : ". No matching Strava activity found, so it has no date yet."),
      );
      setUrl("");
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adet">
      <a className="backlink" href="/">← Week</a>
      <h2 className="adet-title">Races</h2>

      <div className="card" style={{ marginBottom: 18 }}>
        <h3>Import a result</h3>
        <p className="note">
          Open your result on <b>results.hyrox.com</b>, click your own name so you are on
          your detail page, and paste the address here. Runs, stations and roxzone come
          across automatically.
        </p>
        <div className="importrow">
          <input
            value={url} onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && url && importRace()}
            placeholder="https://results.hyrox.com/season-8/?content=detail&idp=…"
            aria-label="Result page URL"
          />
          <button className="act primary" onClick={importRace} disabled={busy || !url}>
            {busy ? "Reading…" : "Import"}
          </button>
        </div>
        {error && <div className="errbox" role="alert">{error}</div>}
        {note && <div className="warnbox">{note}</div>}
      </div>

      {races === null && <p className="note">Loading…</p>}
      {races?.length === 0 && (
        <p className="note">No races yet. Paste a result above to add your first one.</p>
      )}
      {races?.map((r) => <RaceCard key={r.id} race={r} mine={r.user_id === meId} />)}
    </div>
  );
}

function RaceCard({ race, mine }: { race: Race; mine: boolean }) {
  const runs = race.splits.filter((s) => s.kind === "run");
  const stations = race.splits.filter((s) => s.kind === "station");
  const rox = race.splits.find((s) => s.kind === "roxzone");
  // The page's own Run Total, never the sum of the displayed splits: each split
  // is rounded to the second, so adding eight of them drifts a few seconds from
  // the official figure.
  const runTotal = race.splits.find((s) => /^run total$/i.test(s.label));

  const maxRun = Math.max(...runs.map((s) => s.seconds), 1);
  const maxStation = Math.max(...stations.map((s) => s.seconds), 1);
  const fade = runs.length > 1 ? runs[runs.length - 1].seconds - runs[0].seconds : null;

  return (
    <section className="card racecard">
      <div className="racehead">
        <div>
          <div className="eyebrow">
            {race.race_date
              ? fmt(race.race_date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
              : "date unknown"}
            {" · "}{mine ? "You" : race.display_name}
            {race.division ? ` · ${race.division}` : ""}
            {race.age_group ? ` · ${race.age_group}` : ""}
          </div>
          <h3 className="racename disp">{race.event_name ?? "Race"}</h3>
        </div>
        <div className="racetime disp">{hms(race.overall_seconds)}</div>
      </div>

      <div className="racestats">
        <Mini label="Run total" value={hms(runTotal?.seconds ?? null)} />
        <Mini label="Roxzone" value={hms(rox?.seconds ?? null)} />
        <Mini label="Rank" value={race.rank_overall ? `#${race.rank_overall}` : "—"} />
        <Mini label="Age group" value={race.rank_age_group ? `#${race.rank_age_group}` : "—"} />
      </div>

      {runs.length > 0 && (
        <>
          <h4 className="sechead">
            Runs
            {fade !== null && (
              <span className="dimlabel">
                {fade > 0 ? `last ${hms(fade)} slower than the first` : "no fade"}
              </span>
            )}
          </h4>
          <div className="bars">
            {runs.map((s) => (
              <Bar key={s.ord} label={s.label.replace("Running ", "")}
                seconds={s.seconds} max={maxRun} />
            ))}
          </div>
        </>
      )}

      {stations.length > 0 && (
        <>
          <h4 className="sechead">Stations</h4>
          <div className="bars">
            {stations.map((s) => (
              <Bar key={s.ord} label={shortLabel(s.label)} seconds={s.seconds}
                max={maxStation} place={s.place} wide />
            ))}
          </div>
        </>
      )}

      <p className="note racefoot">
        {race.activity_id ? (
          <>
            Linked to <a href={`/activity/${race.activity_id}`}>{race.activity_name}</a>
            {race.activity_seconds && race.overall_seconds
              ? ` · watch recorded ${hms(race.activity_seconds - race.overall_seconds)} more than the official time`
              : ""}
          </>
        ) : (
          "Not linked to a Strava activity."
        )}
        {" · "}
        <a href={race.source_url} target="_blank" rel="noreferrer">Official result ↗</a>
      </p>
    </section>
  );
}

const Mini = ({ label, value }: { label: string; value: string }) => (
  <div className="stat">
    <div className="lab">{label}</div>
    <div className="statval disp">{value}</div>
  </div>
);

function Bar({
  label, seconds, max, place, wide,
}: { label: string; seconds: number; max: number; place?: number | null; wide?: boolean }) {
  return (
    <div className={`barrow${wide ? " wide" : ""}`}>
      <span className="barlab">{label}</span>
      <span className="bartrack">
        <i style={{ width: `${Math.max(2, (seconds / max) * 100)}%` }} />
      </span>
      <span className="barval mono">{hms(seconds)}</span>
      <span className="barplace mono">{place ? `#${place}` : ""}</span>
    </div>
  );
}
