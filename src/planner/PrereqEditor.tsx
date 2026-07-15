/**
 * Manual prerequisites editor. Catalog parsing often misses prerequisites, so
 * this lets the student state "course X requires Y, Z first". These merge into
 * the scheduling engine so the semester board never places a course before its
 * prerequisites. Prereqs already parsed from degrees are shown for reference.
 */
import { signal } from '@preact/signals';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { StoredDegree } from '../shared/types';
import { sendToBackground, type PrereqResearchResult } from '../background/messages';
import { getStored } from '../shared/storage';
import { aiAvailable, isSupreme } from '../shared/plan';
import { aiLaneFullMessage, aiLaneOpen, enterAiLane, leaveAiLane } from './aiLock';
import { normalizeCode } from './engine/requirements';

// Module-level so an in-flight "Auto-find prerequisites" search keeps its state
// and delivers its result even if the user switches planner tabs mid-request
// (which unmounts this component). The background worker never stops.
const codeSignal = signal('');
const prereqsSignal = signal('');
const eqCodeSignal = signal('');
const eqAltsSignal = signal('');
const busySignal = signal(false);
const aiNoteSignal = signal<string | null>(null);
const aiErrorSignal = signal<string | null>(null);

interface Props {
  degrees: StoredDegree[];
  prereqOverrides: Record<string, string[]>;
  courseEquivalents: Record<string, string[]>;
}

export function PrereqEditor({ degrees, prereqOverrides, courseEquivalents }: Props) {
  const code = codeSignal.value;
  const setCode = (v: string) => (codeSignal.value = v);
  const prereqs = prereqsSignal.value;
  const setPrereqs = (v: string) => (prereqsSignal.value = v);
  const eqCode = eqCodeSignal.value;
  const setEqCode = (v: string) => (eqCodeSignal.value = v);
  const eqAlts = eqAltsSignal.value;
  const setEqAlts = (v: string) => (eqAltsSignal.value = v);
  const busy = busySignal.value;
  const setBusy = (v: boolean) => (busySignal.value = v);
  const aiNote = aiNoteSignal.value;
  const setAiNote = (v: string | null) => (aiNoteSignal.value = v);
  const aiError = aiErrorSignal.value;
  const setAiError = (v: string | null) => (aiErrorSignal.value = v);

  const [aiOn, setAiOn] = useState(false);
  const [supremeOn, setSupremeOn] = useState(false);
  const [school, setSchool] = useState('');

  useEffect(() => {
    void getStored('settings').then((s) => {
      setAiOn(aiAvailable(s));
      setSupremeOn(isSupreme(s));
      if (s.rmpSchool?.name) setSchool(s.rmpSchool.name);
    });
  }, []);

  // Pro: research the typed course's prerequisites and pre-fill the fields for review.
  const findPrereqs = async () => {
    const c = normalizeCode(code.trim());
    if (!c || !school.trim()) return;
    if (!aiLaneOpen(supremeOn)) {
      setAiError(aiLaneFullMessage(supremeOn));
      return;
    }
    setBusy(true);
    enterAiLane();
    setAiError(null);
    setAiNote(null);
    try {
      const res = await sendToBackground<PrereqResearchResult>({
        kind: 'PREREQ_RESEARCH',
        school: school.trim(),
        course: c,
      });
      if (res.prereqs.length) setPrereqs(res.prereqs.join(', '));
      if (res.equivalents.length) {
        setEqCode(c);
        setEqAlts(res.equivalents.join(', '));
      }
      setAiNote(
        res.note ??
          (res.prereqs.length
            ? 'Review the suggested prerequisites below, then click Add.'
            : 'No prerequisites found for this course.'),
      );
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      leaveAiLane();
    }
  };

  // All course codes across degrees (for the datalist) + prereqs parsed from catalogs.
  const { allCodes, parsedPrereqs } = useMemo(() => {
    const codes = new Set<string>();
    const parsed = new Map<string, string[]>();
    for (const d of degrees) {
      for (const g of d.groups) {
        for (const c of g.courses) {
          const norm = normalizeCode(c.code);
          codes.add(norm);
          if (c.prereqCodes.length > 0) {
            parsed.set(norm, [...new Set(c.prereqCodes.map(normalizeCode))]);
          }
        }
      }
    }
    return { allCodes: [...codes].sort(), parsedPrereqs: parsed };
  }, [degrees]);

  const add = () => {
    const c = normalizeCode(code.trim());
    const list = prereqs
      .split(',')
      .map((s) => normalizeCode(s.trim()))
      .filter(Boolean);
    if (!c || list.length === 0) return;
    void sendToBackground({ kind: 'PREREQ_SET', code: c, prereqs: list });
    setCode('');
    setPrereqs('');
  };

  const remove = (c: string) => void sendToBackground({ kind: 'PREREQ_DELETE', code: c });

  const addEquiv = () => {
    const c = normalizeCode(eqCode.trim());
    const list = eqAlts
      .split(',')
      .map((s) => normalizeCode(s.trim()))
      .filter(Boolean);
    if (!c || list.length === 0) return;
    void sendToBackground({ kind: 'EQUIV_SET', code: c, equivalents: list });
    setEqCode('');
    setEqAlts('');
  };
  const removeEquiv = (c: string) => void sendToBackground({ kind: 'EQUIV_DELETE', code: c });

  const overrideEntries = Object.entries(prereqOverrides);
  const equivEntries = Object.entries(courseEquivalents);

  return (
    <div class="pl-card">
      <h2>Prerequisites</h2>
      <p class="pl-muted">
        The board orders terms so prerequisites come first. When the catalog didn't state them, add
        them here — e.g. course <b>CS 4410</b> requires <b>CS 3410</b>. These override/augment what
        was parsed.
      </p>

      {aiOn && !supremeOn && (
        <div class="pl-ai-card">
          <h3 style={{ marginTop: 0, fontSize: '15px' }}>🧩 Auto-find this course's prerequisites <span class="pl-supreme-tag">👑 Supreme</span></h3>
          <p class="pl-muted">
            The AI looks a course up in your school's official catalog and fills in its prerequisites
            for you. It runs web research per lookup, so it's part of the <b>Supreme</b> plan.
          </p>
          <button class="pl-btn" onClick={() => void sendToBackground({ kind: 'OPEN_SUBSCRIBE' })}>
            👑 Upgrade to Supreme
          </button>
        </div>
      )}
      {aiOn && supremeOn && (
        <div class={`pl-ai-card${busy ? ' busy' : ''}`}>
          <h3 style={{ marginTop: 0, fontSize: '15px' }}>🧩 Auto-find this course's prerequisites <span class="pl-supreme-tag">👑 Supreme</span></h3>
          <p class="pl-muted">
            Type a course code, and the AI will look up its prerequisites from your school's official
            catalog and fill them in below for you to review before adding.
          </p>
          <p class="pl-muted" style={{ color: '#92400e' }}>
            ⚠ If your school hasn't published up-to-date info online, this shows the latest
            available catalog year instead (or nothing at all) — course codes and names may differ
            from what Workday currently lists, so double-check before adding.
          </p>
          <div class="pl-row" style={{ alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label class="pl-muted">School</label>
              <input
                type="text"
                placeholder="Cornell University"
                value={school}
                onInput={(e) => setSchool((e.target as HTMLInputElement).value)}
                disabled={busy}
              />
            </div>
            <div style={{ flex: '0 0 160px' }}>
              <label class="pl-muted">Course to look up</label>
              <input
                type="text"
                list="wdc-codes"
                placeholder="CS 4410"
                value={code}
                onInput={(e) => setCode((e.target as HTMLInputElement).value)}
                disabled={busy}
              />
            </div>
            <button class="pl-btn" onClick={() => void findPrereqs()} disabled={busy || !aiLaneOpen(supremeOn) || !code.trim() || !school.trim()}>
              Find
            </button>
          </div>
          {busy && (
            <div class="pl-ai-working">
              <span class="pl-ai-spark">✨</span>
              <span>AI is searching the catalog — this can take a minute. You can switch tabs; it keeps working.</span>
              <span class="pl-ai-bar" />
            </div>
          )}
          {aiNote && !busy && <p class="pl-muted" style={{ color: '#166534' }}>✓ {aiNote}</p>}
          {aiError && <div class="pl-error">{aiError}</div>}
        </div>
      )}

      <div class="pl-row" style={{ alignItems: 'flex-end' }}>
        <div style={{ flex: '0 0 160px' }}>
          <label class="pl-muted">Course</label>
          <input
            type="text"
            list="wdc-codes"
            placeholder="CS 4410"
            value={code}
            onInput={(e) => setCode((e.target as HTMLInputElement).value)}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label class="pl-muted">requires first (comma-separated)</label>
          <input
            type="text"
            list="wdc-codes"
            placeholder="CS 3410, CS 2110"
            value={prereqs}
            onInput={(e) => setPrereqs((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
        </div>
        <button class="pl-btn" onClick={add} disabled={!code.trim() || !prereqs.trim()}>
          Add
        </button>
      </div>
      <datalist id="wdc-codes">
        {allCodes.map((c) => (
          <option value={c} />
        ))}
      </datalist>

      {overrideEntries.length > 0 && (
        <>
          <h3 style={{ fontSize: '14px', marginTop: '16px' }}>Your prerequisites</h3>
          <table class="pl-table">
            <tbody>
              {overrideEntries.map(([c, list]) => (
                <tr>
                  <td style={{ width: '140px' }}>
                    <b>{c}</b>
                  </td>
                  <td>requires {list.join(', ')}</td>
                  <td style={{ width: '40px' }}>
                    <button class="pl-btn danger" onClick={() => remove(c)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2 style={{ marginTop: '22px' }}>Equivalent courses</h2>
      <p class="pl-muted">
        If a required course can be satisfied by another (e.g. <b>MATH 1910</b> is met by an AP
        Calculus credit, a transfer course, or <b>MATH 1220</b>), record it here. The progress
        checker then counts the equivalent from your history — including transfer/AP credits.
      </p>
      <div class="pl-row" style={{ alignItems: 'flex-end' }}>
        <div style={{ flex: '0 0 160px' }}>
          <label class="pl-muted">Required course</label>
          <input type="text" list="wdc-codes" placeholder="MATH 1910" value={eqCode} onInput={(e) => setEqCode((e.target as HTMLInputElement).value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label class="pl-muted">also satisfied by (comma-separated)</label>
          <input
            type="text"
            list="wdc-codes"
            placeholder="MATH 1220, MATHAP 1000"
            value={eqAlts}
            onInput={(e) => setEqAlts((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && addEquiv()}
          />
        </div>
        <button class="pl-btn" onClick={addEquiv} disabled={!eqCode.trim() || !eqAlts.trim()}>
          Add
        </button>
      </div>

      {equivEntries.length > 0 && (
        <table class="pl-table" style={{ marginTop: '8px' }}>
          <tbody>
            {equivEntries.map(([c, list]) => (
              <tr>
                <td style={{ width: '140px' }}>
                  <b>{c}</b>
                </td>
                <td>satisfied by {list.join(', ')}</td>
                <td style={{ width: '40px' }}>
                  <button class="pl-btn danger" onClick={() => removeEquiv(c)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {parsedPrereqs.size > 0 && (
        <>
          <h3 style={{ fontSize: '14px', marginTop: '16px' }}>Parsed from your degrees (reference)</h3>
          <table class="pl-table">
            <tbody>
              {[...parsedPrereqs.entries()].map(([c, list]) => (
                <tr>
                  <td style={{ width: '140px' }}>
                    <b>{c}</b>
                  </td>
                  <td class="pl-muted">requires {list.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
