/**
 * Campus-map building geocoding.
 *
 * Primary: Google Maps Geocoding (when an owner-configured API key exists) —
 * markedly better at resolving campus building names. Fallback: the free,
 * keyless OpenStreetMap Nominatim geocoder (one request at a time with ≥1.1s
 * spacing per its usage policy). Results cache permanently in storage; the
 * OSRM demo server draws real walking paths; Options allows manual edits
 * (MAP_SET). No AI involved in any of it.
 */
import type { CampusBuilding, CampusMap } from '../shared/types';
import { getStored, setStored } from '../shared/storage';
import { haversineMeters } from '../shared/route';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
// Nominatim asks for identification; fetch can't set User-Agent, so use the
// documented email parameter (the developer's contact, not the user's).
const NOMINATIM_EMAIL = 'eric2007118@gmail.com';

let lastRequestAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function nominatimLookup(
  query: string,
  center?: { lat: number; lng: number },
): Promise<{ lat: number; lng: number } | null> {
  // Nominatim usage policy: max 1 request/second.
  const wait = lastRequestAt + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  let url = `${NOMINATIM}?format=json&limit=1&q=${encodeURIComponent(query)}&email=${encodeURIComponent(NOMINATIM_EMAIL)}`;
  if (center) {
    // Bound the search to ~5 km around campus — "Statler Hall" alone is
    // ambiguous worldwide but unique on campus (verified against live data).
    const d = 0.05;
    url += `&viewbox=${center.lng - d},${center.lat + d},${center.lng + d},${center.lat - d}&bounded=1`;
  }
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const arr = (await res.json()) as Array<{ lat: string; lon: string }>;
  const hit = arr?.[0];
  if (!hit) return null;
  const lat = parseFloat(hit.lat);
  const lng = parseFloat(hit.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

// ---------- Google Maps lookups (primary when an owner key is configured) ----------

const GOOGLE_FINDPLACE = 'https://maps.googleapis.com/maps/api/place/findplacefromtext/json';
const GOOGLE_GEOCODE = 'https://maps.googleapis.com/maps/api/geocode/json';

/** Results farther than this from the campus center are considered wrong —
 *  a geocoder that "helpfully" matched some same-named place elsewhere. */
const MAX_CAMPUS_DISTANCE_M = 10_000;

/** Pure (unit-tested): Places "find place from text" — the right Google API
 *  for named POIs like campus buildings. Biased to a 5 km campus circle. */
export function googleFindPlaceUrl(
  query: string,
  key: string,
  center?: { lat: number; lng: number },
): string {
  let url = `${GOOGLE_FINDPLACE}?input=${encodeURIComponent(query)}&inputtype=textquery&fields=geometry&key=${encodeURIComponent(key)}`;
  if (center) url += `&locationbias=circle%3A5000%40${center.lat}%2C${center.lng}`;
  return url;
}

/** Pure (unit-tested): campus-biased Google geocode request (fallback). */
export function googleGeocodeUrl(
  query: string,
  key: string,
  center?: { lat: number; lng: number },
): string {
  let url = `${GOOGLE_GEOCODE}?address=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`;
  if (center) {
    // ~5 km viewport bias around campus — same rationale as the Nominatim
    // viewbox: "Statler Hall" is ambiguous worldwide, unique on campus.
    const d = 0.05;
    url += `&bounds=${center.lat - d},${center.lng - d}|${center.lat + d},${center.lng + d}`;
  }
  return url;
}

/** Pure (unit-tested): keep only results that are actually on/near campus. */
export function plausibleOnCampus(
  hit: { lat: number; lng: number },
  center?: { lat: number; lng: number },
): boolean {
  if (!Number.isFinite(hit.lat) || !Number.isFinite(hit.lng)) return false;
  if (!center) return true;
  return haversineMeters(hit, center) <= MAX_CAMPUS_DISTANCE_M;
}

async function googleLookup(
  query: string,
  key: string,
  center?: { lat: number; lng: number },
): Promise<{ lat: number; lng: number } | null> {
  // 1 — Places text search: purpose-built for "Statler Hall"-style names.
  try {
    const res = await fetch(googleFindPlaceUrl(query, key, center), {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        status: string;
        candidates?: Array<{ geometry?: { location?: { lat: number; lng: number } } }>;
      };
      const loc = data.status === 'OK' ? data.candidates?.[0]?.geometry?.location : undefined;
      if (loc && plausibleOnCampus(loc, center)) return { lat: loc.lat, lng: loc.lng };
    }
  } catch {
    // fall through to the geocoder
  }
  // 2 — Geocoding API fallback. Reject approximate matches: those are city or
  // campus centroids, which is exactly the "inaccurate conversion" failure.
  const res = await fetch(googleGeocodeUrl(query, key, center), {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    status: string;
    results?: Array<{
      partial_match?: boolean;
      geometry?: { location?: { lat: number; lng: number }; location_type?: string };
    }>;
  };
  if (data.status !== 'OK') return null;
  const top = data.results?.[0];
  const loc = top?.geometry?.location;
  // partial_match = Google guessed a similar-but-different place; APPROXIMATE
  // = an area centroid. Both are the "close but wrong pin" failure — reject.
  if (!loc || top.partial_match === true || top.geometry?.location_type === 'APPROXIMATE') return null;
  return plausibleOnCampus(loc, center) ? { lat: loc.lat, lng: loc.lng } : null;
}

/** Current map, reset if the school changed since it was built. */
async function currentMap(): Promise<CampusMap> {
  const [map, settings] = await Promise.all([getStored('campusMap'), getStored('settings')]);
  const school = settings.rmpSchool?.name ?? null;
  if (map.school !== school) return { school, buildings: {} };
  return map;
}

export interface MapLookupResult {
  map: CampusMap;
  missing: string[];
}

/** Geocode every building not already in the map — Google when a key is
 *  configured (owner mode), OpenStreetMap otherwise / as fallback. */
export async function geocodeBuildings(names: string[]): Promise<MapLookupResult> {
  const map = await currentMap();
  const googleKey = (await getStored('settings')).googleMapsApiKey?.trim() || null;
  // Resolve the campus center once — building names are only unique nearby.
  if (!map.center && map.school) {
    try {
      map.center =
        (googleKey ? await googleLookup(map.school, googleKey) : null) ??
        (await nominatimLookup(map.school)) ??
        undefined;
    } catch {
      map.center = undefined;
    }
  }
  const missing: string[] = [];
  for (const name of names) {
    if (map.buildings[name]) continue;
    let hit: { lat: number; lng: number } | null = null;
    let source: CampusBuilding['source'] = 'osm';
    try {
      if (googleKey) {
        // Google resolves campus context best with the school in the query.
        hit = await googleLookup(map.school ? `${name}, ${map.school}` : name, googleKey, map.center);
        if (hit) source = 'google';
      }
      if (!hit) {
        hit = await nominatimLookup(name, map.center);
        // Workday often abbreviates ("Hollister 110" → building "Hollister");
        // most campus buildings are "<Name> Hall" in OSM, so retry with that.
        if (!hit && map.center && !/\b(hall|center|centre|building|library|lab|auditorium)\b/i.test(name)) {
          hit = await nominatimLookup(`${name} Hall`, map.center);
        }
        if (hit && !plausibleOnCampus(hit, map.center)) hit = null;
      }
    } catch {
      hit = null; // offline / blocked — treated as not found
    }
    if (hit) map.buildings[name] = { ...hit, source };
    else missing.push(name);
  }
  await setStored('campusMap', map);
  return { map, missing };
}

/**
 * Throw away every auto-located coordinate (✍️ manual entries survive) and
 * geocode the given names again with the current geocoder. This is how stale
 * results get fixed after configuring a Google key — located buildings are
 * cached permanently and would otherwise keep their old OSM coordinates.
 */
export async function relocateBuildings(names: string[]): Promise<MapLookupResult> {
  const map = await currentMap();
  const manualOnly: Record<string, CampusBuilding> = {};
  for (const [name, b] of Object.entries(map.buildings)) {
    if (b.source === 'manual') manualOnly[name] = b;
  }
  // Drop the cached center too, so it re-resolves with the better geocoder.
  await setStored('campusMap', { school: map.school, buildings: manualOnly });
  const all = new Set([...names, ...Object.keys(map.buildings)]);
  return geocodeBuildings([...all]);
}

/** Full-map replacement from the Options editor (single-writer convention). */
export async function setCampusMap(map: CampusMap): Promise<void> {
  const clean: Record<string, CampusBuilding> = {};
  for (const [name, b] of Object.entries(map.buildings)) {
    if (
      name.trim() &&
      Number.isFinite(b.lat) &&
      Number.isFinite(b.lng) &&
      Math.abs(b.lat) <= 90 &&
      Math.abs(b.lng) <= 180
    ) {
      clean[name.trim()] = b;
    }
  }
  await setStored('campusMap', { school: map.school, buildings: clean });
}

// ---------- Real walking routes (free OSRM demo server, no AI, no key) ----------

export interface WalkRoute {
  distanceM: number;
  durationMin: number;
  /** route geometry as [lng, lat] pairs, decimated for drawing */
  coords: Array<[number, number]>;
}

const routeCache = new Map<string, WalkRoute | null>();

export async function fetchWalkingRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<WalkRoute | null> {
  const key = `${from.lat.toFixed(5)},${from.lng.toFixed(5)}|${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
  if (routeCache.has(key)) return routeCache.get(key)!;
  let route: WalkRoute | null = null;
  try {
    const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const data = (await res.json()) as {
        code: string;
        routes?: Array<{ distance: number; duration: number; geometry: { coordinates: Array<[number, number]> } }>;
      };
      const r = data.code === 'Ok' ? data.routes?.[0] : undefined;
      if (r) {
        const pts = r.geometry.coordinates;
        // keep at most ~120 points for a small preview drawing
        const step = Math.max(1, Math.ceil(pts.length / 120));
        route = {
          distanceM: r.distance,
          durationMin: r.duration / 60,
          coords: pts.filter((_, i) => i % step === 0 || i === pts.length - 1),
        };
      }
    }
  } catch {
    route = null; // offline / server busy — the straight-line estimate stands
  }
  if (routeCache.size > 200) routeCache.clear();
  routeCache.set(key, route);
  return route;
}
