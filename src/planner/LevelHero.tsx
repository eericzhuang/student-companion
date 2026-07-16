/**
 * Level-up game UI: hero banner on the Progress tab (medallion with a
 * conic progress ring, XP bar, breakdown, next-rank preview), a compact
 * header chip shown on every tab, and the full-screen celebration overlay
 * that plays once per newly reached level (tracked in plannerState.seenLevel).
 */
import { useEffect, useState } from 'preact/hooks';
import type { PlannerState } from '../shared/types';
import { sendToBackground } from '../background/messages';
import type { LevelInfo } from './engine/levels';

export function LevelChip({ info }: { info: LevelInfo }) {
  return (
    <span class={`pl-lv-chip pl-lv-${info.level}`} title={`${info.xp} XP — ${info.title}`}>
      {info.icon} Lv {info.level} · {info.title}
    </span>
  );
}

interface HeroProps {
  info: LevelInfo;
  plannerState: PlannerState;
}

export function LevelHero({ info, plannerState }: HeroProps) {
  const seen = plannerState.seenLevel;
  const [celebrating, setCelebrating] = useState(false);

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

  const { breakdown: b, next } = info;
  const ringPct = info.pct;

  return (
    <>
      <div class={`pl-card pl-lv-hero pl-lv-${info.level}`}>
        <div class="pl-lv-medal" style={{ '--lv-ring': `${ringPct}%` }}>
          <span class="pl-lv-medal-inner">
            <span class="pl-lv-num">{info.level}</span>
          </span>
        </div>
        <div class="pl-lv-body">
          <div class="pl-lv-title">
            {info.icon} {info.title}
            <span class="pl-lv-xp">{info.xp} XP</span>
          </div>
          <div class="pl-lv-bar">
            <div style={{ width: `${info.pct}%` }} />
          </div>
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
            </span>
          </div>
        </div>
      </div>

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
