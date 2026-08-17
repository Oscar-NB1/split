import { sign, COOKIE } from "./lib/session-token";
const BASE = "https://split-gamma-two.vercel.app";
const jar = `${COOKIE}=${await sign("ae984b3a-523d-47c6-b308-b3619f9de8f9")}`;
const r = await fetch(`${BASE}/api/config`, { headers: { cookie: jar } });
console.log(r.status, JSON.stringify(await r.json()).slice(0, 600));
