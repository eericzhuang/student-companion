/**
 * GPA card for the Progress tab: current GPA from the captured academic
 * history, plus an expandable "what-if grades" section — pick hypothetical
 * grades for in-progress / planned courses and see the projected cumulative
 * GPA live. Standard 4.0 scale.
 */
import { useMemo, useState } from 'preact/hooks';
import type { HistoryCourse } from '../shared/types';
import { GRADE_CHOICES, computeGpa, projectGpa, type Hypothetical } from './engine/gpa';

export interface GpaCandidate {
  code: string;
  credits: number;
}

export function GpaCard({ history, candidates }: { history: HistoryCourse[]; candidates: GpaCandidate[] }) {
  const [open, setOpen] = useState(false);
  const [picks, setPicks] = useState<Record<string, string>>({}); // code -> grade ('' = not counted)
  const [credits, setCredits] = useState<Record<string, number>>({});

  const current = useMemo(() => computeGpa(history), [history]);

  const hypotheticals: Hypothetical[] = candidates
    .filter((c) => picks[c.code])
    .map((c) => ({ code: c.code, grade: picks[c.code]!, credits: credits[c.code] ?? c.credits }));
  const projection = useMemo(
    () => projectGpa(history, hypotheticals),
    [history, JSON.stringify(hypotheticals)],
  );

  const fmt = (g: number | null) => (g === null ? '—' : g.toFixed(2));
  const delta =
    current.gpa !== null && projection.projected !== null && hypotheticals.length > 0
      ? projection.projected - current.gpa
      : null;

  if (history.length === 0) return null;

  return (
    <div class="pl-card pl-gpa">
      <div class="pl-gpa-head">
        <span class="pl-gpa-big" title={`${current.qualityPoints.toFixed(1)} quality points / ${current.gpaCredits} credits`}>
          {fmt(current.gpa)}
        </span>
        <span class="pl-gpa-label">
          <b>GPA</b>
          <span class="pl-muted">
            {current.counted} course{current.counted === 1 ? '' : 's'} · {current.gpaCredits} credits
          </span>
        </span>
        {candidates.length > 0 && (
          <button class="pl-btn" onClick={() => setOpen(!open)}>
            {open ? 'Hide what-if' : '🔮 What-if grades'}
          </button>
        )}
      </div>
      {current.missingCredits.length > 0 && (
        <p class="pl-muted pl-gpa-note">
          ⚠ Skipped (unknown credits): {current.missingCredits.map((c) => c.code).join(', ')} — fill
          credits in the History tab to count them.
        </p>
      )}
      {open && (
        <div class="pl-gpa-whatif">
          <p class="pl-muted">Pick grades for current / planned courses to project your GPA:</p>
          {candidates.map((c) => (
            <div class="pl-gpa-row">
              <span class="pl-gpa-code">{c.code}</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={credits[c.code] ?? c.credits}
                title="Credits"
                onInput={(e) =>
                  setCredits({ ...credits, [c.code]: Number((e.target as HTMLInputElement).value) || 0 })
                }
              />
              <select
                value={picks[c.code] ?? ''}
                onChange={(e) => setPicks({ ...picks, [c.code]: (e.target as HTMLSelectElement).value })}
              >
                <option value="">—</option>
                {GRADE_CHOICES.map((g) => (
                  <option value={g}>{g}</option>
                ))}
              </select>
            </div>
          ))}
          {hypotheticals.length > 0 && (
            <div class="pl-gpa-proj">
              Term GPA <b>{fmt(projection.termGpa)}</b> · cumulative {fmt(current.gpa)} →{' '}
              <b>{fmt(projection.projected)}</b>
              {delta !== null && (
                <span class={delta >= 0 ? 'pl-gpa-up' : 'pl-gpa-down'}>
                  {' '}
                  ({delta >= 0 ? '+' : ''}
                  {delta.toFixed(2)})
                </span>
              )}
            </div>
          )}
        </div>
      )}
      <p class="pl-muted pl-gpa-note">Standard 4.0 scale — your school's scale may differ.</p>
    </div>
  );
}
