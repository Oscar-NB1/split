/**
 * Registers (or inspects) the Strava push subscription.
 *   npx tsx scripts/subscribe-webhook.ts          -> list existing
 *   npx tsx scripts/subscribe-webhook.ts create   -> create
 *   npx tsx scripts/subscribe-webhook.ts delete <id>
 *
 * Strava immediately GETs your callback URL to verify it, so the app must
 * already be deployed and reachable before this will work.
 */
const id = process.env.STRAVA_CLIENT_ID!;
const secret = process.env.STRAVA_CLIENT_SECRET!;
const base = "https://www.strava.com/api/v3/push_subscriptions";
const cmd = process.argv[2] ?? "list";

async function main() {
  if (cmd === "list") {
    const res = await fetch(`${base}?client_id=${id}&client_secret=${secret}`);
    console.log(await res.json());
    return;
  }

  if (cmd === "create") {
    const body = new URLSearchParams({
      client_id: id,
      client_secret: secret,
      callback_url: `${process.env.APP_URL}/api/strava/webhook`,
      verify_token: process.env.STRAVA_VERIFY_TOKEN!,
    });
    const res = await fetch(base, { method: "POST", body });
    const json = await res.json();
    if (!res.ok) {
      console.error("failed:", json);
      console.error(
        "\nMost common causes:\n" +
        "  - the app is not deployed yet, so Strava's verification GET 404s\n" +
        "  - APP_URL has a trailing slash\n" +
        "  - a subscription already exists (Strava allows exactly one per app)\n",
      );
      process.exit(1);
    }
    console.log("subscribed:", json);
    return;
  }

  if (cmd === "delete") {
    const subId = process.argv[3];
    const res = await fetch(
      `${base}/${subId}?client_id=${id}&client_secret=${secret}`,
      { method: "DELETE" },
    );
    console.log(res.status === 204 ? "deleted" : await res.text());
  }
}

main();
