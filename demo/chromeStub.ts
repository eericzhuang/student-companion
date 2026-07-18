/**
 * Minimal chrome.* stub so the real extension components can run in a plain
 * browser tab for the demo. Seeds storage with mock data and answers the few
 * runtime messages the UI sends.
 */
import { mockStore, mockRmpTeachers, mockBuildingCoords } from './mockData';

type Listener = (changes: Record<string, { newValue: unknown }>, area: string) => void;
const listeners = new Set<Listener>();
const store: Record<string, unknown> = { ...mockStore };

const chromeStub = {
  storage: {
    local: {
      async get(keys: string | string[] | null) {
        if (keys === null || keys === undefined) return { ...store };
        if (typeof keys === 'string') return { [keys]: store[keys] };
        const out: Record<string, unknown> = {};
        for (const k of keys) out[k] = store[k];
        return out;
      },
      async set(items: Record<string, unknown>) {
        const changes: Record<string, { newValue: unknown }> = {};
        for (const [k, v] of Object.entries(items)) {
          store[k] = v;
          changes[k] = { newValue: v };
        }
        listeners.forEach((l) => l(changes, 'local'));
      },
    },
    onChanged: {
      addListener: (l: Listener) => listeners.add(l),
      removeListener: (l: Listener) => listeners.delete(l),
    },
  },
  runtime: {
    async sendMessage(req: { kind: string; [k: string]: unknown }) {
      const write = (key: string, value: unknown) => {
        store[key] = value;
        listeners.forEach((l) => l({ [key]: { newValue: value } }, 'local'));
      };
      switch (req.kind) {
        case 'PANEL_STATE_UPDATE':
          store.settings = { ...(store.settings as object), panelState: req.panelState };
          return { ok: true };
        case 'SETTINGS_UPDATE':
          write('settings', { ...(store.settings as object), ...(req.patch as object) });
          return { ok: true };
        case 'OPEN_SUBSCRIBE':
          window.location.href = '/subscribe.html';
          return { ok: true };
        case 'MAP_GEOCODE': {
          const cur = (store.campusMap as { school: string | null; buildings: Record<string, unknown> }) ?? {
            school: 'Cornell University',
            buildings: {},
          };
          const buildings = { ...cur.buildings };
          const missing: string[] = [];
          for (const name of req.buildings as string[]) {
            const hit = mockBuildingCoords[name];
            if (hit) buildings[name] = { ...hit, source: 'osm' };
            else if (!buildings[name]) missing.push(name);
          }
          const map = { school: 'Cornell University', buildings };
          write('campusMap', map);
          return { ok: true, data: { map, missing } };
        }
        case 'MAP_SET':
          write('campusMap', req.map);
          return { ok: true };
        case 'MAP_ROUTE': {
          // canned zigzag path between the two points (like a street route)
          const f = req.from as { lat: number; lng: number };
          const t = req.to as { lat: number; lng: number };
          const coords: Array<[number, number]> = [];
          for (let i = 0; i <= 10; i++) {
            const k = i / 10;
            const jitter = i % 2 === 0 ? 0.0006 : -0.0006;
            coords.push([f.lng + (t.lng - f.lng) * k + (i > 0 && i < 10 ? jitter : 0), f.lat + (t.lat - f.lat) * k]);
          }
          const dLat = (t.lat - f.lat) * 110540;
          const dLng = (t.lng - f.lng) * 111320 * Math.cos((f.lat * Math.PI) / 180);
          const dist = Math.sqrt(dLat * dLat + dLng * dLng) * 1.22;
          return { ok: true, data: { distanceM: dist, durationMin: dist / 80, coords } };
        }
        case 'SCENARIO_SAVE': {
          const cur = (store.scenarios as unknown[]) ?? [];
          const scenario = {
            id: crypto.randomUUID(),
            name: (req.name as string).trim() || 'Untitled plan',
            snapshot: req.snapshot,
            createdAt: Date.now(),
          };
          write('scenarios', [...cur, scenario].slice(-20));
          return { ok: true, data: scenario };
        }
        case 'SCENARIO_DELETE': {
          const cur = (store.scenarios as Array<{ id: string }>) ?? [];
          write('scenarios', cur.filter((s) => s.id !== req.id));
          return { ok: true };
        }
        case 'SCENARIO_LOAD': {
          const cur = (store.scenarios as Array<{ id: string; name: string; snapshot: { sections: unknown[] } }>) ?? [];
          const hit = cur.find((s) => s.id === req.id);
          if (!hit) return { ok: false, error: 'That plan no longer exists.' };
          const schedule = store.schedule as { sections: unknown[] } | null;
          if (schedule && schedule.sections.length > 0) {
            const json = JSON.stringify(schedule.sections);
            if (!cur.some((s) => JSON.stringify(s.snapshot.sections) === json)) {
              write('scenarios', [
                ...cur,
                { id: crypto.randomUUID(), name: `Auto-saved before "${hit.name}"`, snapshot: schedule, createdAt: Date.now() },
              ].slice(-20));
            }
          }
          write('schedule', { ...hit.snapshot, capturedAt: Date.now() });
          return { ok: true };
        }
        case 'CANDIDATE_ADD': {
          const cur = (store.builderCandidates as Array<{ sectionId: string }>) ?? [];
          const section = req.section as { sectionId: string };
          write('builderCandidates', [...cur.filter((s) => s.sectionId !== section.sectionId), section].slice(-60));
          return { ok: true };
        }
        case 'CANDIDATE_REMOVE': {
          const cur = (store.builderCandidates as Array<{ sectionId: string }>) ?? [];
          write('builderCandidates', cur.filter((s) => s.sectionId !== req.sectionId));
          return { ok: true };
        }
        case 'CANDIDATE_CLEAR':
          write('builderCandidates', []);
          return { ok: true };
        case 'BACKUP_IMPORT': {
          const data = req.data as Record<string, unknown>;
          if (typeof data?.schemaVersion !== 'number') return { ok: false, error: 'Not a backup file.' };
          for (const [k, v] of Object.entries(data)) write(k, v);
          return { ok: true, data: { restored: Object.keys(data) } };
        }
        case 'PLANNER_STATE_UPDATE':
          write('plannerState', req.state);
          return { ok: true };
        case 'SCHEDULE_SET':
          write('schedule', req.snapshot);
          return { ok: true };
        case 'HISTORY_SET':
          write('academicHistory', req.history);
          return { ok: true };
        case 'REQ_OVERRIDE_SET': {
          const cur = { ...((store.reqOverrides as Record<string, unknown>) ?? {}) };
          if (req.value === null) delete cur[req.key as string];
          else cur[req.key as string] = req.value;
          write('reqOverrides', cur);
          return { ok: true };
        }
        case 'RMP_SEARCH_TEACHERS':
          return { ok: true, data: { teachers: mockRmpTeachers } };
        case 'AI_HISTORY_CLEAR':
          write('aiHistory', []);
          return { ok: true };
        case 'AI_HISTORY_REMOVE': {
          const ids = new Set(req.ids as string[]);
          const cur = (store.aiHistory as Array<{ id: string }>) ?? [];
          write('aiHistory', cur.filter((e) => !ids.has(e.id)));
          return { ok: true };
        }
        case 'PREREQ_RESEARCH':
          return {
            ok: true,
            data: {
              prereqs: ['CS 3410'],
              equivalents: [],
              note: 'Per the demo catalog, this course requires CS 3410 first.',
            },
          };
        case 'AI_CHAT':
          return {
            ok: true,
            data: {
              thinking:
                'The student has finished CS 1110 and MATH 1910/1920, and is taking CS 2110. CS 3410 is a bottleneck that unlocks CS 4410 and CS 5430, so it should come early. MATH 2940 counts toward both the CS major and the Math minor. I should check their school\'s distribution requirements too.',
              text:
                "Here's a solid plan for **Fall 2026** (16 credits):\n\n- **CS 3410** — take this early; it unlocks CS 4410 and CS 5430.\n- **MATH 2940** — counts toward both your CS major and Math minor.\n- **CS 3110** — required core; your prereq CS 2110 is in progress.\n- **CS 4820** — satisfies a CS elective and the Math-minor upper-level rule at once.\n\n⚠️ CS 3410 + CS 3110 is a heavy systems/theory term — pair it with a lighter breadth course. Want me to check your distribution requirements next?",
            },
          };
        case 'RMP_LOOKUP': {
          // Fabricate a deterministic rating from the name so the demo panel is populated.
          const name = String(req.instructorName ?? '');
          const h = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
          const rating = 2.5 + (h % 25) / 10; // 2.5–5.0
          const [first = name, ...rest] = name.replace(',', '').split(' ');
          return {
            ok: true,
            data: {
              needsSetup: false,
              entry: {
                teacher: {
                  teacherId: `t-${h}`,
                  firstName: first,
                  lastName: rest.join(' ') || '',
                  department: 'Demo Dept',
                  avgRating: Math.round(rating * 10) / 10,
                  avgDifficulty: 2 + (h % 30) / 10,
                  wouldTakeAgainPercent: 40 + (h % 60),
                  numRatings: 10 + (h % 90),
                  topComments: [
                    { quality: 5, difficulty: 3, courseName: null, text: 'Clear lectures and fair grading. (demo comment)', date: '2026-01-01', thumbsUp: 3 },
                  ],
                },
                candidates: [],
                uncertain: h % 5 === 0,
                fetchedAt: Date.now(),
              },
            },
          };
        }
        default:
          return { ok: true, data: null };
      }
    },
    openOptionsPage() {
      alert('In the real extension this opens the Options page.');
    },
    getURL: (p: string) => p,
  },
  tabs: { async create() {} },
  permissions: { async request() { return true; } },
};

(globalThis as unknown as { chrome: unknown }).chrome = chromeStub;
