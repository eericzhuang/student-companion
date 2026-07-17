/**
 * Typed message protocol between contexts and the background service worker.
 * All storage writes flow through here so the background is the single writer.
 */
import type {
  AcademicHistory,
  CampusMap,
  DegreeProgram,
  PanelState,
  PlannerState,
  ReqOverrideValue,
  RmpCacheEntry,
  RmpSchool,
  ScheduleSnapshot,
  Settings,
  StoredDegree,
  HistoryCourse,
} from '../shared/types';

export type ExtRequest =
  // --- data capture (from content script) ---
  | { kind: 'SCHEDULE_CAPTURED'; snapshot: ScheduleSnapshot }
  | { kind: 'HISTORY_CAPTURED'; history: AcademicHistory }
  // --- explicit overwrite (manual capture / upload; always wins) ---
  | { kind: 'SCHEDULE_SET'; snapshot: ScheduleSnapshot }
  | { kind: 'HISTORY_SET'; history: AcademicHistory }
  | { kind: 'TRANSCRIPT_PARSE'; text: string }
  // --- RMP (from content script) ---
  | { kind: 'RMP_LOOKUP'; instructorName: string }
  | { kind: 'RMP_SEARCH_TEACHERS'; query: string }
  | { kind: 'RMP_SET_OVERRIDE'; instructorName: string; teacherId: string }
  | { kind: 'RMP_SEARCH_SCHOOLS'; query: string }
  // --- settings (from options/content UI) ---
  | { kind: 'SETTINGS_UPDATE'; patch: Partial<Settings> }
  | { kind: 'PANEL_STATE_UPDATE'; panelState: PanelState }
  // --- degrees / planner (from planner page) ---
  | { kind: 'DEGREE_PARSE'; pageText: string; sourceUrl: string | null }
  | { kind: 'DEGREE_RESEARCH'; school: string; program: string }
  | { kind: 'PREREQ_RESEARCH'; school: string; course: string }
  | { kind: 'AI_CHAT'; context: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> }
  | { kind: 'DEGREE_SAVE'; degree: DegreeProgram; id: string | null; sourceUrl: string | null; userEdited: boolean }
  | { kind: 'DEGREE_DELETE'; id: string }
  | { kind: 'PLANNER_STATE_UPDATE'; state: PlannerState }
  | { kind: 'PREREQ_SET'; code: string; prereqs: string[] }
  | { kind: 'PREREQ_DELETE'; code: string }
  | { kind: 'EQUIV_SET'; code: string; equivalents: string[] }
  | { kind: 'EQUIV_DELETE'; code: string }
  | { kind: 'REQ_OVERRIDE_SET'; key: string; value: ReqOverrideValue | null }
  // --- campus map (walk-time warnings) ---
  | { kind: 'MAP_GEOCODE'; buildings: string[] }
  | { kind: 'MAP_ROUTE'; from: { lat: number; lng: number }; to: { lat: number; lng: number } }
  | { kind: 'MAP_SET'; map: CampusMap }
  | { kind: 'AI_TEST' }
  // --- billing (only when a billing backend is configured) ---
  | { kind: 'LICENSE_ACTIVATE'; code: string }
  | { kind: 'AI_HISTORY_CLEAR' }
  | { kind: 'AI_HISTORY_REMOVE'; ids: string[] }
  // --- navigation ---
  | { kind: 'OPEN_PLANNER' }
  | { kind: 'OPEN_SUBSCRIBE' };

export type ExtResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

export interface MapLookupResult {
  map: CampusMap;
  /** buildings still without coordinates after the lookup */
  missing: string[];
}

export interface RmpLookupResult {
  entry: RmpCacheEntry | null;
  /** true when no RMP school is configured yet */
  needsSetup: boolean;
}

export interface RmpSchoolSearchResult {
  schools: Array<RmpSchool & { city: string | null; state: string | null; numRatings: number }>;
}

export interface DegreeParseResult {
  degree: DegreeProgram;
  /** which parser produced this — 'heuristic' means no API key was set */
  method: 'claude' | 'heuristic';
}

export interface DegreeSaveResult {
  degree: StoredDegree;
}

export interface TranscriptParseResult {
  courses: HistoryCourse[];
  method: 'claude' | 'heuristic';
}

export interface ChatResult {
  text: string;
  thinking: string;
}

export interface DegreeResearchResult {
  degree: DegreeProgram;
}

export interface PrereqResearchResult {
  prereqs: string[];
  equivalents: string[];
  note: string | null;
}

/** Send a request to the background and unwrap the typed response. */
export async function sendToBackground<T = unknown>(req: ExtRequest): Promise<T> {
  const res = (await chrome.runtime.sendMessage(req)) as ExtResponse | undefined;
  if (!res) throw new Error('No response from background (service worker unavailable)');
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
}
