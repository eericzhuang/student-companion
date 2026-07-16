/**
 * Level-up game UI: hero banner on the Progress tab (medallion with a
 * conic progress ring, XP bar, breakdown, next-rank preview), a compact
 * header chip shown on every tab, and the full-screen celebration overlay
 * that plays once per newly reached level (tracked in plannerState.seenLevel).
 *
 * Clicking the XP bar opens the "journey" ladder: all 10 ranks, each row
 * dressed in its own tier theme, plus the XP rules. Every rank has a "try it"
 * button that temporarily previews that level's look — pure cosmetics, the
 * real level never changes. The owner (admin unlock) additionally gets a
 * "use theme" button that pins a rank's theme permanently; progress numbers
 * always stay real.
 */
import { useEffect, useState } from 'preact/hooks';
import type { PlannerState } from '../shared/types';
import { sendToBackground } from '../background/messages';
import {
  RANKS,
  XP_PER_COURSE,
  XP_PER_DEGREE,
  XP_PER_GROUP,
  type LevelInfo,
  type Rank,
} from './engine/levels';

const rankOf = (level: number): Rank => RANKS.find((r) => r.level === level) ?? RANKS[0]!;

interface ChipProps {
  info: LevelInfo;
  /** rank being theme-previewed (from the journey ladder), if any */
  previewLevel?: number | null;
  /** theme the UI wears (real level, or the owner-pinned one) */
  themeLevel?: number;
}

export function LevelChip({ info, previewLevel, themeLevel }: ChipProps) {
  const previewing = previewLevel != null;
  // Preview swaps the text too (that's the point); a pinned theme only
  // changes the colors — the chip keeps telling the truth.
  const shown = previewing ? rankOf(previewLevel) : rankOf(info.level);
  const wear = previewing ? previewLevel : (themeLevel ?? info.level);
  return (
    <span
      class={`pl-lv-chip pl-lv-${wear}${previewing ? ' pl-lv-previewing' : ''}`}
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
  /** theme the UI wears (real level, or the owner-pinned one) */
  themeLevel: number;
  /** owner mode: can pin any rank's theme */
  isAdmin: boolean;
  /** the owner's pinned theme level, if any */
  pinnedTheme: number | null;
  onPickTheme: (level: number | null) => void;
}

export function LevelHero({
  info,
  plannerState,
  previewLevel,
  onPreview,
  themeLevel,
  isAdmin,
  pinnedTheme,
  onPickTheme,
}: HeroProps) {
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

  const previewRank = previewLevel != null ? rankOf(previewLevel) : null;
  const wearLevel = previewRank?.level ?? themeLevel;
  const shownIcon = previewRank?.icon ?? info.icon;
  const shownTitle = previewRank?.title ?? info.title;
  const themedDifferently = !previewRank && themeLevel !== info.level;

  const { breakdown: b, next } = info;

  return (
    <>
      <div class={`pl-card pl-lv-hero pl-lv-${wearLevel}${previewRank ? ' pl-lv-previewing' : ''}`}>
        <div class="pl-lv-medal" style={{ '--lv-ring': previewRank ? '100%' : `${info.pct}%` }}>
          <span class="pl-lv-medal-inner">
            <span class="pl-lv-num">{previewRank?.level ?? info.level}</span>
          </span>
        </div>
        <div class="pl-lv-body">
          <div class="pl-lv-title">
            {shownIcon} {shownTitle}
            <span class="pl-lv-xp">{info.xp} XP</span>
            {themedDifferently && (
              <span class="pl-lv-theme-tag" title="Owner theme — colors only, your progress numbers are real">
                🎨 {rankOf(themeLevel).title} theme
              </span>
            )}
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
                title="Click to see your full journey — every rank, its look, and how XP works"
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
                  {b.courses} courses (+{b.courseXp} XP) · {b.groups} requirements (+{b.groupXp}) ·{' '}
                  {b.degrees} degree{b.degrees === 1 ? '' : 's'} (+{b.degreeXp})
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
          <p class="pl-lv-xprules">
            <b>How XP is earned:</b> +{XP_PER_COURSE} per completed course · +{XP_PER_GROUP} per
            requirement group you finish · +{XP_PER_DEGREE} per completed degree. A course that counts
            toward several degrees earns XP in each one — and only <b>completed</b> work counts, so
            planned courses move your requirement bars but never your level.
          </p>
          <p class="pl-muted">
            Each rank restyles the whole extension — the higher, the fancier. Hit <b>👀 try it</b> on
            any rank to see yourself at that level (a costume, not a shortcut — your real XP never
            changes).
            {isAdmin && (
              <>
                {' '}
                As the owner you can also <b>🎨 use</b> any rank's theme permanently — your progress
                numbers stay real.
              </>
            )}
          </p>
          {RANKS.map((r) => {
            const reached = info.xp >= r.at;
            const current = r.level === info.level;
            const previewing = previewLevel === r.level;
            const pinned = pinnedTheme === r.level;
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
                {isAdmin && (
                  <button
                    class={`pl-lv-jtry${pinned ? ' active' : ''}`}
                    title={pinned ? 'Stop using this theme (follow your real level again)' : 'Wear this rank\'s theme everywhere — progress numbers stay real'}
                    onClick={() => onPickTheme(pinned ? null : r.level)}
                  >
                    {pinned ? '🎨 my theme ✓' : '🎨 use'}
                  </button>
                )}
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
