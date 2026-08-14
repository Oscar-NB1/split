/** Creates the two user rows from your env vars. Safe to re-run. */
import { sql } from "../lib/db";

async function main() {
  for (const [email, name] of [
    [process.env.USER_A_EMAIL, process.env.USER_A_NAME],
    [process.env.USER_B_EMAIL, process.env.USER_B_NAME],
  ]) {
    if (!email) continue;
    await sql`
      insert into users (email, display_name) values (${email}, ${name ?? email})
      on conflict (email) do update set display_name = excluded.display_name
    `;
    console.log("ready:", email);
  }
  await sql.end();
}
main();
