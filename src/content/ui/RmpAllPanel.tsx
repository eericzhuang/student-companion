/**
 * "Rate all professors on this page" panel. Scans the current page for
 * instructor names, looks each up on RateMyProfessors, and lists them sorted
 * by rating. Each row expands to show that professor's top comments.
 */
import { useEffect, useState } from 'preact/hooks';
import type { RmpCacheEntry } from '../../shared/types';
import { sendToBackground, type RmpLookupResult } from '../../background/messages';
import { rmpProfessorUrl } from '../../shared/rmpUrl';
import { scanProfessorNames } from '../scrapers/professors';
import { rmpPanelSignal } from './captureState';
import { useDraggable } from './useDraggable';
import { getStored } from '../../shared/storage';
import { isPro } from '../../shared/plan';

interface Row {
  name: string;
  entry: RmpCacheEntry | null;
  loading: boolean;
}

function ratingClass(rating: number | null): string {
  if (rating === null) return 'none';
  if (rating >= 3.8) return 'good';
  if (rating >= 2.8) return 'mid';
  return 'bad';
}

export function RmpAllPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [scanned, setScanned] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [pro, setPro] = useState(false);
  const { pos, startDrag, wasDragged } = useDraggable({
    x: Math.max(8, window.innerWidth - 356),
    y: 80,
  });

  const [manualName, setManualName] = useState('');

  const lookup = async (name: string) => {
    const result = await sendToBackground<RmpLookupResult>({
      kind: 'RMP_LOOKUP',
      instructorName: name,
    }).catch(() => null);
    if (result?.needsSetup) {
      setNeedsSetup(true);
      return;
    }
    setRows((prev) =>
      prev.map((r) => (r.name === name ? { ...r, entry: result?.entry ?? null, loading: false } : r)),
    );
  };

  const addManual = () => {
    const name = manualName.trim();
    if (!name || rows.some((r) => r.name === name)) return;
    setRows((prev) => [{ name, entry: null, loading: true }, ...prev]);
    setScanned((n) => n + 1);
    setManualName('');
    void lookup(name);
  };

  // Fallback-scanned names are guesses from free page text and may include
  // non-instructors — hold them here until the user confirms sending to RMP.
  const [confirmNames, setConfirmNames] = useState<string[] | null>(null);

  useEffect(() => {
    void getStored('settings').then((s) => setPro(isPro(s))); // animations are Pro-only
    const scan = scanProfessorNames(document);
    setScanned(scan.names.length);

    if (scan.source === 'fallback' && scan.names.length > 0) {
      setRows(scan.names.map((name) => ({ name, entry: null, loading: false })));
      setConfirmNames(scan.names);
      return;
    }

    setRows(scan.names.map((name) => ({ name, entry: null, loading: true })));
    let cancelled = false;
    (async () => {
      for (const name of scan.names) {
        if (cancelled) return;
        await lookup(name);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const confirmLookups = () => {
    const names = confirmNames ?? [];
    setConfirmNames(null);
    setRows((prev) => prev.map((r) => (names.includes(r.name) ? { ...r, loading: true } : r)));
    void (async () => {
      for (const name of names) await lookup(name);
    })();
  };

  const dismissScan = () => {
    const names = new Set(confirmNames ?? []);
    setConfirmNames(null);
    setRows((prev) => prev.filter((r) => !names.has(r.name)));
    setScanned(0);
  };

  // Sort: rated first (desc), then unrated/loading last.
  const sorted = [...rows].sort((a, b) => {
    const ra = a.entry?.teacher?.avgRating ?? -1;
    const rb = b.entry?.teacher?.avgRating ?? -1;
    return rb - ra;
  });

  const doneCount = rows.filter((r) => !r.loading).length;

  if (collapsed) {
    return (
      <div
        class={`wdc-rmp-collapsed-pill${pro ? ' wdc-pro' : ''}`}
        // width/height auto overrides any inline size the resize handle left behind,
        // so minimizing a resized panel yields a small pill (not a giant one).
        style={{ left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto', width: 'auto', height: 'auto' }}
        title="Show professor ratings (drag to move)"
        onPointerDown={startDrag}
        onClick={() => !wasDragged() && setCollapsed(false)}
      >
        ⭐ Professors ({scanned})
      </div>
    );
  }

  return (
    <div class={`wdc-rmp-panel${pro ? ' wdc-pro' : ''}`} style={{ left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto' }}>
      {/* background comes from .wdc-rmp-panel .wdc-panel-header so the Pro gradient can override it */}
      <div class="wdc-panel-header" onPointerDown={startDrag}>
        <span>🎓 Professors on this page ({scanned})</span>
        <span style={{ display: 'flex', gap: '4px' }}>
          <button title="Minimize" onClick={() => setCollapsed(true)}>
            —
          </button>
          <button title="Hide" onClick={() => (rmpPanelSignal.value = false)}>
            ✕
          </button>
        </span>
      </div>

      {needsSetup ? (
        <div class="wdc-empty">
          Set your school in the extension Options first, then reopen this panel.
        </div>
      ) : (
        <>
          <div class="wdc-rmp-add">
            <input
              type="text"
              placeholder="Add a professor by name…"
              value={manualName}
              onInput={(e) => setManualName((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => e.key === 'Enter' && addManual()}
            />
            <button onClick={addManual} disabled={!manualName.trim()}>
              Look up
            </button>
          </div>
          {confirmNames && (
            <div class="wdc-panel-sub" style={{ padding: '8px 10px' }}>
              No instructor column found, so these names were <b>guessed from page text</b> and
              may include people who aren't professors. Look them up on RateMyProfessors?
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                <button class="wdc-capture-btn" onClick={confirmLookups}>
                  Look up {confirmNames.length} name{confirmNames.length === 1 ? '' : 's'}
                </button>
                <button class="wdc-capture-btn" onClick={dismissScan}>
                  Dismiss
                </button>
              </div>
            </div>
          )}
          <div class="wdc-panel-sub">
            {scanned === 0
              ? 'No instructor names auto-detected — add one above.'
              : confirmNames
                ? 'Waiting for your confirmation above.'
                : doneCount < rows.length
                  ? `Looking up… ${doneCount}/${rows.length}`
                  : `${rows.length} instructors`}
          </div>
          <div class="wdc-rmp-list">
            {sorted.map((row) => {
              const t = row.entry?.teacher ?? null;
              const isOpen = expanded === row.name;
              return (
                <div class="wdc-rmp-item">
                  <div
                    class="wdc-rmp-item-head"
                    onClick={() => setExpanded(isOpen ? null : row.name)}
                  >
                    <span class="wdc-rmp-item-name">{row.name}</span>
                    {row.loading ? (
                      <span class="wdc-rmp-badge none">…</span>
                    ) : t ? (
                      <span class={`wdc-rmp-badge ${ratingClass(t.avgRating)}${row.entry?.uncertain ? ' uncertain' : ''}`}>
                        {t.avgRating !== null ? `★ ${t.avgRating.toFixed(1)}` : 'RMP'}
                      </span>
                    ) : (
                      <span class="wdc-rmp-badge none">no match</span>
                    )}
                  </div>
                  {isOpen && t && (
                    <div class="wdc-rmp-item-body">
                      <div class="wdc-stats">
                        <div class="wdc-stat">
                          <b>{t.avgRating?.toFixed(1) ?? '—'}</b>
                          <span>quality</span>
                        </div>
                        <div class="wdc-stat">
                          <b>{t.avgDifficulty?.toFixed(1) ?? '—'}</b>
                          <span>difficulty</span>
                        </div>
                        <div class="wdc-stat">
                          <b>{t.wouldTakeAgainPercent !== null ? `${Math.round(t.wouldTakeAgainPercent)}%` : '—'}</b>
                          <span>retake</span>
                        </div>
                      </div>
                      <div class="wdc-dept">
                        {t.department ?? ''} · {t.numRatings} ratings
                        {row.entry?.uncertain ? ' · ⚠ match uncertain' : ''}
                      </div>
                      {rmpProfessorUrl(t.teacherId) && (
                        <a
                          class="wdc-rmp-link"
                          href={rmpProfessorUrl(t.teacherId)!}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open full profile ↗
                        </a>
                      )}
                      {t.topComments.map((c) => (
                        <div class="wdc-comment">
                          <div class="wdc-comment-meta">
                            {c.courseName ? `${c.courseName} · ` : ''}quality {c.quality ?? '—'} · difficulty{' '}
                            {c.difficulty ?? '—'}
                          </div>
                          <div>{c.text}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
