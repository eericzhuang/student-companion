/**
 * Campus-map building geocoding.
 *
 * All free, no AI: OpenStreetMap's Nominatim geocoder for building
 * coordinates (one request at a time with ≥1.1s spacing per its usage policy,
 * results cached permanently in storage), the OSRM demo server for real
 * walking paths, and manual editing in Options (MAP_SET).
 */
import type { CampusBuilding, CampusMap } from '../shared/types';
import { getStored, setStored } from '../shared/storage';

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

/** Free geocoding for every building not already in the map. */
export async function geocodeBuildings(names: string[]): Promise<MapLookupResult> {
  const map = await currentMap();
  // Resolve the campus center once — building names are only unique nearby.
  if (!map.center && map.school) {
    try {
      map.center = (await nominatimLookup(map.school)) ?? undefined;
    } catch {
      map.center = undefined;
    }
  }
  const missing: string[] = [];
  for (const name of names) {
    if (map.buildings[name]) continue;
    let hit: { lat: number; lng: number } | null = null;
    try {
      hit = await nominatimLookup(name, map.center);
      // Workday often abbreviates ("Hollister 110" → building "Hollister");
      // most campus buildings are "<Name> Hall" in OSM, so retry with that.
      if (!hit && map.center && !/\b(hall|center|centre|building|library|lab|auditorium)\b/i.test(name)) {
        hit = await nominatimLookup(`${name} Hall`, map.center);
      }
    } catch {
      hit = null; // offline / blocked — treated as not found
    }
    if (hit) map.buildings[name] = { ...hit, source: 'osm' };
    else missing.push(name);
  }
  await setStored('campusMap', map);
  return { map, missing };
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
