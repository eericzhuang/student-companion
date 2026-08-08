/**
 * Beginner guide with two tracks: a 30-second Quick tour (one card per area)
 * and a Full tour (one card per module). Each step switches the planner to the
 * tab it describes so new users see the real thing. Auto-opens on first visit
 * (plannerState.guideSeen) and can be replayed from the ❓ Guide button.
 */
import { useState } from 'preact/hooks';

interface Step {
  /** planner tab to show while this step is up (undefined = stay put) */
  tab?: string;
  icon: string;
  title: string;
  body: string;
}

const QUICK_STEPS: Step[] = [
  {
    tab: 'progress',
    icon: '📊',
    title: 'Progress, GPA & levels',
    body: 'Live requirement bars for every degree — click a course chip to correct it. Above them: your GPA with what-if grade projections, and an XP level that grows with your progress.',
  },
  {
    tab: 'whatif',
    icon: '🔮',
    title: 'Plan ahead',
    body: 'What-if tests a course against every degree before you register. The Semester board lays out future terms, Overlap flags courses that count toward several degrees, and the AI Advisor (Pro) chats through it all.',
  },
  {
    icon: '🖥',
    title: 'On Workday itself',
    body: 'A floating calendar with conflict + walk-time warnings — click any class for its professor rating, room, and Canvas page. Saved schedules auto-become comparable Plans (friend compare included); export as 📷 image or 📆 .ics.',
  },
  {
    icon: '⚙',
    title: 'Make it yours',
    body: 'In ⚙ Options: dark mode, registration reminders, your Canvas address, full course names, campus map, one-file backup. Replay the Full tour anytime from ❓ Guide. 🎉',
  },
];

const FULL_STEPS: Step[] = [
  {
    tab: 'progress',
    icon: '📊',
    title: 'Progress',
    body: 'Every degree with live requirement bars. Click any course chip to mark it taken or not; if a tally is off, type the true count in the row\'s "done" box.',
  },
  {
    tab: 'progress',
    icon: '🏅',
    title: 'Level up',
    body: 'Completed work earns XP — 10 per course, 40 per requirement group, 200 per degree. Click your level card to see all 10 ranks and try their looks.',
  },
  {
    tab: 'progress',
    icon: '🎓',
    title: 'GPA & what-if grades',
    body: 'Your cumulative GPA from your history. Open "What-if grades", pick hypothetical grades for this term, and watch the projection move before finals do.',
  },
  {
    tab: 'whatif',
    icon: '🔮',
    title: 'What-if',
    body: 'Considering a course? Type it here to see which requirements it would advance in every degree — one click sends a winner to your semester plan.',
  },
  {
    tab: 'advisor',
    icon: '✨',
    title: 'AI Advisor (Pro)',
    body: 'Chat with an AI that knows your history, degrees, prerequisites, and terms. Ask it to plan your next semester, then save the plan to the Semester board.',
  },
  {
    tab: 'board',
    icon: '🗓',
    title: 'Semester board',
    body: 'Your future terms with credit caps. Drag courses between terms; smart suggestions fill the rest, multi-requirement courses first.',
  },
  {
    tab: 'overlap',
    icon: '🔗',
    title: 'Overlap',
    body: 'Courses that count toward two or more of your degrees at once — the biggest time-savers. Take these first.',
  },
  {
    tab: 'prereqs',
    icon: '🧩',
    title: 'Prerequisites',
    body: 'The prerequisite chains behind your remaining courses. Fix any the catalog parse got wrong — the board and advisor respect your edits.',
  },
  {
    tab: 'import',
    icon: '➕',
    title: 'Add degree',
    body: "Import any program: paste a catalog URL or its text, build one by hand, or let the AI research your school's full requirements (Supreme).",
  },
  {
    tab: 'progress',
    icon: '🖥',
    title: 'And on Workday itself…',
    body: 'A floating schedule calendar with conflict + walk-time warnings. Click any class for its professor rating, room, and a direct link to its Canvas page (set your Canvas address in ⚙ Options once). RMP ratings appear next to instructor names.',
  },
  {
    icon: '🗂',
    title: 'Saved schedules become Plans',
    body: 'Open each Workday saved schedule ("Schedule 1", "Schedule 2", …) once — every one is captured as its own plan. The calendar\'s Plans tab compares them: credits, ratings, earliest class, walking.',
  },
  {
    icon: '👥',
    title: 'Friends & finals',
    body: "In Plans, load a friend's share file (nothing uploaded) to see both schedules on one grid — green means you're both free. Track finals with clash warnings in Edit; export the calendar as a 📷 image or 📆 .ics file.",
  },
  {
    icon: '⚙',
    title: 'Make it yours',
    body: 'In ⚙ Options: 🌙 dark mode, ⏰ registration reminders, 🎨 your Canvas address, full course names next to codes (off by default — the 📷 export always shows them), walking speed, campus map, and a one-file backup. Enjoy! 🎉',
  },
];

interface Props {
  onNavigate: (tab: string) => void;
  /** finished or skipped — persist guideSeen and close */
  onFinish: () => void;
}

export function Guide({ onNavigate, onFinish }: Props) {
  const [track, setTrack] = useState<'quick' | 'full' | null>(null);
  const [i, setI] = useState(0);

  // Choosing a track also navigates to its first step's tab (in the click
  // handler, not an effect/render, so the switch is deterministic).
  const pick = (t: 'quick' | 'full') => {
    const first = (t === 'quick' ? QUICK_STEPS : FULL_STEPS)[0];
    if (first?.tab) onNavigate(first.tab);
    setTrack(t);
    setI(0);
  };

  // Track picker: shown first, both on first visit and on replay.
  if (track === null) {
    return (
      <div class="pl-guide">
        <div class="pl-guide-head">
          <span class="pl-guide-icon">👋</span>
          <b>Welcome to Student Companion</b>
        </div>
        <p class="pl-guide-body">
          Your data is read from Workday pages you open and stays in your browser — nothing is
          uploaded except optional AI, professor-rating, and Canvas lookups.
        </p>
        <div class="pl-guide-foot">
          <span />
          <span class="pl-guide-btns">
            <button class="pl-link-inline" onClick={onFinish}>
              Skip
            </button>
            <button class="pl-btn secondary" onClick={() => pick('full')}>
              Full tour (2 min)
            </button>
            <button class="pl-btn" onClick={() => pick('quick')}>
              ⚡ Quick tour (30 s)
            </button>
          </span>
        </div>
      </div>
    );
  }

  const steps = track === 'quick' ? QUICK_STEPS : FULL_STEPS;
  const step = steps[i]!;

  // Navigate in the click handler (not an effect) so the tab switch is
  // deterministic and immediate.
  const go = (n: number) => {
    const t = steps[n]?.tab;
    if (t) onNavigate(t);
    setI(n);
  };

  const last = i === steps.length - 1;

  return (
    <div class="pl-guide">
      <div class="pl-guide-head">
        <span class="pl-guide-icon">{step.icon}</span>
        <b>{step.title}</b>
        <span class="pl-guide-count">
          {i + 1}/{steps.length}
        </span>
      </div>
      <p class="pl-guide-body">{step.body}</p>
      <div class="pl-guide-foot">
        <span class="pl-guide-dots">
          {steps.map((_, d) => (
            <i class={d === i ? 'on' : ''} onClick={() => go(d)} />
          ))}
        </span>
        <span class="pl-guide-btns">
          {!last && (
            <button class="pl-link-inline" onClick={onFinish}>
              Skip tour
            </button>
          )}
          {i > 0 ? (
            <button class="pl-btn secondary" onClick={() => go(i - 1)}>
              ← Back
            </button>
          ) : (
            <button
              class="pl-btn secondary"
              onClick={() => {
                setTrack(null);
                setI(0);
              }}
            >
              ← Tours
            </button>
          )}
          {last ? (
            <button class="pl-btn" onClick={onFinish}>
              Done 🎉
            </button>
          ) : (
            <button class="pl-btn" onClick={() => go(i + 1)}>
              Next →
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
