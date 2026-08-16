import { sql } from "@/lib/db";

/**
 * Record why a build failed, on the server, with the answers that caused it.
 *
 * The client is told "something broke" because there is nothing useful it could
 * be told; this is so the same failure is legible afterwards. Writing it must
 * never itself break the response, so every error here is swallowed — a failure
 * to log a failure is not worth a second 500.
 */
export async function recordFailure(
  route: string, userId: string | null, e: unknown, payload: unknown,
): Promise<void> {
  try {
    const err = e as { message?: string; stack?: string };
    await sql`
      insert into build_failures (user_id, route, message, stack, payload)
      values (
        ${userId}, ${route},
        ${String(err?.message ?? e).slice(0, 500)},
        ${String(err?.stack ?? "").slice(0, 4000)},
        ${sql.json((payload ?? {}) as never)}
      )
    `;
  } catch {
    // Nothing to do about it, and nothing worth failing the request over.
  }
}
