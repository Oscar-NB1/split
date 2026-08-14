#!/usr/bin/env node
/**
 * Runs a command with .env.local loaded.
 *
 * Only Next.js reads .env.local by itself. `npm run db:push` shells out to psql
 * and `db:seed` runs under tsx, so both see an empty DATABASE_URL without this.
 *
 * Parsing is done here rather than with `set -a; source .env.local` because a
 * Neon connection string contains `?` and `&` — sourcing it would background
 * half the URL. Values are passed through the child's env object, so no shell
 * quoting is involved at any point.
 *
 * Usage: node scripts/with-env.mjs psql "$DATABASE_URL" -f db/schema.sql
 *        node scripts/with-env.mjs npm run db:seed
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const FILE = new URL('../.env.local', import.meta.url);
if (!existsSync(FILE)) {
  console.error('.env.local not found — copy .env.example and fill it in first');
  process.exit(1);
}

const env = { ...process.env };
for (const raw of readFileSync(FILE, 'utf8').split('\n')) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq < 1) continue;
  const key = line.slice(0, eq).trim();
  let value = line.slice(eq + 1).trim();
  // Tolerate quoted values, but do not otherwise transform them.
  if (value.length > 1 && ((value.startsWith('"') && value.endsWith('"')) ||
                           (value.startsWith("'") && value.endsWith("'")))) {
    value = value.slice(1, -1);
  }
  if (value && value !== 'TODO') env[key] = value;
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('usage: node scripts/with-env.mjs <command> [args…]');
  process.exit(1);
}
// $VAR in an argument is expanded from the loaded env, so callers can write
// "$DATABASE_URL" without the outer shell having it.
const expanded = args.map((a) => a.replace(/^\$([A-Z_][A-Z0-9_]*)$/, (m, k) => env[k] ?? m));
const r = spawnSync(cmd, expanded, { stdio: 'inherit', env });
process.exit(r.status ?? 1);
