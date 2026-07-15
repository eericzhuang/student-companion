/**
 * Click-through popover for an RMP badge: stats, top comments, and a
 * "Not this professor?" correction flow that searches RMP live and stores a
 * persistent override.
 */
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { RmpCacheEntry, RmpTeacher } from '../../shared/types';
import { sendToBackground } from '../../background/messages';
import { rmpProfessorUrl } from '../../shared/rmpUrl';
import { createShadowContainer } from './mountPanel';

const POPOVER_ID = 'wdc-rmp-popover-host';

export function openRmpPopover(
  instructorName: string,
  entry: RmpCacheEntry | null,
  x: number,
  y: number,
): void {
  const { container, root } = createShadowContainer(POPOVER_ID);
  const close = () => container.remove();
  render(
    <Popover instructorName={instructorName} initialEntry={entry} x={x} y={y} onClose={close} />,
    root,
  );
}

interface TeacherCandidate {
  id: string;
  firstName: string;
  lastName: string;
  department: string | null;
  avgRating: number | null;
  numRatings: number;
}

function Popover(props: {
  instructorName: string;
  initialEntry: RmpCacheEntry | null;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState(props.initialEntry);
  const [correcting, setCorrecting] = useState(false);
  const [query, setQuery] = useState(props.instructorName);
  const [candidates, setCandidates] = useState<TeacherCandidate[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const search = async () => {
    setBusy(true);
    try {
      const res = await sendToBackground<{ teachers: TeacherCandidate[] }>({
        kind: 'RMP_SEARCH_TEACHERS',
        query,
      });
      setCandidates(res.teachers);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (teacherId: string) => {
    setBusy(true);
    try {
      const res = await sendToBackground<{ entry: RmpCacheEntry | null }>({
        kind: 'RMP_SET_OVERRIDE',
        instructorName: props.instructorName,
        teacherId,
      });
      setEntry(res.entry);
      setCorrecting(false);
    } finally {
      setBusy(false);
    }
  };

  const left = Math.min(props.x, window.innerWidth - 360);
  const top = Math.min(props.y + 8, window.innerHeight - 440);
  const teacher: RmpTeacher | null = entry?.teacher ?? null;

  return (
    <div class="wdc-popover" style={{ left: `${left}px`, top: `${top}px` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
        <div>
          {teacher ? (
            <>
              <h3>
                {teacher.firstName} {teacher.lastName}
              </h3>
              <div class="wdc-dept">{teacher.department ?? ''}</div>
            </>
          ) : (
            <h3>{props.instructorName}</h3>
          )}
        </div>
        <button class="wdc-link-btn" onClick={props.onClose}>
          ✕
        </button>
      </div>

      {teacher ? (
        <>
          <div class="wdc-stats">
            <div class="wdc-stat">
              <b>{teacher.avgRating?.toFixed(1) ?? '—'}</b>
              <span>quality / 5</span>
            </div>
            <div class="wdc-stat">
              <b>{teacher.avgDifficulty?.toFixed(1) ?? '—'}</b>
              <span>difficulty / 5</span>
            </div>
            <div class="wdc-stat">
              <b>{teacher.wouldTakeAgainPercent !== null ? `${Math.round(teacher.wouldTakeAgainPercent)}%` : '—'}</b>
              <span>would retake</span>
            </div>
          </div>
          <div class="wdc-dept">
            {teacher.numRatings} ratings on RateMyProfessors
            {entry?.uncertain ? ' · ⚠ match uncertain' : ''}
          </div>
          {rmpProfessorUrl(teacher.teacherId) && (
            <a
              class="wdc-rmp-link"
              href={rmpProfessorUrl(teacher.teacherId)!}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open full profile on RateMyProfessors ↗
            </a>
          )}
          {teacher.topComments.length > 0 && (
            <div>
              {teacher.topComments.map((c) => (
                <div class="wdc-comment">
                  <div class="wdc-comment-meta">
                    {c.courseName ? `${c.courseName} · ` : ''}
                    quality {c.quality ?? '—'} · difficulty {c.difficulty ?? '—'}
                    {c.date ? ` · ${c.date.slice(0, 10)}` : ''}
                  </div>
                  <div>{c.text}</div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div class="wdc-dept" style={{ margin: '8px 0' }}>
          No RateMyProfessors profile matched this instructor.
        </div>
      )}

      {correcting ? (
        <div class="wdc-correction">
          <input
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
            placeholder="Search professor name…"
          />
          <button class="wdc-link-btn" onClick={() => void search()} disabled={busy}>
            {busy ? 'Searching…' : 'Search'}
          </button>
          <div style={{ marginTop: '6px' }}>
            {candidates.map((c) => (
              <button class="wdc-candidate" onClick={() => void pick(c.id)} disabled={busy}>
                <b>
                  {c.firstName} {c.lastName}
                </b>
                {c.department ? ` · ${c.department}` : ''} · ★{c.avgRating?.toFixed(1) ?? '—'} (
                {c.numRatings})
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button class="wdc-link-btn" onClick={() => setCorrecting(true)}>
          Not this professor? Pick the right one
        </button>
      )}
    </div>
  );
}
