/**
 * History of every AI-powered action (advisor chats, degree/prereq research,
 * AI parses). Saved by the background worker so results aren't lost when the
 * page is closed or the user switches away mid-request. Supports removing a
 * single entry, selecting several to remove, or clearing everything.
 */
import { useEffect, useState } from 'preact/hooks';
import type { AiFeature, AiHistoryEntry, DegreeProgram, RequirementGroup } from '../shared/types';
import { getStored, onStoredChange } from '../shared/storage';
import { sendToBackground } from '../background/messages';

function ruleLabel(g: RequirementGroup): string {
  if (g.rule.kind === 'chooseN') return `choose ${g.rule.n ?? 1}`;
  if (g.rule.kind === 'credits') return `${g.rule.credits ?? '?'} credits`;
  return 'all required';
}

/** Full requirement tree for a researched/imported program. */
function DegreeRequirements({ degree }: { degree: DegreeProgram }) {
  return (
    <div class="pl-aihist-degree">
      <div>
        <b>{degree.name}</b> <span class="pl-degree-tag">{degree.type}</span>
        {degree.totalCredits ? <span class="pl-muted"> · {degree.totalCredits} total credits</span> : null}
      </div>
      {degree.groups.map((g) => (
        <div class="pl-aihist-group">
          <div>
            <b>{g.title}</b> <span class="pl-muted">[{ruleLabel(g)}]</span>
          </div>
          <div>
            {g.courses.length === 0 ? (
              <span class="pl-muted">(category requirement — no fixed course list)</span>
            ) : (
              g.courses.map((c) => (
                <span class="pl-chip none" title={c.title ?? c.code}>
                  {c.code}
                </span>
              ))
            )}
          </div>
          {g.notes && <p class="pl-muted">📝 {g.notes}</p>}
        </div>
      ))}
    </div>
  );
}

const FEATURE_META: Record<AiFeature, { icon: string; label: string }> = {
  chat: { icon: '💬', label: 'Advisor chat' },
  'degree-research': { icon: '🔎', label: 'Degree research' },
  'prereq-research': { icon: '🧩', label: 'Prerequisite lookup' },
  'degree-parse': { icon: '📄', label: 'Degree import' },
  'transcript-parse': { icon: '🎓', label: 'Transcript parse' },
};

function formatWhen(at: number): string {
  const d = new Date(at);
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  );
}

export function AiHistory() {
  const [entries, setEntries] = useState<AiHistoryEntry[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // entries whose full requirement tree is expanded (degree research/imports)
  const [reqsOpen, setReqsOpen] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    void getStored('aiHistory').then(setEntries);
    return onStoredChange('aiHistory', setEntries);
  }, []);

  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleReqs = (id: string) =>
    setReqsOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const remove = (ids: string[]) => {
    if (ids.length === 0) return;
    void sendToBackground({ kind: 'AI_HISTORY_REMOVE', ids });
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  };

  const clearAll = () => {
    if (confirm('Clear all AI history? This cannot be undone.')) {
      void sendToBackground({ kind: 'AI_HISTORY_CLEAR' });
    }
  };

  const exitSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const allSelected = entries.length > 0 && selected.size === entries.length;

  return (
    <div class="pl-card">
      <div class="pl-row">
        <h2>AI history</h2>
        <span class="pl-muted">Every AI result is saved here so you never lose one.</span>
        {entries.length > 0 &&
          (selecting ? (
            <>
              <button
                class="pl-btn secondary"
                onClick={() => setSelected(allSelected ? new Set() : new Set(entries.map((e) => e.id)))}
              >
                {allSelected ? 'Select none' : 'Select all'}
              </button>
              <button
                class="pl-btn danger"
                disabled={selected.size === 0}
                onClick={() => remove([...selected])}
              >
                Remove selected ({selected.size})
              </button>
              <button class="pl-btn secondary" onClick={exitSelect}>
                Done
              </button>
            </>
          ) : (
            <>
              <button class="pl-btn secondary" onClick={() => setSelecting(true)}>
                Select
              </button>
              <button class="pl-btn danger" onClick={clearAll}>
                Clear all
              </button>
            </>
          ))}
      </div>

      {entries.length === 0 ? (
        <p class="pl-muted">
          No AI activity yet. Use the ✨ AI Advisor, or the auto-find buttons when adding a degree or
          a prerequisite — results will appear here.
        </p>
      ) : (
        <div class="pl-aihist">
          {entries.map((e) => {
            const meta = FEATURE_META[e.feature];
            const isOpen = open.has(e.id);
            const isSel = selected.has(e.id);
            return (
              <div class={`pl-aihist-item${isSel ? ' selected' : ''}`}>
                <div class="pl-aihist-head">
                  {selecting && (
                    <input
                      type="checkbox"
                      class="pl-aihist-check"
                      checked={isSel}
                      onChange={() => toggleSelected(e.id)}
                    />
                  )}
                  <span
                    class="pl-aihist-icon"
                    title={meta.label}
                    onClick={() => (selecting ? toggleSelected(e.id) : toggleOpen(e.id))}
                  >
                    {meta.icon}
                  </span>
                  <span
                    class="pl-aihist-title"
                    onClick={() => (selecting ? toggleSelected(e.id) : toggleOpen(e.id))}
                  >
                    {e.title}
                  </span>
                  <span class="pl-muted pl-aihist-when">{formatWhen(e.at)}</span>
                  {!selecting && (
                    <>
                      <span class="pl-aihist-caret" onClick={() => toggleOpen(e.id)}>
                        {isOpen ? '▾' : '▸'}
                      </span>
                      <button
                        class="pl-aihist-remove"
                        title="Remove this entry"
                        onClick={() => remove([e.id])}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
                {isOpen && !selecting && (
                  <div class="pl-aihist-detail">
                    <div class="pl-aihist-feature pl-muted">{meta.label}</div>
                    {e.detail}
                    {e.degree && (
                      <div>
                        <button class="pl-btn secondary pl-aihist-reqbtn" onClick={() => toggleReqs(e.id)}>
                          {reqsOpen.has(e.id) ? '▴ Hide full requirements' : '▾ Show full requirements'}
                        </button>
                        {reqsOpen.has(e.id) && <DegreeRequirements degree={e.degree} />}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
