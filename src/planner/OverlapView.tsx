/**
 * Cross-degree overlap matrix: courses appearing in 2+ selected degrees,
 * grouped by the exact combination of degrees they count toward — "shared by
 * all N" first, then each pair/subset.
 */
import type { StoredDegree } from '../shared/types';
import { findOverlaps, groupOverlapsByCombo, type OverlapEntry } from './engine/overlap';
import { stateOf, type CourseStates } from './engine/requirements';

interface Props {
  degrees: StoredDegree[];
  states: CourseStates;
}

const STATE_LABEL: Record<string, string> = {
  completed: '✅ completed',
  'in-progress': '🕐 in progress',
  planned: '📘 planned',
  none: '— not taken',
};

function OverlapTable({ entries, degrees, states }: { entries: OverlapEntry[]; degrees: StoredDegree[]; states: CourseStates }) {
  return (
    <table class="pl-table">
      <thead>
        <tr>
          <th>Course</th>
          <th>Status</th>
          <th>Requirements it satisfies</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((o) => (
          <tr>
            <td>
              ⭐ <b>{o.code}</b>
              {o.title ? ` — ${o.title}` : ''}
              {o.credits !== null ? ` (${o.credits} cr)` : ''}
            </td>
            <td>{STATE_LABEL[stateOf(o.code, states)]}</td>
            <td>
              {[...o.appearsIn.entries()].map(([degreeId, groups]) => {
                const degree = degrees.find((d) => d.id === degreeId);
                return (
                  <span class="pl-degree-tag" title={`${degree?.name ?? degreeId}: ${groups.join(', ')}`}>
                    {degree?.name ?? degreeId}
                  </span>
                );
              })}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function OverlapView({ degrees, states }: Props) {
  const overlaps = findOverlaps(degrees);
  if (degrees.length < 2) {
    return (
      <div class="pl-card">
        <h2>Course overlap</h2>
        <p class="pl-muted">Add at least two degrees to see which courses count toward several of them.</p>
      </div>
    );
  }
  const combos = groupOverlapsByCombo(overlaps);
  const nameOf = (id: string) => degrees.find((d) => d.id === id)?.name ?? id;
  return (
    <div class="pl-card">
      <h2>Course overlap across degrees</h2>
      <p class="pl-muted">
        ⭐ These courses appear in two or more selected programs — <b>take these first</b>: each one
        knocks out requirements in multiple degrees (confirm your school's double-counting policy).
        {degrees.length > 2 &&
          ' Grouped by which programs share them — courses counting toward ALL your programs come first, then each combination.'}
      </p>
      {overlaps.length === 0 ? (
        <p class="pl-muted">No overlapping courses found.</p>
      ) : degrees.length <= 2 ? (
        <OverlapTable entries={overlaps} degrees={degrees} states={states} />
      ) : (
        combos.map((combo) => (
          <div class="pl-overlap-combo">
            <h3 class="pl-overlap-combo-title">
              {combo.degreeIds.length === degrees.length && (
                <span class="pl-overlap-all">🏆 ALL {degrees.length} programs</span>
              )}
              {combo.degreeIds.map((id, i) => (
                <>
                  {i > 0 && <span class="pl-muted">+</span>}
                  <span class="pl-degree-tag">{nameOf(id)}</span>
                </>
              ))}
              <span class="pl-muted">
                — {combo.entries.length} shared course{combo.entries.length === 1 ? '' : 's'}
              </span>
            </h3>
            <OverlapTable entries={combo.entries} degrees={degrees} states={states} />
          </div>
        ))
      )}
    </div>
  );
}
