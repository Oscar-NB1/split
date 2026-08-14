import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { redirectingRoute } from "@/lib/http";
import { authorizeUrl } from "@/lib/whoop";

export const GET = redirectingRoute(async () => {
  const user = await requireUser();
  return NextResponse.redirect(authorizeUrl(user.id));
});
