/**
 * Static basemap images for the recorded route.
 *
 * Mapbox's Static Images API renders the polyline itself as a `path-` overlay,
 * so there is no mapping library in the browser and no client-side JavaScript
 * involved at all — the route arrives as one PNG. That matters here: the app has
 * no charting or mapping dependency anywhere else, and a slippy map would add
 * ~200kB of GL JS to look at a shape both athletes already recognise.
 *
 * The token is read server-side only. `MAPBOX_TOKEN` is deliberately NOT
 * prefixed NEXT_PUBLIC_, and the image is served through our own route, so the
 * token never reaches the browser.
 */

/** Mapbox rejects any request over this length, polyline included. */
const MAX_URL = 8192;

/** Dark, because the app is. Route colour is supplied by the caller. */
const STYLE = "mapbox/dark-v11";

export const hasBasemap = () => Boolean(process.env.MAPBOX_TOKEN);

/**
 * Drop every nth point until the encoded polyline fits the URL budget.
 *
 * Strava's `summary_polyline` is already simplified — the longest of 499
 * activities here is 1,214 characters, or 1,646 once URI-encoded, against a
 * budget of ~8,000. So this never fires today. It exists because the failure
 * mode without it is silent: an unusually long route would produce a 4xx from
 * Mapbox and an empty map, and the cause would not be obvious.
 */
function fitToBudget(points: [number, number][], budget: number): [number, number][] {
  let step = 1;
  for (;;) {
    const kept = step === 1 ? points : points.filter((_, i) => i % step === 0);
    if (encodeURIComponent(encodePolyline(kept)).length <= budget || kept.length < 50) return kept;
    step++;
  }
}

/** The inverse of decodePolyline in lib/analysis — Google's encoded format. */
export function encodePolyline(points: [number, number][]): string {
  let out = "";
  let lastLat = 0, lastLng = 0;
  for (const [lat, lng] of points) {
    const iLat = Math.round(lat * 1e5), iLng = Math.round(lng * 1e5);
    for (const delta of [iLat - lastLat, iLng - lastLng]) {
      let v = delta < 0 ? ~(delta << 1) : delta << 1;
      while (v >= 0x20) {
        out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
        v >>= 5;
      }
      out += String.fromCharCode(v + 63);
    }
    lastLat = iLat; lastLng = iLng;
  }
  return out;
}

/**
 * The Mapbox URL for one route, or null if there is no token or no route.
 *
 * `auto` for the viewport makes Mapbox fit the bounds of the overlay, which is
 * exactly the framing we want and saves computing a bbox and zoom ourselves.
 */
export function staticMapUrl(
  points: [number, number][],
  colour: string,
  width = 900,
  height = 460,
): string | null {
  const token = process.env.MAPBOX_TOKEN;
  if (!token || points.length < 2) return null;

  // hex without the '#': Mapbox wants 3 or 6 bare hex digits
  const stroke = colour.replace(/^#/, "");
  const prefix = `https://api.mapbox.com/styles/v1/${STYLE}/static/path-4+${stroke}-0.95(`;
  const suffix = `)/auto/${width}x${height}@2x?access_token=${token}&padding=24`;

  const budget = MAX_URL - prefix.length - suffix.length;
  const encoded = encodeURIComponent(encodePolyline(fitToBudget(points, budget)));
  return `${prefix}${encoded}${suffix}`;
}
