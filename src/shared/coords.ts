/**
 * Parse coordinates out of anything a user copies from Google Maps: a plain
 * "42.4459, -76.4844" pair, a share/place URL, or a search URL. Lets a
 * building's pin be matched to a direct Maps search exactly, no typing.
 */

export interface LatLngPair {
  lat: number;
  lng: number;
}

const ok = (lat: number, lng: number): LatLngPair | null =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { lat, lng }
    : null;

export function parseLatLng(text: string): LatLngPair | null {
  const s = text.trim();
  if (!s) return null;

  // Place-URL data blob: "...!3d42.4451039!4d-76.4823946..." — this is the
  // actual place pin (the "@" pair is only the viewport center), so try first.
  const blob = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (blob) {
    const hit = ok(parseFloat(blob[1]!), parseFloat(blob[2]!));
    if (hit) return hit;
  }

  // Query params: ?q=42.44,-76.48 / ?query=... / ?destination=...
  const q = s.match(/[?&](?:q|query|destination|ll)=(-?\d+(?:\.\d+)?)\s*(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i);
  if (q) {
    const hit = ok(parseFloat(q[1]!), parseFloat(q[2]!));
    if (hit) return hit;
  }

  // Viewport: ".../@42.4451,-76.4834,17z" — good enough when nothing better.
  const at = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) {
    const hit = ok(parseFloat(at[1]!), parseFloat(at[2]!));
    if (hit) return hit;
  }

  // Bare pair: "42.4459, -76.4844" (also tolerates parentheses).
  const pair = s.replace(/[()]/g, '').match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (pair) {
    const hit = ok(parseFloat(pair[1]!), parseFloat(pair[2]!));
    if (hit) return hit;
  }

  return null;
}
