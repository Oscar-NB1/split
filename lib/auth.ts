/**
 * Who someone is, and the one spelling of their address.
 *
 * There are no passwords here. Sign-in is Google or Strava, which means this app
 * never stores a credential, never needs a reset flow it has no email to send,
 * and cannot leak a password it does not have. Recovery is the provider's job,
 * and they are better at it than we would be.
 */
import { sql } from "./db";

export type Identity = {
  provider: string; subject: string; email: string | null; last_used: string | null;
};

// -------------------------------------------------------------------- emails

/**
 * One spelling of an address.
 *
 * Lowercased and trimmed, because "Sarah@Example.com" and "sarah@example.com"
 * are the same mailbox and letting both exist means two accounts holding half a
 * training history each. Dots and plus-tags are left alone: they are only
 * equivalent at some providers, and silently merging them would be wrong at the
 * others.
 */
export const normaliseEmail = (email: string) => email.trim().toLowerCase();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const looksLikeEmail = (email: string) => EMAIL.test(normaliseEmail(email));

/**
 * The identities that can get into an account.
 *
 * Read before unlinking one, because an account with no identities left is an
 * account nobody can ever sign into again.
 */
export const identitiesFor = (userId: string) => sql<Identity[]>`
  select provider, subject, email, last_used::text as last_used
    from identities where user_id = ${userId} order by created_at
`;
