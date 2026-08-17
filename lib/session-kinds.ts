/**
 * Which sessions a watch can take.
 *
 * Its own module, free of any database import, because the thing it guards is a pure question
 * about a session's kind and the module it used to live in opens a Postgres client. A test for a
 * predicate should not need a connection string.
 *
 * The guard this replaces was `kind.startsWith("run")`, which was true when the kinds were
 * `run_easy`, `run_long` and `run_intervals`. They are `easy_run`, `long_run` and `quality_run`
 * now — the word moved to the end — so it had been false for every session in the app since the
 * rename: the send button answered "only structured runs can be sent to the watch" for all of
 * them, and the hourly cron pushed nothing. Nothing failed. It quietly did no work, which is
 * exactly why it survived so long.
 *
 * Both namings are accepted, because old plans still hold the old ones, and the set is explicit
 * rather than a substring test so the next rename breaks a test instead of a feature.
 */
export const RUNNABLE_KINDS = [
  "easy_run", "long_run", "quality_run", "benchmark",
  "run_easy", "run_long", "run_intervals", "run_recovery",
] as const;

const RUNNABLE = new Set<string>(RUNNABLE_KINDS);

export const isRunnable = (kind: string): boolean =>
  RUNNABLE.has(kind) || kind.startsWith("run_") || /_run$/.test(kind);
