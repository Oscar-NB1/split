/**
 * Give an existing account a password.
 *
 *   npx tsx scripts/set-password.ts you@example.com
 *
 * A command, never a route. `setInitialPassword` only writes where there is no
 * password yet, which makes it safe to run twice and useless as a reset — but
 * exposed over HTTP that same rule would hand any passwordless account to the
 * first anonymous caller. The two athletes here were created by an access code
 * and have no password, which is exactly the case an attacker would look for.
 */
import { createInterface } from "node:readline/promises";
import { sql } from "../lib/db";
import { MIN_PASSWORD, normaliseEmail, passwordProblems, setInitialPassword } from "../lib/auth";

async function main() {
  const email = normaliseEmail(process.argv[2] ?? "");
  if (!email) throw new Error("usage: set-password.ts <email>");

  const [user] = await sql<{ id: string; display_name: string; password_hash: string | null }[]>`
    select id, display_name, password_hash from users where lower(email) = ${email}
  `;
  if (!user) throw new Error(`no account for ${email}`);
  if (user.password_hash) {
    throw new Error(`${email} already has a password — this command cannot reset one`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const password = await rl.question(`Password for ${user.display_name} (min ${MIN_PASSWORD}): `);
  rl.close();

  const problems = passwordProblems(password, [user.display_name, email.split("@")[0]]);
  if (problems.length) { console.error(problems.join(" ")); process.exit(1); }

  console.log(await setInitialPassword(email, password)
    ? `Set. ${email} can now sign in with a password.`
    : "Nothing written — a password appeared while this was running.");
  await sql.end();
}

main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
