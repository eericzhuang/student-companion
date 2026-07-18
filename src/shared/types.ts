/** Core data model shared across background, content, options, and planner contexts. */

/** Day-of-week bitmask: Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64 */
export type DayMask = number;

export const DAYS = {
  MON: 1,
  TUE: 2,
  WED: 4,
  THU: 8,
  FRI: 16,
  SAT: 32,
  SUN: 64,
} as const;

export interface Meeting {
  /** Bitmask of days this meeting occurs on */
  days: DayMask;
  /** Minutes since midnight, e.g. 600 = 10:00 AM */
  startMin: number;
  endMin: number;
  location?: string;
}

export interface Section {
  /** Workday section identifier, e.g. "CS 2110-001" or automation-id derived */
  sectionId: string;
  courseCode: string;
  title: string;
  credits: number | null;
  instructor: string | null;
  meetings: Meeting[];
}

export interface ScheduleSnapshot {
  termLabel: string | null;
  sections: Section[];
  capturedAt: number;
  source: 'intercept' | 'dom' | 'upload';
}

export type CourseStatus = 'completed' | 'in-progress' | 'withdrawn' | 'unknown';

export interface HistoryCourse {
  code: string;
  title: string;
  credits: number | null;
  grade: string | null;
  term: string | null;
  status: CourseStatus;
}

export interface AcademicHistory {
  courses: HistoryCourse[];
  capturedAt: number;
  source: 'intercept' | 'dom' | 'upload';
}

// ---------- RateMyProfessors ----------

export interface RmpComment {
  quality: number | null;
  difficulty: number | null;
  courseName: string | null;
  text: string;
  date: string | null;
  thumbsUp: number;
}

export interface RmpTeacher {
  teacherId: string;
  firstName: string;
  lastName: string;
  department: string | null;
  avgRating: number | null;
  avgDifficulty: number | null;
  wouldTakeAgainPercent: number | null;
  numRatings: number;
  topComments: RmpComment[];
}

export interface RmpCacheEntry {
  teacher: RmpTeacher | null; // null = looked up, no match found
  /** Other plausible candidates when the match was uncertain */
  candidates: Array<Pick<RmpTeacher, 'teacherId' | 'firstName' | 'lastName' | 'department' | 'avgRating' | 'numRatings'>>;
  uncertain: boolean;
  fetchedAt: number;
}

export interface RmpSchool {
  id: string; // RMP graphql node id (base64)
  name: string;
}

// ---------- Campus map (building coordinates for walk-time warnings) ----------

export interface CampusBuilding {
  lat: number;
  lng: number;
  /** where the coordinates came from: free OSM geocoding, AI research, or the user */
  source: 'osm' | 'ai' | 'manual';
}

export interface CampusMap {
  /** school name the coordinates were resolved against; a change invalidates them */
  school: string | null;
  /** the school's own coordinates — geocoded once, bounds building searches to campus */
  center?: { lat: number; lng: number };
  /** building name (room stripped) -> coordinates */
  buildings: Record<string, CampusBuilding>;
}

// ---------- Degree planner ----------

export type RequirementRuleKind = 'all' | 'chooseN' | 'credits';

export interface RequirementCourse {
  code: string;
  title: string | null;
  credits: number | null;
  /** Course codes that must be completed before this one */
  prereqCodes: string[];
  /** Alternative course codes that also satisfy this requirement ("X or Y",
   *  AP/transfer equivalents). Optional for backward compatibility. */
  equivalents?: string[];
}

export interface RequirementGroup {
  title: string;
  rule: {
    kind: RequirementRuleKind;
    /** for chooseN */
    n?: number;
    /** for credits */
    credits?: number;
  };
  courses: RequirementCourse[];
  notes: string | null;
}

export interface DegreeProgram {
  name: string;
  type: 'major' | 'minor' | 'certificate' | 'other';
  totalCredits: number | null;
  groups: RequirementGroup[];
}

export interface StoredDegree extends DegreeProgram {
  id: string;
  sourceUrl: string | null;
  parsedAt: number;
  userEdited: boolean;
}

// ---------- Settings ----------

export interface TermConfig {
  id: string;
  label: string; // e.g. "Fall 2026"
  creditCap: number;
  /** ISO yyyy-mm-dd first/last day of classes — used for calendar (.ics) export */
  startDate?: string;
  endDate?: string;
}

export interface PanelState {
  x: number;
  y: number;
  collapsed: boolean;
}

export interface Settings {
  rmpSchool: RmpSchool | null;
  claudeApiKey: string | null;
  claudeModel: 'claude-sonnet-5' | 'claude-haiku-4-5';
  panelState: PanelState;
  terms: TermConfig[];
  /** logical selector name -> user-provided CSS selector candidates (tried before defaults) */
  selectorOverrides: Record<string, string[]>;
  /** show RMP badges */
  rmpEnabled: boolean;
  /** show the calendar panel */
  calendarEnabled: boolean;
  /** show the floating capture button on Workday pages */
  captureWidgetEnabled: boolean;
  /** subscription tier — 'pro' unlocks AI features; 'supreme' adds the
   *  token-heavy web-research features (degree & prerequisite auto-find) */
  plan: 'free' | 'pro' | 'supreme';
  /** owner/admin unlock — grants Pro regardless of plan (for the app owner) */
  admin: boolean;
  /** Stripe activation code (checkout session id) once real billing is live;
   *  re-verified daily against the billing backend */
  licenseToken: string | null;
  /** owner-pinned level theme (1–10); unset = theme follows the real level.
   *  Only honored when admin is true — progress numbers always stay real. */
  themeLevel?: number;
  /** walking speed for between-class route warnings, km/h (default 4.8) */
  walkSpeedKmh?: number;
}

export const DEFAULT_SETTINGS: Settings = {
  rmpSchool: null,
  claudeApiKey: null,
  claudeModel: 'claude-sonnet-5',
  panelState: { x: -1, y: -1, collapsed: false },
  terms: [],
  selectorOverrides: {},
  rmpEnabled: true,
  calendarEnabled: true,
  captureWidgetEnabled: true,
  plan: 'free',
  admin: false,
  licenseToken: null,
};

// ---------- Planner state ----------

export interface PlannerState {
  includedDegreeIds: string[];
  /** courseCode -> termId assignment for future terms */
  assignments: Record<string, string>;
  /** user-chosen display order of degree ids; unlisted ids sort last (absent on old data) */
  degreeOrder?: string[];
  /** saved What-if tryout course codes (hypothetical, never counted as real) */
  whatIfCourses?: string[];
  /** highest level the level-up celebration has already played for */
  seenLevel?: number;
  /** the beginner guide was completed or skipped — don't auto-open it again */
  guideSeen?: boolean;
}

// ---------- AI history ----------

export type AiFeature =
  | 'chat'
  | 'degree-research'
  | 'prereq-research'
  | 'degree-parse'
  | 'transcript-parse';

/** One record of an AI-powered action, saved so users can review past results. */
export interface AiHistoryEntry {
  id: string;
  at: number;
  feature: AiFeature;
  /** short one-line label, e.g. "Researched: B.S. Computer Science @ Cornell" */
  title: string;
  /** the full result text (advisor reply, JSON summary, etc.) */
  detail: string;
  /** for degree research/imports: the full parsed program, so the history
   *  entry can expand to show every requirement group (absent on old entries) */
  degree?: DegreeProgram;
}

// ---------- Schedule scenarios ----------

/** A saved candidate schedule ("Plan A" / "Plan B") for later compare/restore. */
export interface Scenario {
  id: string;
  name: string;
  snapshot: ScheduleSnapshot;
  createdAt: number;
}

// ---------- Storage root ----------

export interface StorageShape {
  schemaVersion: number;
  settings: Settings;
  schedule: ScheduleSnapshot | null;
  academicHistory: AcademicHistory | null;
  rmpCache: Record<string, RmpCacheEntry>;
  rmpOverrides: Record<string, string>; // normalized name -> teacherId
  degrees: Record<string, StoredDegree>;
  plannerState: PlannerState;
  /** user-supplied prerequisites: course code -> codes that must come first */
  prereqOverrides: Record<string, string[]>;
  /** user-supplied equivalents: course code -> codes that also satisfy it */
  courseEquivalents: Record<string, string[]>;
  /** log of AI-feature results, newest first (capped) */
  aiHistory: AiHistoryEntry[];
  /** manual requirement-group overrides: "degreeId::groupTitle" -> verdict or count */
  reqOverrides: Record<string, ReqOverrideValue>;
  /** building coordinates for the campus map & walk-time warnings */
  campusMap: CampusMap;
  /** saved candidate schedules (Plan A / Plan B) */
  scenarios: Scenario[];
}

/**
 * A student's manual override for one requirement group: a full verdict
 * (met/unmet), or "this many courses/credits are already completed" when the
 * computed progress undercounts (e.g. courses the extension can't see).
 */
export type ReqOverrideValue = 'met' | 'unmet' | { done: number };

export const STORAGE_DEFAULTS: StorageShape = {
  schemaVersion: 1,
  settings: DEFAULT_SETTINGS,
  schedule: null,
  academicHistory: null,
  rmpCache: {},
  rmpOverrides: {},
  degrees: {},
  plannerState: { includedDegreeIds: [], assignments: {} },
  prereqOverrides: {},
  courseEquivalents: {},
  aiHistory: [],
  reqOverrides: {},
  campusMap: { school: null, buildings: {} },
  scenarios: [],
};
