/**
 * Import flow: paste a catalog URL -> request host permission -> fetch ->
 * extract readable text -> Claude structured parse -> hand off to ReviewEditor.
 * Falls back to manual text paste for JS-rendered catalogs.
 */
import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import type { DegreeProgram } from '../shared/types';
import { getStored } from '../shared/storage';
import { aiAvailable, isSupreme } from '../shared/plan';
import { aiLaneFullMessage, aiLaneOpen, enterAiLane, leaveAiLane } from './aiLock';
import {
  sendToBackground,
  type DegreeParseResult,
  type DegreeResearchResult,
} from '../background/messages';

interface Props {
  onParsed: (degree: DegreeProgram, sourceUrl: string | null, sourceText: string) => void;
}

const BLANK_DEGREE: DegreeProgram = {
  name: 'New degree',
  type: 'major',
  totalCredits: null,
  groups: [{ title: 'Requirements', rule: { kind: 'all' }, courses: [], notes: null }],
};

/** Strip navigation/script noise and return readable text from a fetched page. */
export function extractReadableText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const sel of ['script', 'style', 'nav', 'header', 'footer', 'noscript', 'iframe', 'svg']) {
    doc.querySelectorAll(sel).forEach((el) => el.remove());
  }
  const main = doc.querySelector('main, [role="main"], #content, .content, article') ?? doc.body;
  return (main?.textContent ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// Module-level so an in-flight import/research keeps its "working" state and its
// result even if the user switches planner tabs (which unmounts this component).
// The background worker never stops; this just keeps the UI honest on return.
const busySignal = signal<string | null>(null);
const errorSignal = signal<string | null>(null);

export function DegreeImport({ onParsed }: Props) {
  const [url, setUrl] = useState('');
  const [manualText, setManualText] = useState('');
  const [showManual, setShowManual] = useState(false);
  const busy = busySignal.value;
  const setBusy = (v: string | null) => (busySignal.value = v);
  const setError = (v: string | null) => (errorSignal.value = v);
  const error = errorSignal.value;
  const [aiOn, setAiOn] = useState(false);
  const [supremeOn, setSupremeOn] = useState(false);
  const [school, setSchool] = useState('');
  const [program, setProgram] = useState('');

  useEffect(() => {
    void getStored('settings').then((s) => {
      setAiOn(aiAvailable(s));
      setSupremeOn(isSupreme(s));
      if (s.rmpSchool?.name) setSchool(s.rmpSchool.name);
    });
  }, []);

  const research = async () => {
    if (!school.trim() || !program.trim()) return;
    if (!aiLaneOpen(supremeOn)) {
      setError(aiLaneFullMessage(supremeOn));
      return;
    }
    setError(null);
    enterAiLane();
    setBusy('AI is searching the web for your full graduation requirements — this can take a minute. You can switch tabs; it keeps working.');
    try {
      const res = await sendToBackground<DegreeResearchResult>({
        kind: 'DEGREE_RESEARCH',
        school: school.trim(),
        program: program.trim(),
      });
      onParsed(res.degree, null, `Researched: ${program.trim()} @ ${school.trim()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      leaveAiLane();
    }
  };

  const parseText = async (text: string, sourceUrl: string | null) => {
    if (text.length < 200) {
      throw new Error(
        'Could not extract enough text from that page (it may render with JavaScript). Use "paste the text instead" below.',
      );
    }
    // AI parses go through the same lane as the other AI features so Free/Pro
    // requests stay serialized; the local heuristic parse needs no slot.
    if (aiOn && !aiLaneOpen(supremeOn)) {
      throw new Error(aiLaneFullMessage(supremeOn));
    }
    if (aiOn) enterAiLane();
    try {
      setBusy(aiOn ? 'Parsing with AI — this takes ~30 seconds…' : 'Extracting course codes…');
      const res = await sendToBackground<DegreeParseResult>({
        kind: 'DEGREE_PARSE',
        pageText: text,
        sourceUrl,
      });
      onParsed(res.degree, sourceUrl, text);
    } finally {
      if (aiOn) leaveAiLane();
    }
  };

  const importFromUrl = async () => {
    setError(null);
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      setError('That does not look like a valid URL.');
      return;
    }
    try {
      setBusy('Requesting permission…');
      const origin = `${parsed.origin}/*`;
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) {
        throw new Error('Permission to read that site was declined.');
      }
      setBusy('Fetching page…');
      const res = await fetch(parsed.href, { credentials: 'omit' });
      if (!res.ok) throw new Error(`Could not fetch the page (HTTP ${res.status}).`);
      const html = await res.text();
      await parseText(extractReadableText(html), parsed.href);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const importFromText = async () => {
    setError(null);
    try {
      await parseText(manualText, null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div class="pl-card">
      <h2>Add a degree</h2>
      <p class="pl-muted">
        Paste the URL of the degree's requirements page from your school catalog. The page is
        fetched locally; you review everything before saving.
      </p>
      <div class={aiOn ? 'pl-muted' : 'pl-error'}>
        {aiOn ? (
          <span class="pl-muted">✨ Pro AI parsing is on — imports are parsed for you with higher accuracy.</span>
        ) : (
          <>
            AI parsing is a <b>Pro</b> feature. On Free, imports use <b>basic course-code
            extraction</b> you fix on the next screen. {' '}
            <button class="pl-link-inline" onClick={() => void sendToBackground({ kind: 'OPEN_SUBSCRIBE' })}>
              ✨ Upgrade to Pro
            </button>{' '}
            for automatic parsing, or build a degree by hand below.
          </>
        )}
      </div>
      {aiOn && !supremeOn && (
        <div class="pl-ai-card">
          <h3 style={{ marginTop: 0, fontSize: '15px' }}>🎓 Auto-find my full degree requirements <span class="pl-supreme-tag">👑 Supreme</span></h3>
          <p class="pl-muted">
            Skip the URL — the AI deep-researches your school's catalog and returns{' '}
            <b>everything you need to graduate</b>. It runs many web searches per lookup, so it's
            part of the <b>Supreme</b> plan.
          </p>
          <button class="pl-btn" onClick={() => void sendToBackground({ kind: 'OPEN_SUBSCRIBE' })}>
            👑 Upgrade to Supreme
          </button>
        </div>
      )}
      {aiOn && supremeOn && (
        <div class={`pl-ai-card${busy ? ' busy' : ''}`}>
          <h3 style={{ marginTop: 0, fontSize: '15px' }}>🎓 Auto-find my full degree requirements <span class="pl-supreme-tag">👑 Supreme</span></h3>
          <p class="pl-muted">
            Skip the URL — tell the AI your <b>school</b> and <b>program</b> and it looks up{' '}
            <b>everything you need to graduate</b>: the major requirements plus college/university-wide
            rules (general-education / distribution / breadth, writing, language, total credits) for
            you to review.
          </p>
          <div class="pl-row" style={{ alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label class="pl-muted">School</label>
              <input
                type="text"
                placeholder="e.g. Cornell University"
                value={school}
                onInput={(e) => setSchool((e.target as HTMLInputElement).value)}
                disabled={busy !== null}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label class="pl-muted">Program / major / minor</label>
              <input
                type="text"
                placeholder="e.g. B.S. Computer Science"
                value={program}
                onInput={(e) => setProgram((e.target as HTMLInputElement).value)}
                disabled={busy !== null}
              />
            </div>
            <button class="pl-btn" onClick={() => void research()} disabled={busy !== null || !aiLaneOpen(supremeOn) || !school.trim() || !program.trim()}>
              Find
            </button>
          </div>
        </div>
      )}

      <p class="pl-muted" style={{ marginBottom: '4px' }}>…or paste the catalog URL:</p>
      <div class="pl-row">
        <input
          type="url"
          placeholder="https://catalog.yourschool.edu/programs/cs-bs"
          value={url}
          onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
          disabled={busy !== null}
        />
        <button class="pl-btn" onClick={() => void importFromUrl()} disabled={busy !== null || !url.trim()}>
          Import
        </button>
      </div>
      {busy && (
        <div class="pl-ai-working">
          <span class="pl-ai-spark">✨</span>
          <span>{busy}</span>
          <span class="pl-ai-bar" />
        </div>
      )}
      {error && <div class="pl-error">{error}</div>}
      <div style={{ display: 'flex', gap: '10px', marginTop: '4px', flexWrap: 'wrap' }}>
        <button class="pl-btn secondary" onClick={() => setShowManual(!showManual)}>
          …or paste the requirements text instead
        </button>
        <button
          class="pl-btn secondary"
          onClick={() => onParsed(structuredClone(BLANK_DEGREE), null, '')}
          title="Start from an empty degree and enter requirements yourself"
        >
          Build a degree manually
        </button>
      </div>
      {showManual && (
        <div>
          <textarea
            placeholder="Paste the full requirements section from the catalog page…"
            value={manualText}
            onInput={(e) => setManualText((e.target as HTMLTextAreaElement).value)}
            disabled={busy !== null}
          />
          <p>
            <button
              class="pl-btn"
              onClick={() => void importFromText()}
              disabled={busy !== null || manualText.trim().length < 50}
            >
              Parse pasted text
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
