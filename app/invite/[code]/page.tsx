import { sql } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { normaliseCode } from "@/lib/connect";
import Invite from "@/components/app/Invite";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ code: string }> };

/**
 * Where an invite link lands.
 *
 * The inviter's name is looked up here and shown before anything is asked, because
 * a link that says only "you have been invited" is a link nobody accepts. Holding
 * the code is what entitles you to the name — it is a secret, single-use and
 * short-lived, so there is nothing here to enumerate.
 *
 * Signed out, this is the gate. The code is kept client-side across the sign-up so
 * the connection happens the moment there is an account to connect.
 */
export default async function InvitePage({ params }: Props) {
  const raw = (await params).code;
  const code = normaliseCode(raw);
  const me = await currentUser();

  const [invite] = code ? await sql<{
    name: string; used_at: string | null; expired: boolean; self: boolean;
  }[]>`
    select u.display_name as name, i.used_at,
           (i.expires_at <= now()) as expired,
           (i.inviter_id = ${me?.id ?? null}) as self
      from connection_invites i
      join users u on u.id = i.inviter_id
     where i.code = ${code} and i.revoked_at is null
  ` : [];

  return (
    <div className="app topsafe">
      <Invite
        code={code}
        signedIn={!!me}
        inviter={invite?.name ?? null}
        state={
          !code || !invite ? "unknown"
            : invite.self ? "own"
            : invite.used_at ? "used"
            : invite.expired ? "expired"
            : "open"
        } />
    </div>
  );
}
