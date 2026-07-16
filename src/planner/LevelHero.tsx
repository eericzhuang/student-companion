/**
 * Level-up game UI: hero banner on the Progress tab (medallion with a
 * conic progress ring, XP bar, breakdown, next-rank preview), a compact
 * header chip shown on every tab, and the full-screen celebration overlay
 * that plays once per newly reached level (tracked in plannerState.seenLevel).
 *
 * Clicking the XP bar opens the "journey" ladder: all 10 ranks, each row
 * dressed in its own tier theme. Every rank has a "try it" button that
 * temporarily previews that level's look on the hero card and header chip —
 * pure cosmetics, the real level never changes.
 */
import { useEffect, useState } from 'preact/hooks';
import type { PlannerState } from '../shared/types';
import { sendToBackground } from '../background/messages';
import { RANKS, type LevelInfo, type Rank } from './engine/levels';

interface ChipProps {
  info: LevelInfo;
  /** rank being theme-previewed (from the journey ladder), if any */
  previewLevel?: number | null;
}

export function LevelChip({ info, previewLevel }: ChipProps) {
  const shown: Rank = RANKS.find((r) => r.level === previewLevel) ?? {
    level: info.level,
    title: info.title,
    icon: info.icon,
    at: 0,
  };
  const previewing = shown.level !== info.level || previewLevel != null;
  return (
    <span
      class={`pl-lv-chip pl-lv-${shown.level}${previewing ? ' pl-lv-previewing' : ''}`}
      title={previewing ? `Theme preview — you are really Level ${info.level} (${info.xp} XP)` : `${info.xp} XP — ${info.title}`}
    >
      {previewing && '🎭 '}
      {shown.icon} Lv {shown.level} · {shown.title}
    </span>
  );
}

interface HeroProps {
  info: LevelInfo;
  plannerState: PlannerState;
  previewLevel: number | null;
  onPreview: (level: number | null) => void;
}

export function LevelHero({ info, plannerState, previewLevel, onPreview }: HeroProps) {
  const seen = plannerState.seenLevel;
  const [celebrating, setCelebrating] = useState(false);
  const [journeyOpen, setJourneyOpen] = useState(false);

  const persistSeen = (level: number) =>
    void sendToBackground({ kind: 'PLANNER_STATE_UPDATE', state: { ...plannerState, seenLevel: level } });

  useEffect(() => {
    // First run (or level lost by un-marking courses): sync silently so the
    // next real level-up celebrates. Genuine gain: play the celebration.
    if (seen === undefined || info.level < seen) persistSeen(info.level);
    else if (info.level > seen) setCelebrating(true);
  }, [info.level, seen]);

  const dismiss = () => {
    setCelebrating(false);
    persistSeen(info.level);
  };

  const previewRank = RANKS.find((r) => r.level === previewLevel) ?? null;
  const shownLevel = previewRank?.level ?? info.level;
  const shownIcon = previewRank?.icon ?? info.icon;
  const shownTitle = previewRank?.title ?? info.title;

  const { breakdown: b, next } = info;

  return (
    <>
      <div class={`pl-card pl-lv-hero pl-lv-${shownLevel}${previewRank ? ' pl-lv-previewing' : ''}`}>
        <div class="pl-lv-medal" style={{ '--lv-ring': previewRank ? '100%' : `${info.pct}%` }}>
          <span class="pl-lv-medal-inner">
            <span class="pl-lv-num">{shownLevel}</span>
          </span>
        </div>
        <div class="pl-lv-body">
          <div class="pl-lv-title">
            {shownIcon} {shownTitle}
            <span class="pl-lv-xp">{info.xp} XP</span>
          </div>
          {previewRank ? (
            <div class="pl-lv-preview-note">
              🎭 Previewing the <b>Level {previewRank.level}</b> look — your real rank is Level {info.level} ·{' '}
              {info.title}.{' '}
              <button class="pl-link-inline" onClick={() => onPreview(null)}>
                ↩ back to my level
              </button>
            </div>
          ) : (
            <>
              <button
                class="pl-lv-bar"
                title="Click to see your full journey — every rank and its look"
                onClick={() => setJourneyOpen(!journeyOpen)}
              >
                <div style={{ width: `${info.pct}%` }} />
              </button>
              <div class="pl-lv-meta">
                {next ? (
                  <span>
                    Next: <b>{next.icon} {next.title}</b> at {next.at} XP — {next.at - info.xp} to go
                  </span>
                ) : (
                  <span>Max rank reached — you are a legend. 🌟</span>
                )}
                <span class="pl-muted" title="Only completed work earns XP — planned courses don't count until you finish them">
                  {b.courses} courses · {b.groups} requirements · {b.degrees} degree{b.degrees === 1 ? '' : 's'} done
                  {' · '}
                  <button class="pl-link-inline" onClick={() => setJourneyOpen(!journeyOpen)}>
                    {journeyOpen ? 'hide journey' : '🗺 full journey'}
                  </button>
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {journeyOpen && (
        <div class="pl-card pl-lv-journey">
          <div class="pl-row">
            <h2>🗺 Your journey — 10 ranks, 10 looks</h2>
            <button class="pl-btn secondary" onClick={() => setJourneyOpen(false)}>
              Close
            </button>
          </div>
          <p class="pl-muted">
            Each rank restyles your level card — the higher, the fancier. Hit <b>👀 try it</b> on any
            rank to see yourself at that level (a costume, not a shortcut — your real XP never changes).
          </p>
          {RANKS.map((r) => {
            const reached = info.xp >= r.at;
            const current = r.level === info.level;
            const previewing = previewLevel === r.level;
            return (
              <div class={`pl-lv-jrow pl-lv-${r.level}${current ? ' current' : ''}`}>
                <span class="pl-lv-jmedal">{r.level}</span>
                <span class="pl-lv-jtitle">
                  {r.icon} {r.title}
                </span>
                <span class="pl-lv-jxp">
                  {r.at} XP
                  {current && <b class="pl-lv-jyou">★ you are here</b>}
                  {!reached && !current && <span class="pl-muted"> · {r.at - info.xp} to go 🔒</span>}
                  {reached && !current && ' · ✓ reached'}
                </span>
                <button
                  class={`pl-lv-jtry${previewing ? ' active' : ''}`}
                  onClick={() => onPreview(previewing ? null : r.level)}
                >
                  {previewing ? '↩ stop' : current ? '✔ current' : '👀 try it'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {celebrating && (
        <div class="pl-lv-overlay" onClick={dismiss}>
          <div class="pl-lv-confetti">
            {Array.from({ length: 24 }, () => (
              <i />
            ))}
          </div>
          <div class={`pl-lv-pop pl-lv-${info.level}`}>
            <div class="pl-lv-pop-icon">{info.icon}</div>
            <div class="pl-lv-pop-title">LEVEL UP!</div>
            <div class="pl-lv-pop-rank">
              Level {info.level} — {info.title}
            </div>
            <button class="pl-btn" onClick={dismiss}>
              Keep going ✨
            </button>
          </div>
        </div>
      )}
    </>
  );
}
