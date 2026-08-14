import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __sql: ReturnType<typeof postgres> | undefined;
}

/**
 * TLS everywhere except a local database. Tested on the HOSTNAME, not the whole
 * connection string: "localhost" can appear in a password or in a hosted domain
 * like db.localhost.example.com, and matching that would silently drop TLS on a
 * production connection.
 */
function needsTLS(url: string): boolean {
  // an explicit sslmode in the DSN wins - that's someone telling us directly
  if (/[?&]sslmode=(disable|false)/i.test(url)) return false;
  try {
    // URL keeps the brackets on an IPv6 host, so [::1] is the form to match
    const host = new URL(url).hostname;
    return !["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);
  } catch {
    return true; // unparseable: assume the safer answer
  }
}

export const sql =
  global.__sql ??
  postgres(process.env.DATABASE_URL!, {
    ssl: needsTLS(process.env.DATABASE_URL ?? "") ? "require" : false,
    max: 3,
    idle_timeout: 20,
  });

if (process.env.NODE_ENV !== "production") global.__sql = sql;

export type User = {
  id: string;
  email: string;
  display_name: string;
};
