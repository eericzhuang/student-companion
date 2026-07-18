/**
 * Options page: RMP school picker, Claude API key, model choice, feature
 * toggles, future terms, and advanced selector overrides.
 */
import { watchPageDark } from '../shared/appearance';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { AcademicHistory, CampusMap, HistoryCourse, RmpSchool, Settings, TermConfig } from '../shared/types';
import { getStored } from '../shared/storage';
import {
  sendToBackground,
  type RmpSchoolSearchResult,
  type TranscriptParseResult,
} from '../background/messages';
import { isPro, isSupreme } from '../shared/plan';
import { billingEnabled } from '../shared/billing';
import { extractPdfText } from './pdf';

function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getStored('settings').then(setSettings);
  }, []);

  if (!settings) return <div class="pl-shell">Loading…</div>;

  const patch = async (p: Partial<Settings>) => {
    const next = { ...settings, ...p };
    setSettings(next);
    await sendToBackground({ kind: 'SETTINGS_UPDATE', patch: p });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div class="pl-shell" style={{ maxWidth: '760px' }}>
      <div class="pl-header">
        <h1>⚙ Student Companion for Workday</h1>
        {saved && <span class="pl-degree-tag">saved ✓</span>}
      </div>

      <SubscriptionSection settings={settings} />
      <FeatureToggles settings={settings} patch={patch} />
      <SchoolPicker settings={settings} patch={patch} />
      <AcademicHistorySection />
      <ApiKeySection settings={settings} patch={patch} />
      <TermSection settings={settings} patch={patch} />
      <CampusMapSection settings={settings} patch={patch} />
      <AdvancedSelectors settings={settings} patch={patch} />
      <FeedbackSection settings={settings} />
      <AdminSection settings={settings} patch={patch} />
      <BackupSection />
      <p class="pl-muted" style={{ textAlign: 'center', marginTop: '18px' }}>
        Something broken, or a school layout we don't recognize?{' '}
        <a href="mailto:eric2007118@gmail.com?subject=Student%20Companion%20support">
          Email support
        </a>{' '}
        — include the Diagnostics info from the on-page Data capture widget if you can.
        <br />
        Independent project — not affiliated with, endorsed by, or sponsored by Workday, Inc. or
        RateMyProfessors.
      </p>
    </div>
  );
}

interface SectionProps {
  settings: Settings;
  patch: (p: Partial<Settings>) => Promise<void>;
}

function FeatureToggles({ settings, patch }: SectionProps) {
  return (
    <div class="pl-card">
      <h2>Features</h2>
      <label style={{ display: 'block', margin: '6px 0' }}>
        <input
          type="checkbox"
          checked={settings.calendarEnabled}
          onChange={(e) => void patch({ calendarEnabled: (e.target as HTMLInputElement).checked })}
        />{' '}
        Show the floating schedule calendar on Find Course Sections
      </label>
      <label style={{ display: 'block', margin: '6px 0' }}>
        <input
          type="checkbox"
          checked={settings.rmpEnabled}
          onChange={(e) => void patch({ rmpEnabled: (e.target as HTMLInputElement).checked })}
        />{' '}
        Show RateMyProfessors badges next to instructors
      </label>
      <label style={{ display: 'block', margin: '6px 0' }}>
        <input
          type="checkbox"
          checked={settings.captureWidgetEnabled}
          onChange={(e) => void patch({ captureWidgetEnabled: (e.target as HTMLInputElement).checked })}
        />{' '}
        Show the floating “Capture” button on Workday pages
      </label>
      <div style={{ margin: '10px 0 2px' }}>
        🌙 Appearance:{' '}
        {(['auto', 'light', 'dark'] as const).map((a) => (
          <label style={{ marginRight: '12px' }}>
            <input
              type="radio"
              name="pl-appearance"
              checked={(settings.appearance ?? 'auto') === a}
              onChange={() => void patch({ appearance: a })}
            />{' '}
            {a === 'auto' ? 'Match system' : a === 'light' ? 'Light' : 'Dark'}
          </label>
        ))}
      </div>
    </div>
  );
}

function SchoolPicker({ settings, patch }: SectionProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RmpSchoolSearchResult['schools']>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await sendToBackground<RmpSchoolSearchResult>({
        kind: 'RMP_SEARCH_SCHOOLS',
        query,
      });
      setResults(res.schools);
      if (res.schools.length === 0) setError('No schools found for that name.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const pick = (school: RmpSchool) => {
    void patch({ rmpSchool: school });
    setResults([]);
    setQuery('');
  };

  return (
    <div class="pl-card">
      <h2>Your school (RateMyProfessors)</h2>
      {settings.rmpSchool ? (
        <p>
          Selected: <b>{settings.rmpSchool.name}</b>{' '}
          <button class="pl-btn secondary" onClick={() => void patch({ rmpSchool: null })}>
            change
          </button>
        </p>
      ) : (
        <p class="pl-muted">
          Pick your school once so professor lookups search the right campus.
        </p>
      )}
      {!settings.rmpSchool && (
        <>
          <div class="pl-row">
            <input
              type="text"
              placeholder="Search school name…"
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => e.key === 'Enter' && query.trim() && void search()}
            />
            <button class="pl-btn" onClick={() => void search()} disabled={busy || !query.trim()}>
              {busy ? 'Searching…' : 'Search'}
            </button>
          </div>
          {error && <div class="pl-error">{error}</div>}
          {results.map((s) => (
            <button class="pl-btn secondary" style={{ display: 'block', width: '100%', textAlign: 'left', margin: '4px 0' }} onClick={() => pick({ id: s.id, name: s.name })}>
              <b>{s.name}</b>
              {s.city ? ` — ${s.city}${s.state ? `, ${s.state}` : ''}` : ''}{' '}
              <span class="pl-muted">({s.numRatings} ratings)</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

const EMPTY_COURSE: HistoryCourse = {
  code: '',
  title: '',
  credits: null,
  grade: null,
  term: null,
  status: 'completed',
};

function AcademicHistorySection() {
  const [current, setCurrent] = useState<AcademicHistory | null>(null);
  const [text, setText] = useState('');
  // Editable working set: parsed from a transcript, or loaded from stored history.
  const [editRows, setEditRows] = useState<HistoryCourse[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getStored('academicHistory').then(setCurrent);
  }, []);

  const editField = (i: number, patch: Partial<HistoryCourse>) =>
    setEditRows((rows) => rows!.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const onFile = async (file: File) => {
    setError(null);
    setBusy(file.type === 'application/pdf' || file.name.endsWith('.pdf') ? 'Reading PDF…' : 'Reading file…');
    try {
      const raw =
        file.type === 'application/pdf' || file.name.endsWith('.pdf')
          ? await extractPdfText(file)
          : await file.text();
      setText(raw);
      await parse(raw);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const parse = async (raw: string) => {
    if (raw.trim().length < 20) {
      setError('That file/text has too little content to parse.');
      setBusy(null);
      return;
    }
    setBusy('Parsing transcript…');
    try {
      const res = await sendToBackground<TranscriptParseResult>({ kind: 'TRANSCRIPT_PARSE', text: raw });
      // Merge parsed courses into any existing edit set (dedupe by code+term).
      setEditRows((prev) => {
        const base = prev ?? [];
        const seen = new Set(base.map((c) => `${c.code}|${c.term ?? ''}`));
        const additions = res.courses.filter((c) => !seen.has(`${c.code}|${c.term ?? ''}`));
        return [...base, ...additions];
      });
      if (res.courses.length === 0) setError('No courses were detected. Check the text, or try a different export.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!editRows) return;
    const courses = editRows.filter((c) => c.code.trim());
    const history: AcademicHistory = { courses, capturedAt: Date.now(), source: 'upload' };
    await sendToBackground({ kind: 'HISTORY_SET', history });
    setCurrent(history);
    setEditRows(null);
    setText('');
  };

  return (
    <div class="pl-card">
      <h2>Academic history (upload transcript)</h2>
      <p class="pl-muted">
        Upload your <b>unofficial transcript</b> (PDF) or paste its text. This is the reliable way
        to tell the planner what you've completed — no Workday scraping needed. Parsing happens on
        your device{current ? '' : ''}; with a Claude API key it's more accurate, otherwise a
        built-in parser is used.
      </p>
      <p class="pl-muted">
        <b>Privacy tip:</b> transcript headers often include your name and student ID. With AI
        parsing on, the text is sent to Claude under your own key — delete that header line first
        if you'd rather not send it.
      </p>

      {current && (
        <p class="pl-muted">
          Currently stored: <b>{current.courses.length} courses</b>
          {current.source === 'upload' ? ' (from upload)' : ` (from ${current.source})`} ·{' '}
          {new Date(current.capturedAt).toLocaleDateString()}{' '}
          {!editRows && (
            <button class="pl-link-inline" onClick={() => setEditRows(current.courses.map((c) => ({ ...c })))}>
              edit / adjust
            </button>
          )}
        </p>
      )}

      <div class="pl-row">
        <input
          type="file"
          accept=".pdf,.txt,.csv,text/plain,application/pdf"
          onChange={(e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) void onFile(f);
          }}
        />
      </div>

      <p class="pl-muted" style={{ margin: '8px 0 4px' }}>…or paste transcript text:</p>
      <textarea
        placeholder="Paste your transcript text here…"
        value={text}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
      />
      <div class="pl-row" style={{ marginTop: '6px' }}>
        <button class="pl-btn" onClick={() => void parse(text)} disabled={busy !== null || text.trim().length < 20}>
          Parse
        </button>
        {busy && <span class="pl-muted">⏳ {busy}</span>}
      </div>

      {error && <div class="pl-error">{error}</div>}

      {editRows && (
        <div style={{ marginTop: '10px' }}>
          <p class="pl-muted">
            <b>{editRows.length} courses</b> — edit any field, delete rows, or add your own, then
            save:
          </p>
          <table class="pl-table">
            <thead>
              <tr>
                <th style={{ width: '110px' }}>Course</th>
                <th>Title</th>
                <th style={{ width: '120px' }}>Term</th>
                <th style={{ width: '60px' }}>Grade</th>
                <th style={{ width: '120px' }}>Status</th>
                <th style={{ width: '36px' }} />
              </tr>
            </thead>
            <tbody>
              {editRows.map((c, i) => (
                <tr>
                  <td>
                    <input type="text" value={c.code} onInput={(e) => editField(i, { code: (e.target as HTMLInputElement).value })} />
                  </td>
                  <td>
                    <input type="text" value={c.title} onInput={(e) => editField(i, { title: (e.target as HTMLInputElement).value })} />
                  </td>
                  <td>
                    <input type="text" value={c.term ?? ''} placeholder="Fall 2025" onInput={(e) => editField(i, { term: (e.target as HTMLInputElement).value || null })} />
                  </td>
                  <td>
                    <input type="text" value={c.grade ?? ''} placeholder="A" onInput={(e) => editField(i, { grade: (e.target as HTMLInputElement).value || null })} />
                  </td>
                  <td>
                    <select
                      value={c.status}
                      onChange={(e) => editField(i, { status: (e.target as HTMLSelectElement).value as HistoryCourse['status'] })}
                    >
                      <option value="completed">completed</option>
                      <option value="in-progress">in-progress</option>
                      <option value="withdrawn">withdrawn</option>
                      <option value="unknown">unknown</option>
                    </select>
                  </td>
                  <td>
                    <button class="pl-btn danger" onClick={() => setEditRows((rows) => rows!.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div class="pl-row" style={{ marginTop: '8px' }}>
            <button class="pl-btn secondary" onClick={() => setEditRows((rows) => [...rows!, { ...EMPTY_COURSE }])}>
              + Add course
            </button>
            <button class="pl-btn" onClick={() => void save()}>
              Save academic history
            </button>
            <button class="pl-btn secondary" onClick={() => setEditRows(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SubscriptionSection({ settings }: { settings: Settings }) {
  const pro = isPro(settings);
  const supreme = isSupreme(settings);
  const label = settings.admin ? 'Owner' : supreme ? 'Supreme 👑' : pro ? 'Pro' : 'Free';
  return (
    <div class="pl-card" style={{ borderColor: supreme ? '#7c3aed' : pro ? '#16a34a' : undefined }}>
      <div class="pl-row">
        <h2>
          Subscription — <span class="pl-degree-tag">{label}</span>
        </h2>
        <button class="pl-btn" onClick={() => void sendToBackground({ kind: 'OPEN_SUBSCRIBE' })}>
          {pro ? 'Manage plan' : '✨ Upgrade'}
        </button>
      </div>
      <p class="pl-muted">
        {supreme
          ? 'Supreme is active — everything in Pro plus auto-find degree requirements & prerequisites (deep web research).'
          : pro
            ? 'Pro is active — the AI Semester Advisor and AI parsing are unlocked. Supreme adds auto-find degree/prerequisite research.'
            : 'Free includes the calendar, RateMyProfessors, and the full planner. Pro adds the AI advisor and AI parsing; Supreme adds auto-find web research.'}
      </p>
    </div>
  );
}

function ApiKeySection({ settings, patch }: SectionProps) {
  const [key, setKey] = useState(settings.claudeApiKey ?? '');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await sendToBackground<{ ok: boolean; detail: string }>({ kind: 'AI_TEST' }));
    } catch (err) {
      setTestResult({ ok: false, detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  // AI is Pro-only. Free users can't configure a key at all.
  if (!isPro(settings)) {
    return (
      <div class="pl-card">
        <h2>AI features 🔒</h2>
        <p class="pl-muted">
          AI parsing and the AI semester advisor are <b>Pro</b> features. Upgrade to unlock them —
          no API key to manage.
        </p>
        <button class="pl-btn" onClick={() => void sendToBackground({ kind: 'OPEN_SUBSCRIBE' })}>
          ✨ Upgrade to Pro
        </button>
      </div>
    );
  }

  // Billing live: AI runs through our relay on the subscription — there is no
  // key to enter, so the section reduces to a status + connection test.
  if (billingEnabled()) {
    return (
      <div class="pl-card">
        <h2>AI (Pro) — included with your plan</h2>
        <p class="pl-muted">
          AI runs on our servers as part of your subscription — <b>no API key needed</b>. Each
          plan includes a generous monthly AI allowance; if you somehow use it up, it resets at
          the start of the next month.
        </p>
        <div class="pl-row">
          <button class="pl-btn secondary" disabled={testing} onClick={() => void runTest()}>
            {testing ? 'Testing…' : 'Test AI connection'}
          </button>
        </div>
        {testResult && (
          <div
            class={testResult.ok ? 'pl-muted' : 'pl-error'}
            style={testResult.ok ? { color: '#166534', fontSize: '13px', margin: '8px 0' } : {}}
          >
            {testResult.detail}
          </div>
        )}
      </div>
    );
  }

  return (
    <div class="pl-card">
      <h2>AI (Pro) — Claude API key</h2>
      <p class="pl-muted">
        You're on <b>Pro</b> (beta). During the beta, AI uses a Claude API key you provide. The
        key is sent only to api.anthropic.com and stored unencrypted on this device — use a key
        with a spend limit. Get one at console.anthropic.com. At launch this disappears: AI will
        be included with the subscription, no key needed.
      </p>
      <div class="pl-row">
        <input
          type="password"
          placeholder="sk-ant-…"
          value={key}
          onInput={(e) => setKey((e.target as HTMLInputElement).value)}
        />
        <button class="pl-btn" onClick={() => void patch({ claudeApiKey: key.trim() || null })}>
          Save key
        </button>
        <button class="pl-btn secondary" disabled={testing} onClick={() => void runTest()}>
          {testing ? 'Testing…' : 'Test AI connection'}
        </button>
      </div>
      {testResult && (
        <div
          class={testResult.ok ? 'pl-muted' : 'pl-error'}
          style={testResult.ok ? { color: '#166534', fontSize: '13px', margin: '8px 0' } : {}}
        >
          {testResult.detail}
        </div>
      )}
      <p class="pl-muted">
        Model:{' '}
        <select
          style={{ width: 'auto' }}
          value={settings.claudeModel}
          onChange={(e) =>
            void patch({ claudeModel: (e.target as HTMLSelectElement).value as Settings['claudeModel'] })
          }
        >
          <option value="claude-sonnet-5">claude-sonnet-5 (more accurate)</option>
          <option value="claude-haiku-4-5">claude-haiku-4-5 (cheaper)</option>
        </select>
      </p>
    </div>
  );
}

function TermSection({ settings, patch }: SectionProps) {
  const [label, setLabel] = useState('');
  const [cap, setCap] = useState(18);

  const add = () => {
    if (!label.trim()) return;
    const term: TermConfig = { id: crypto.randomUUID(), label: label.trim(), creditCap: cap };
    void patch({ terms: [...settings.terms, term] });
    setLabel('');
  };

  return (
    <div class="pl-card">
      <h2>Future terms (for the semester board)</h2>
      <table class="pl-table">
        {settings.terms.map((t) => {
          const setDate = (key: 'startDate' | 'endDate', value: string) =>
            void patch({
              terms: settings.terms.map((x) => (x.id === t.id ? { ...x, [key]: value || undefined } : x)),
            });
          return (
            <tr>
              <td>{t.label}</td>
              <td>{t.creditCap} credit cap</td>
              <td title="First day of classes (used for calendar export)">
                <input type="date" value={t.startDate ?? ''} onChange={(e) => setDate('startDate', (e.target as HTMLInputElement).value)} />
              </td>
              <td title="Last day of classes (used for calendar export)">
                <input type="date" value={t.endDate ?? ''} onChange={(e) => setDate('endDate', (e.target as HTMLInputElement).value)} />
              </td>
              <td title="When your registration window opens — you'll get a reminder 24 h and 10 min before">
                <input
                  type="datetime-local"
                  value={t.registrationAt ?? ''}
                  onChange={(e) =>
                    void patch({
                      terms: settings.terms.map((x) =>
                        x.id === t.id ? { ...x, registrationAt: (e.target as HTMLInputElement).value || undefined } : x,
                      ),
                    })
                  }
                />
              </td>
              <td style={{ width: '40px' }}>
                <button
                  class="pl-btn danger"
                  onClick={() => void patch({ terms: settings.terms.filter((x) => x.id !== t.id) })}
                >
                  ✕
                </button>
              </td>
            </tr>
          );
        })}
      </table>
      {settings.terms.length > 0 && (
        <p class="pl-muted">
          All optional: start/end dates power the calendar 📆 .ics export; setting when
          registration opens gets you a ⏰ reminder 24 hours and 10 minutes before.
        </p>
      )}
      <div class="pl-row" style={{ marginTop: '8px' }}>
        <input
          type="text"
          placeholder='e.g. "Fall 2026"'
          value={label}
          onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
        />
        <input
          type="number"
          style={{ width: '90px' }}
          value={cap}
          onInput={(e) => setCap(parseInt((e.target as HTMLInputElement).value, 10) || 18)}
          title="Credit cap"
        />
        <button class="pl-btn" onClick={add}>
          Add term
        </button>
      </div>
    </div>
  );
}

// Human-friendly labels for the page elements the extension needs to find.
const SELECTOR_FIELDS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'courseSectionRow', label: 'Course result rows', hint: 'Each row in the Find Course Sections results list' },
  { key: 'instructorCell', label: 'Instructor name', hint: 'The cell showing the professor for a section' },
  { key: 'meetingPatternCell', label: 'Meeting day/time', hint: 'The cell showing days & times, e.g. "MWF 10:00 AM"' },
  { key: 'savedScheduleTable', label: 'Saved schedule table', hint: 'The table/grid of your saved schedule' },
  { key: 'academicHistoryTable', label: 'Academic history table', hint: 'The transcript / academic history grid' },
  { key: 'pageTitle', label: 'Page title', hint: 'The heading Workday shows for the current page' },
];

function AdvancedSelectors({ settings, patch }: SectionProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      SELECTOR_FIELDS.map((f) => [f.key, (settings.selectorOverrides[f.key] ?? []).join('\n')]),
    ),
  );
  const [saved, setSaved] = useState(false);

  const save = () => {
    const overrides: Record<string, string[]> = {};
    for (const f of SELECTOR_FIELDS) {
      const list = (draft[f.key] ?? '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.length) overrides[f.key] = list;
    }
    void patch({ selectorOverrides: overrides });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div class="pl-card">
      <div class="pl-row">
        <h2>Fix detection on your school's Workday</h2>
        <button class="pl-btn secondary" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Advanced'}
        </button>
      </div>
      <p class="pl-muted">
        Normally you don't need this. If the calendar or capture says a page isn't detected, you can
        tell the extension exactly where things are on your school's Workday by pasting a CSS
        selector (from the browser's Inspect tool) for each item below. One selector per line;
        leave blank to use the built-in defaults.
      </p>
      {open && (
        <>
          {SELECTOR_FIELDS.map((f) => (
            <div style={{ marginBottom: '10px' }}>
              <label style={{ fontWeight: 600, fontSize: '13px' }}>{f.label}</label>
              <div class="pl-muted" style={{ fontSize: '12px', marginBottom: '3px' }}>{f.hint}</div>
              <textarea
                style={{ minHeight: '48px' }}
                placeholder="e.g. [data-automation-id='row']"
                value={draft[f.key]}
                onInput={(e) => setDraft({ ...draft, [f.key]: (e.target as HTMLTextAreaElement).value })}
              />
            </div>
          ))}
          <button class="pl-btn" onClick={save}>
            {saved ? 'Saved ✓' : 'Save'}
          </button>
        </>
      )}
    </div>
  );
}

// SHA-256 of the owner unlock code. Only the hash ships in the bundle, so the
// code itself can't be read out of the extension files.
const ADMIN_CODE_HASH = 'b538bdf6ec8aeda3eb8a28a4ed108ebbc2ccc89b895d34d7a65e657bdea37fc5';

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Campus map: the building coordinates behind the calendar's walk-time
 * warnings. Filled by free geocoding / AI research from the calendar's Route
 * view; fully editable here. Walking speed feeds the same estimates.
 */
function CampusMapSection({ settings, patch }: SectionProps) {
  const [map, setMap] = useState<CampusMap | null>(null);
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');

  useEffect(() => {
    void getStored('campusMap').then(setMap);
  }, []);

  if (!map) return null;
  const entries = Object.entries(map.buildings).sort(([a], [b]) => a.localeCompare(b));

  const save = (next: CampusMap) => {
    setMap(next);
    void sendToBackground({ kind: 'MAP_SET', map: next });
  };
  const setCoord = (building: string, field: 'lat' | 'lng', value: string) => {
    const n = parseFloat(value);
    if (!Number.isFinite(n)) return;
    save({
      ...map,
      buildings: { ...map.buildings, [building]: { ...map.buildings[building]!, [field]: n, source: 'manual' } },
    });
  };
  const remove = (building: string) => {
    const next = { ...map.buildings };
    delete next[building];
    save({ ...map, buildings: next });
  };
  const add = () => {
    const la = parseFloat(lat);
    const ln = parseFloat(lng);
    if (!name.trim() || !Number.isFinite(la) || !Number.isFinite(ln)) return;
    save({ ...map, buildings: { ...map.buildings, [name.trim()]: { lat: la, lng: ln, source: 'manual' } } });
    setName('');
    setLat('');
    setLng('');
  };

  return (
    <div class="pl-card">
      <h2>🗺 Campus map</h2>
      <p class="pl-muted">
        Building coordinates power the calendar's <b>Route</b> view and its "you might miss class"
        walk-time warnings. The calendar can fill these automatically (free OpenStreetMap lookup, or
        AI research on Pro) — fix or add any building here.
        {map.school ? ` Current school: ${map.school}.` : ' Pick your school above first for better lookups.'}
      </p>
      <div class="pl-row" style={{ marginBottom: '10px' }}>
        <label style={{ flex: '0 0 auto' }}>🚶 Walking speed</label>
        <input
          type="number"
          step="0.1"
          min="1"
          max="15"
          style={{ width: '90px', flex: '0 0 auto' }}
          value={settings.walkSpeedKmh ?? 4.8}
          onChange={(e) => void patch({ walkSpeedKmh: parseFloat((e.target as HTMLInputElement).value) || 4.8 })}
        />
        <span class="pl-muted">km/h (4.8 ≈ normal pace; estimates include a 1.3× detour factor)</span>
      </div>
      {entries.length > 0 && (
        <table class="pl-table">
          <thead>
            <tr>
              <th>Building</th>
              <th>Latitude</th>
              <th>Longitude</th>
              <th>Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map(([building, b]) => (
              <tr>
                <td>{building}</td>
                <td>
                  <input type="number" step="0.0001" value={b.lat} onChange={(e) => setCoord(building, 'lat', (e.target as HTMLInputElement).value)} />
                </td>
                <td>
                  <input type="number" step="0.0001" value={b.lng} onChange={(e) => setCoord(building, 'lng', (e.target as HTMLInputElement).value)} />
                </td>
                <td>{b.source === 'osm' ? '🌍 OSM' : b.source === 'ai' ? '🤖 AI' : '✍️ manual'}</td>
                <td>
                  <button class="pl-link-inline" title="Remove" onClick={() => remove(building)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div class="pl-row" style={{ marginTop: '10px' }}>
        <input placeholder="Building name, e.g. Baker Hall" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        <input style={{ width: '120px', flex: '0 0 auto' }} placeholder="lat" value={lat} onInput={(e) => setLat((e.target as HTMLInputElement).value)} />
        <input style={{ width: '120px', flex: '0 0 auto' }} placeholder="lng" value={lng} onInput={(e) => setLng((e.target as HTMLInputElement).value)} />
        <button class="pl-btn" style={{ flex: '0 0 auto' }} onClick={add} disabled={!name.trim() || !lat || !lng}>
          Add
        </button>
      </div>
    </div>
  );
}

/**
 * Problems & suggestions, straight to the developer: a short form that opens
 * a pre-filled email or a pre-filled GitHub issue — no backend, and the
 * diagnostics (version + plan) ride along automatically.
 */
/**
 * Full-data backup: everything lives in chrome.storage.local, so export is a
 * plain JSON download and import restores it (known keys only, after an
 * explicit confirmation). The file never leaves the user's machine.
 */
function BackupSection() {
  const [pending, setPending] = useState<{ data: Record<string, unknown>; summary: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const exportAll = async () => {
    const all = await chrome.storage.local.get(null);
    const blob = new Blob([JSON.stringify({ schemaVersion: 1, ...all }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `student-companion-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setNote('Backup downloaded. It stays on your computer — nothing is uploaded.');
  };

  const pickFile = (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      try {
        const data = JSON.parse(text) as Record<string, unknown>;
        if (typeof data.schemaVersion !== 'number') throw new Error('bad');
        const degrees = Object.keys((data.degrees as object) ?? {}).length;
        const history = ((data.academicHistory as { courses?: unknown[] } | null)?.courses ?? []).length;
        const sections = ((data.schedule as { sections?: unknown[] } | null)?.sections ?? []).length;
        setPending({
          data,
          summary: `${degrees} degree(s), ${history} history course(s), ${sections} scheduled section(s)`,
        });
        setNote(null);
      } catch {
        setPending(null);
        setNote("That file doesn't look like a Student Companion backup.");
      }
    });
    (e.target as HTMLInputElement).value = '';
  };

  const restore = () => {
    if (!pending) return;
    void sendToBackground({ kind: 'BACKUP_IMPORT', data: pending.data })
      .then(() => {
        setPending(null);
        setNote('Backup restored ✓ — reload any open Workday tabs to see it.');
      })
      .catch((err) => setNote(err instanceof Error ? err.message : String(err)));
  };

  // Deliberately tiny: one line at the bottom of Options, out of the way
  // until the day it saves you.
  return (
    <p class="pl-muted" style={{ textAlign: 'center', marginTop: '14px' }}>
      💾 All your data:{' '}
      <button class="pl-link-inline" onClick={() => void exportAll()}>
        export backup
      </button>{' '}
      ·{' '}
      <label class="pl-link-inline" style={{ cursor: 'pointer' }}>
        import backup
        <input type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={pickFile} />
      </label>
      {pending && (
        <span>
          <br />
          Restore <b>{pending.summary}</b>? This <b>replaces</b> current data.{' '}
          <button class="pl-link-inline" onClick={restore}>
            yes, replace
          </button>{' '}
          ·{' '}
          <button class="pl-link-inline" onClick={() => setPending(null)}>
            cancel
          </button>
        </span>
      )}
      {note && (
        <span>
          <br />
          {note}
        </span>
      )}
    </p>
  );
}

function FeedbackSection({ settings }: { settings: Settings }) {
  const [kind, setKind] = useState<'problem' | 'suggestion'>('problem');
  const [text, setText] = useState('');

  const diagnostics = () => {
    const version = chrome.runtime.getManifest?.().version ?? 'dev';
    return `\n\n---\nversion: ${version} · plan: ${settings.plan}${settings.admin ? ' (owner)' : ''} · school: ${settings.rmpSchool?.name ?? 'not set'}`;
  };
  const subject = () =>
    `[Student Companion] ${kind === 'problem' ? 'Problem report' : 'Suggestion'}`;
  const body = () => (text.trim() || '(describe it here)') + diagnostics();

  const emailHref = () =>
    `mailto:eric2007118@gmail.com?subject=${encodeURIComponent(subject())}&body=${encodeURIComponent(body())}`;
  const gmailHref = () =>
    `https://mail.google.com/mail/?view=cm&fs=1&to=eric2007118@gmail.com&su=${encodeURIComponent(
      subject(),
    )}&body=${encodeURIComponent(body())}`;
  const githubHref = () =>
    `https://github.com/eericzhuang/student-companion/issues/new?title=${encodeURIComponent(
      subject(),
    )}&body=${encodeURIComponent(body())}`;

  return (
    <div class="pl-card">
      <h2>💬 Feedback</h2>
      <p class="pl-muted">
        Ran into a problem, or have an idea? Describe it below, then send it however you prefer —
        version and plan info are attached automatically (never your courses or grades).
      </p>
      <div class="pl-row" style={{ marginBottom: '8px' }}>
        <select
          style={{ width: 'auto', flex: '0 0 auto' }}
          value={kind}
          onChange={(e) => setKind((e.target as HTMLSelectElement).value as 'problem' | 'suggestion')}
        >
          <option value="problem">🐛 Report a problem</option>
          <option value="suggestion">💡 Make a suggestion</option>
        </select>
      </div>
      <textarea
        style={{ minHeight: '90px' }}
        placeholder={
          kind === 'problem'
            ? 'What happened, and on which page? (e.g. "calendar shows nothing on the saved-schedule page")'
            : 'What would make the extension better for you?'
        }
        value={text}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
      />
      <div class="pl-row" style={{ marginTop: '8px' }}>
        <a
          class="pl-btn"
          style={{ textDecoration: 'none', textAlign: 'center' }}
          href={gmailHref()}
          target="_blank"
          rel="noreferrer"
        >
          📧 Open in Gmail
        </a>
        <a class="pl-btn secondary" style={{ textDecoration: 'none', textAlign: 'center' }} href={emailHref()}>
          ✉️ Email app
        </a>
        <a
          class="pl-btn secondary"
          style={{ textDecoration: 'none', textAlign: 'center' }}
          href={githubHref()}
          target="_blank"
          rel="noreferrer"
        >
          🐙 GitHub issue
        </a>
      </div>
    </div>
  );
}

function AdminSection({ settings, patch }: SectionProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (settings.admin) {
    return (
      <div class="pl-card" style={{ borderColor: '#16a34a' }}>
        <h2>👑 Owner mode</h2>
        <p class="pl-muted">Owner unlock active — Pro features are enabled for you.</p>
        <button
          class="pl-btn secondary"
          onClick={() => void patch({ admin: false, plan: 'free' })}
        >
          Turn off owner mode
        </button>
      </div>
    );
  }

  const submit = async () => {
    if ((await sha256Hex(code.trim())) === ADMIN_CODE_HASH) {
      setError(null);
      void patch({ admin: true, plan: 'supreme' });
    } else {
      setError('Incorrect code.');
    }
  };

  return (
    <div class="pl-card">
      <h2>Owner access</h2>
      <p class="pl-muted">If you're the app owner, enter your unlock code to enable Pro.</p>
      <div class="pl-row">
        <input
          type="password"
          placeholder="Owner code"
          value={code}
          onInput={(e) => setCode((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
        <button class="pl-btn" onClick={() => void submit()}>
          Unlock
        </button>
      </div>
      {error && <div class="pl-error">{error}</div>}
    </div>
  );
}

watchPageDark();
render(<App />, document.getElementById('app')!);
