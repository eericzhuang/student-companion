/**
 * Review/edit screen shown after Claude parses a catalog page: the structured
 * requirement tree beside the source text, editable before saving.
 */
import { useState } from 'preact/hooks';
import type { DegreeProgram, RequirementGroup } from '../shared/types';
import { sendToBackground, type DegreeSaveResult } from '../background/messages';

interface Props {
  initial: DegreeProgram;
  sourceUrl: string | null;
  sourceText: string;
  existingId: string | null;
  onDone: () => void;
  onCancel: () => void;
}

export function ReviewEditor({ initial, sourceUrl, sourceText, existingId, onDone, onCancel }: Props) {
  const [degree, setDegree] = useState<DegreeProgram>(structuredClone(initial));
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (fn: (d: DegreeProgram) => void) => {
    const next = structuredClone(degree);
    fn(next);
    setDegree(next);
    setEdited(true);
  };

  const updateGroup = (gi: number, fn: (g: RequirementGroup) => void) =>
    update((d) => fn(d.groups[gi]!));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendToBackground<DegreeSaveResult>({
        kind: 'DEGREE_SAVE',
        degree,
        id: existingId,
        sourceUrl,
        userEdited: edited,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="pl-card">
      <h2>Review parsed requirements</h2>
      <p class="pl-muted">
        Check the parse against the source text on the right. Fix rules, remove noise groups, and
        correct course codes before saving — the planner is only as good as this data.
      </p>
      {error && <div class="pl-error">{error}</div>}

      <div class="pl-row" style={{ margin: '10px 0' }}>
        <input
          type="text"
          value={degree.name}
          onInput={(e) => update((d) => (d.name = (e.target as HTMLInputElement).value))}
        />
        <select
          value={degree.type}
          onChange={(e) =>
            update((d) => (d.type = (e.target as HTMLSelectElement).value as DegreeProgram['type']))
          }
          style={{ width: '130px' }}
        >
          <option value="major">major</option>
          <option value="minor">minor</option>
          <option value="certificate">certificate</option>
          <option value="other">other</option>
        </select>
        <input
          type="number"
          placeholder="total credits"
          value={degree.totalCredits ?? ''}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            update((d) => (d.totalCredits = v ? parseFloat(v) : null));
          }}
          style={{ width: '120px' }}
        />
      </div>

      <div class="pl-editor-grid">
        <div>
          {degree.groups.map((group, gi) => (
            <div class="pl-group">
              <div class="pl-row">
                <input
                  type="text"
                  value={group.title}
                  onInput={(e) => updateGroup(gi, (g) => (g.title = (e.target as HTMLInputElement).value))}
                  style={{ fontWeight: 600 }}
                />
                <select
                  value={group.rule.kind}
                  onChange={(e) =>
                    updateGroup(gi, (g) => (g.rule.kind = (e.target as HTMLSelectElement).value as RequirementGroup['rule']['kind']))
                  }
                  style={{ width: '110px' }}
                >
                  <option value="all">all of</option>
                  <option value="chooseN">choose N</option>
                  <option value="credits">credits</option>
                </select>
                {group.rule.kind === 'chooseN' && (
                  <input
                    type="number"
                    value={group.rule.n ?? 1}
                    onInput={(e) => updateGroup(gi, (g) => (g.rule.n = parseInt((e.target as HTMLInputElement).value, 10) || 1))}
                    style={{ width: '64px' }}
                  />
                )}
                {group.rule.kind === 'credits' && (
                  <input
                    type="number"
                    value={group.rule.credits ?? 0}
                    onInput={(e) => updateGroup(gi, (g) => (g.rule.credits = parseFloat((e.target as HTMLInputElement).value) || 0))}
                    style={{ width: '64px' }}
                  />
                )}
                <button
                  class="pl-btn danger"
                  title="Remove this group"
                  onClick={() => update((d) => d.groups.splice(gi, 1))}
                >
                  ✕
                </button>
              </div>
              <table class="pl-table">
                {group.courses.map((course, ci) => (
                  <tr>
                    <td style={{ width: '110px' }}>
                      <input
                        type="text"
                        value={course.code}
                        onInput={(e) => updateGroup(gi, (g) => (g.courses[ci]!.code = (e.target as HTMLInputElement).value))}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={course.title ?? ''}
                        placeholder="title"
                        onInput={(e) => updateGroup(gi, (g) => (g.courses[ci]!.title = (e.target as HTMLInputElement).value || null))}
                      />
                    </td>
                    <td style={{ width: '70px' }}>
                      <input
                        type="number"
                        value={course.credits ?? ''}
                        placeholder="cr"
                        onInput={(e) => {
                          const v = (e.target as HTMLInputElement).value;
                          updateGroup(gi, (g) => (g.courses[ci]!.credits = v ? parseFloat(v) : null));
                        }}
                      />
                    </td>
                    <td style={{ width: '150px' }}>
                      <input
                        type="text"
                        value={course.prereqCodes.join(', ')}
                        placeholder="prereqs"
                        title="Comma-separated prerequisite course codes"
                        onInput={(e) =>
                          updateGroup(gi, (g) => (g.courses[ci]!.prereqCodes = (e.target as HTMLInputElement).value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean)))
                        }
                      />
                    </td>
                    <td style={{ width: '36px' }}>
                      <button class="pl-btn danger" onClick={() => updateGroup(gi, (g) => g.courses.splice(ci, 1))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </table>
              <button
                class="pl-btn secondary"
                onClick={() =>
                  updateGroup(gi, (g) => g.courses.push({ code: '', title: null, credits: null, prereqCodes: [] }))
                }
              >
                + course
              </button>
              {group.notes && <p class="pl-muted">📝 {group.notes}</p>}
            </div>
          ))}
          <p>
            <button
              class="pl-btn secondary"
              onClick={() =>
                update((d) =>
                  d.groups.push({ title: 'New group', rule: { kind: 'all' }, courses: [], notes: null }),
                )
              }
            >
              + requirement group
            </button>
          </p>
        </div>
        <div>
          <h2 style={{ fontSize: '14px' }}>Source text</h2>
          <div class="pl-source-pane">{sourceText.slice(0, 20000)}</div>
        </div>
      </div>

      <div class="pl-row" style={{ marginTop: '14px', justifyContent: 'flex-end' }}>
        <span class="pl-muted" style={{ flex: 1 }}>
          {sourceUrl ?? 'parsed from pasted text'}
        </span>
        <button class="pl-btn secondary" onClick={onCancel} disabled={busy}>
          Discard
        </button>
        <button class="pl-btn" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : 'Save degree'}
        </button>
      </div>
    </div>
  );
}
