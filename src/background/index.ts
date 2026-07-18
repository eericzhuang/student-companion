/**
 * Background service worker: single storage writer + message router.
 * Stateless by design (MV3 kills idle workers); every handler reads what it
 * needs from storage.
 */
import type { ExtRequest, ExtResponse } from './messages';
import { getAllStored, migrateStorage, setStored, updateStored } from '../shared/storage';
import { lookupInstructor, setOverride, sweepCache } from './rmp/lookup';
import { searchSchools, searchTeachers } from './rmp/client';
import {
  chatAdvisor,
  parseDegreeText,
  parseTranscriptWithClaude,
  researchDegreeRequirements,
  researchPrerequisites,
  testAiConnection,
} from './claude/client';
import { heuristicParseDegree } from './degreeHeuristic';
import { fetchWalkingRoute, geocodeBuildings, setCampusMap } from './map';
import { handleRegistrationAlarm, REG_ALARM_PREFIX, syncRegistrationAlarms } from './reminders';
import { activateLicense, refreshLicense } from './billing';
import { parseTranscriptText } from '../shared/transcript';
import { aiCallStatus, isSupreme } from '../shared/plan';
import { STORAGE_DEFAULTS } from '../shared/types';
import type { AiFeature, AiHistoryEntry, DegreeProgram, ScheduleSnapshot, StoredDegree } from '../shared/types';

const AI_HISTORY_CAP = 50;

/** Append an AI-feature result to the saved history (newest first, capped). */
async function recordAiHistory(
  feature: AiFeature,
  title: string,
  detail: string,
  degree?: DegreeProgram,
): Promise<void> {
  const entry: AiHistoryEntry = {
    id: crypto.randomUUID(),
    at: Date.now(),
    feature,
    title,
    detail,
    ...(degree ? { degree } : {}),
  };
  await updateStored('aiHistory', (h) => [entry, ...h].slice(0, AI_HISTORY_CAP));
}

/** Compact a parsed degree into a readable history detail string. */
function summarizeDegree(d: { name: string; totalCredits: number | null; groups: unknown[] }): string {
  return `${d.name}\n${d.groups.length} requirement group(s)${
    d.totalCredits ? ` · ${d.totalCredits} total credits` : ''
  }`;
}

chrome.runtime.onInstalled.addListener((details) => {
  void migrateStorage();
  void syncRegistrationAlarms();
  void chrome.alarms.create('rmp-cache-sweep', { periodInMinutes: 24 * 60 });
  // Re-verify the paid subscription daily (no-op in free-beta mode).
  void chrome.alarms.create('license-refresh', { periodInMinutes: 24 * 60 });
  // First-run onboarding: everything needs the school picked in Options first.
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('src/options/index.html') });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'rmp-cache-sweep') void sweepCache();
  if (alarm.name === 'license-refresh') void refreshLicense();
  if (alarm.name.startsWith(REG_ALARM_PREFIX)) void handleRegistrationAlarm(alarm.name);
});

// Alarms persist across worker restarts, but re-sync on browser startup in
// case terms were edited while alarms were pending (belt and suspenders).
chrome.runtime.onStartup.addListener(() => void syncRegistrationAlarms());

// Open the planner page when the toolbar icon is clicked
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('src/planner/index.html') });
});

/** Throw a friendly error if AI isn't available for the current plan/license state. */
function requireAi(status: ReturnType<typeof aiCallStatus>, feature: string): void {
  if (status.ok) return;
  throw new Error(
    status.reason === 'not-pro'
      ? `${feature} is a Pro feature. Upgrade to Pro to use it.`
      : status.reason === 'needs-license'
        ? `Your subscription isn't activated on this device — open the Upgrade page and paste your activation code.`
        : `Pro is active, but AI needs a Claude API key configured in Options for now.`,
  );
}

/** The web-research features fan out into many searches/fetches — Supreme only. */
function requireSupreme(settings: Parameters<typeof isSupreme>[0], feature: string): void {
  if (isSupreme(settings)) return;
  throw new Error(`${feature} is a Supreme feature (it runs deep web research). Upgrade to Supreme to use it.`);
}

/**
 * Every distinct Workday saved schedule the student opens becomes (or
 * refreshes) its own plan in the calendar's Plans tab, named by the page
 * title — open "Schedule 1" then "Schedule 2" and both are ready to compare.
 */
async function upsertCapturedPlan(snapshot: ScheduleSnapshot): Promise<void> {
  const name = snapshot.termLabel?.trim();
  if (!name || snapshot.sections.length === 0) return;
  await updateStored('scenarios', (cur) => {
    const existing = cur.find((s) => s.name === name);
    // unchanged content → no storage churn on every page visit
    if (existing && JSON.stringify(existing.snapshot.sections) === JSON.stringify(snapshot.sections)) {
      return cur;
    }
    const scenario = { id: existing?.id ?? crypto.randomUUID(), name, snapshot, createdAt: Date.now() };
    return [...cur.filter((s) => s.name !== name), scenario].slice(-20);
  });
}

async function handle(req: ExtRequest, trusted: boolean): Promise<unknown> {
  switch (req.kind) {
    case 'SCHEDULE_CAPTURED': {
      // A named capture is a saved schedule — track it as a plan either way.
      await upsertCapturedPlan(req.snapshot);
      // Interception beats DOM; a fresh DOM capture may replace a stale intercept
      const current = (await getAllStored()).schedule;
      if (
        current &&
        current.source === 'intercept' &&
        req.snapshot.source === 'dom' &&
        Date.now() - current.capturedAt < 60_000
      ) {
        return null;
      }
      await setStored('schedule', req.snapshot);
      return null;
    }
    case 'HISTORY_CAPTURED': {
      const current = (await getAllStored()).academicHistory;
      // An explicit upload should never be silently overwritten by a scrape.
      if (current?.source === 'upload') return null;
      // Never replace a richer capture with a sparser one from the same source
      if (current && current.courses.length > req.history.courses.length * 2) return null;
      await setStored('academicHistory', req.history);
      return null;
    }
    case 'SCHEDULE_SET':
      await setStored('schedule', req.snapshot);
      return null;
    case 'HISTORY_SET':
      await setStored('academicHistory', req.history);
      return null;
    case 'TRANSCRIPT_PARSE': {
      const { settings } = await getAllStored();
      if (aiCallStatus(settings).ok) {
        const courses = await parseTranscriptWithClaude(req.text);
        await recordAiHistory(
          'transcript-parse',
          `Parsed transcript — ${courses.length} course(s)`,
          courses.map((c) => `${c.code}${c.grade ? ` (${c.grade})` : ''}`).join(', '),
        );
        return { courses, method: 'claude' as const };
      }
      return { courses: parseTranscriptText(req.text), method: 'heuristic' as const };
    }
    case 'RMP_LOOKUP':
      return lookupInstructor(req.instructorName);
    case 'RMP_SEARCH_TEACHERS': {
      const { settings } = await getAllStored();
      if (!settings.rmpSchool) return { teachers: [] };
      return { teachers: await searchTeachers(req.query, settings.rmpSchool.id) };
    }
    case 'RMP_SET_OVERRIDE':
      return { entry: await setOverride(req.instructorName, req.teacherId) };
    case 'RMP_SEARCH_SCHOOLS':
      return { schools: await searchSchools(req.query) };
    case 'SETTINGS_UPDATE': {
      const patch = { ...req.patch };
      if (!trusted) {
        // Content scripts run inside Workday pages; never let that context
        // change entitlements or the stored license.
        delete patch.plan;
        delete patch.admin;
        delete patch.licenseToken;
      }
      await updateStored('settings', (s) => ({ ...s, ...patch }));
      // Term dates changed → recompute registration reminder alarms.
      if (patch.terms) await syncRegistrationAlarms();
      return null;
    }
    case 'PANEL_STATE_UPDATE':
      await updateStored('settings', (s) => ({ ...s, panelState: req.panelState }));
      return null;
    case 'DEGREE_PARSE': {
      const { settings } = await getAllStored();
      // AI parsing is Pro-only; free users get the rule-based parser.
      if (aiCallStatus(settings).ok) {
        const degree = await parseDegreeText(req.pageText);
        await recordAiHistory('degree-parse', `Parsed degree — ${degree.name}`, summarizeDegree(degree), degree);
        return { degree, method: 'claude' as const };
      }
      return { degree: heuristicParseDegree(req.pageText), method: 'heuristic' as const };
    }
    case 'AI_CHAT': {
      const { settings } = await getAllStored();
      requireAi(aiCallStatus(settings), 'The AI advisor');
      const reply = await chatAdvisor(req.context, req.messages);
      const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
      await recordAiHistory(
        'chat',
        `Advisor: ${lastUser?.content.slice(0, 60) ?? 'question'}${(lastUser?.content.length ?? 0) > 60 ? '…' : ''}`,
        reply.text,
      );
      return reply;
    }
    case 'DEGREE_RESEARCH': {
      const { settings } = await getAllStored();
      requireSupreme(settings, 'Auto-find degree requirements');
      requireAi(aiCallStatus(settings), 'AI degree research');
      const degree = await researchDegreeRequirements(req.school, req.program);
      // Keep the full program in the entry so history can show every requirement.
      await recordAiHistory(
        'degree-research',
        `Researched: ${req.program} @ ${req.school}`,
        summarizeDegree(degree),
        degree,
      );
      return { degree };
    }
    case 'PREREQ_RESEARCH': {
      const { settings } = await getAllStored();
      requireSupreme(settings, 'Auto-find prerequisites');
      requireAi(aiCallStatus(settings), 'AI prerequisite lookup');
      const result = await researchPrerequisites(req.school, req.course);
      await recordAiHistory(
        'prereq-research',
        `Prereqs for ${req.course} @ ${req.school}`,
        `Requires: ${result.prereqs.join(', ') || '(none found)'}${
          result.equivalents.length ? `\nEquivalents: ${result.equivalents.join(', ')}` : ''
        }${result.note ? `\n${result.note}` : ''}`,
      );
      return result;
    }
    case 'REQ_OVERRIDE_SET':
      await updateStored('reqOverrides', (m) => {
        const next = { ...m };
        if (req.value === null) delete next[req.key];
        else next[req.key] = req.value;
        return next;
      });
      return null;
    case 'MAP_GEOCODE':
      // Free for everyone: OpenStreetMap Nominatim, rate-limited + cached.
      return geocodeBuildings(req.buildings);
    case 'MAP_ROUTE':
      // Real walking path via the free OSRM demo (cached; no key, no AI).
      return fetchWalkingRoute(req.from, req.to);
    case 'MAP_SET':
      await setCampusMap(req.map);
      return null;
    case 'SCENARIO_SAVE': {
      const scenario = {
        id: crypto.randomUUID(),
        name: req.name.trim() || 'Untitled plan',
        snapshot: req.snapshot,
        createdAt: Date.now(),
      };
      await updateStored('scenarios', (cur) => [...cur, scenario].slice(-20));
      return scenario;
    }
    case 'SCENARIO_DELETE':
      await updateStored('scenarios', (cur) => cur.filter((s) => s.id !== req.id));
      return null;
    case 'SCENARIO_LOAD': {
      const { scenarios, schedule } = await getAllStored();
      const hit = scenarios.find((s) => s.id === req.id);
      if (!hit) throw new Error('That plan no longer exists.');
      // Don't let a load destroy unsaved work: if the current schedule isn't
      // stored in any scenario, stash it automatically first.
      if (schedule && schedule.sections.length > 0) {
        const cur = JSON.stringify(schedule.sections);
        if (!scenarios.some((s) => JSON.stringify(s.snapshot.sections) === cur)) {
          await updateStored('scenarios', (list) =>
            [
              ...list,
              {
                id: crypto.randomUUID(),
                name: `Auto-saved before "${hit.name}"`,
                snapshot: schedule,
                createdAt: Date.now(),
              },
            ].slice(-20),
          );
        }
      }
      await setStored('schedule', { ...hit.snapshot, capturedAt: Date.now() });
      return null;
    }
    case 'BACKUP_IMPORT': {
      const data = req.data;
      if (typeof data !== 'object' || data === null || typeof data.schemaVersion !== 'number') {
        throw new Error("That file doesn't look like a Student Companion backup.");
      }
      // Restore only known keys so a crafted file can't plant extras.
      const patch: Record<string, unknown> = {};
      for (const key of Object.keys(STORAGE_DEFAULTS)) {
        if (key in data) patch[key] = (data as Record<string, unknown>)[key];
      }
      await chrome.storage.local.set(patch);
      await migrateStorage();
      return { restored: Object.keys(patch) };
    }
    case 'AI_TEST':
      // Deliberately ungated: a key-format/network diagnostic (4 max_tokens on
      // the cheapest model) has to work BEFORE the user upgrades, so they can
      // verify their key will function. Cost is a fraction of a cent.
      return testAiConnection();
    case 'LICENSE_ACTIVATE':
      return activateLicense(req.code);
    case 'AI_HISTORY_CLEAR':
      await setStored('aiHistory', []);
      return null;
    case 'AI_HISTORY_REMOVE': {
      const ids = new Set(req.ids);
      await updateStored('aiHistory', (h) => h.filter((e) => !ids.has(e.id)));
      return null;
    }
    case 'DEGREE_SAVE': {
      const id = req.id ?? crypto.randomUUID();
      const degree: StoredDegree = {
        ...req.degree,
        id,
        sourceUrl: req.sourceUrl,
        parsedAt: Date.now(),
        userEdited: req.userEdited,
      };
      // Auto-include FIRST, then write the degree: UIs reload on the `degrees`
      // change, so includedDegreeIds must already contain the new id by then
      // (otherwise a fresh degree can be filtered out of Progress).
      await updateStored('plannerState', (p) =>
        p.includedDegreeIds.includes(id)
          ? p
          : { ...p, includedDegreeIds: [...p.includedDegreeIds, id] },
      );
      await updateStored('degrees', (d) => ({ ...d, [id]: degree }));
      return { degree };
    }
    case 'DEGREE_DELETE':
      await updateStored('degrees', (d) => {
        const next = { ...d };
        delete next[req.id];
        return next;
      });
      await updateStored('plannerState', (p) => ({
        ...p,
        includedDegreeIds: p.includedDegreeIds.filter((x) => x !== req.id),
      }));
      return null;
    case 'PLANNER_STATE_UPDATE':
      await setStored('plannerState', req.state);
      return null;
    case 'PREREQ_SET':
      await updateStored('prereqOverrides', (p) => ({ ...p, [req.code]: req.prereqs }));
      return null;
    case 'PREREQ_DELETE':
      await updateStored('prereqOverrides', (p) => {
        const next = { ...p };
        delete next[req.code];
        return next;
      });
      return null;
    case 'EQUIV_SET':
      await updateStored('courseEquivalents', (m) => ({ ...m, [req.code]: req.equivalents }));
      return null;
    case 'EQUIV_DELETE':
      await updateStored('courseEquivalents', (m) => {
        const next = { ...m };
        delete next[req.code];
        return next;
      });
      return null;
    case 'OPEN_PLANNER':
      await chrome.tabs.create({ url: chrome.runtime.getURL('src/planner/index.html') });
      return null;
    case 'OPEN_SUBSCRIBE':
      await chrome.tabs.create({ url: chrome.runtime.getURL('src/subscribe/index.html') });
      return null;
  }
}

chrome.runtime.onMessage.addListener(
  (req: ExtRequest, sender, sendResponse: (res: ExtResponse) => void) => {
    // Extension pages (options/planner/subscribe) are trusted; content scripts
    // inside Workday pages are not — they report sender.url as the web page.
    const trusted = sender.url?.startsWith(chrome.runtime.getURL('')) ?? false;
    handle(req, trusted)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err: unknown) => {
        console.warn('[wd-companion] handler failed', req.kind, err);
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true; // async response
  },
);
