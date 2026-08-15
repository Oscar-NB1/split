import { NextResponse } from "next/server";

/**
 * Errors that already know their status code.
 *
 * Before this, requireUser() threw a bare Error and nothing caught it, so an
 * expired cookie came back as a 500 - indistinguishable from a broken server,
 * and the client showed nothing at all. A session problem has to say 401 so
 * the UI can send you back to the login screen.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const unauthorized = () => new HttpError(401, "Session expired. Sign in again.");
export const badRequest = (m: string) => new HttpError(400, m);
export const notFound = (m = "not found") => new HttpError(404, m);

/**
 * Wraps a route handler so thrown HttpErrors become their status code, bad
 * JSON becomes a 400, and anything unexpected is logged once and answered as
 * a 500 rather than leaking a stack trace to the client.
 */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      if (e instanceof SyntaxError) {
        return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
      }
      console.error("unhandled route error", e);
      return NextResponse.json({ error: "Something broke. Try again." }, { status: 500 });
    }
  };
}

/**
 * Same, for the GET routes a browser navigates to directly: an unauthenticated
 * visit belongs at the login screen, not on a JSON error page.
 */
export function redirectingRoute<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) {
        return NextResponse.redirect(`${process.env.APP_URL}/`);
      }
      console.error("unhandled route error", e);
      return NextResponse.redirect(`${process.env.APP_URL}/settings?error=1`);
    }
  };
}
