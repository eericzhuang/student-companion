/**
 * Beginner guide: a short step-by-step tour of every module. Each step
 * switches the planner to the tab it describes so new users see the real
 * thing, not screenshots. Auto-opens on first visit (plannerState.guideSeen)
 * and can be replayed anytime from the ❓ Guide button in the header.
 */
import { useState } from 'preact/hooks';

interface Step {
  /** planner tab to show while this step is up (undefined = stay put) */
  tab?: string;
  icon: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    icon: '👋',
    title: 'Welcome to Student Companion',
    body: 'A one-minute tour of every module. Your data is read from Workday pages you open and stays in your browser — nothing is uploaded except optional AI and professor-rating lookups.',
  },
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
    body: 'Completed work earns XP — 10 per course, 40 per requirement group, 200 per degree. Click your level card to see all 10 ranks, their looks, and try any of them on.',
  },
  {
    tab: 'progress',
    icon: '🎓',
    title: 'GPA & what-if grades',
    body: 'Your cumulative GPA, computed from your history. Open "What-if grades", pick hypothetical grades for this term\'s courses, and watch the projected GPA move before finals do.',
  },
  {
    tab: 'whatif',
    icon: '🔮',
    title: 'What-if',
    body: "Considering a course? Type it here to see which requirements it would advance in every degree — before you register. One click sends a winner to your semester plan.",
  },
  {
    tab: 'advisor',
    icon: '✨',
    title: 'AI Advisor (Pro)',
    body: 'Chat with an AI that knows your history, degrees, prerequisites, and terms. Ask it to plan your next semester, then save the plan straight to the Semester board.',
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
    body: 'Import any program: paste a catalog URL or its text, build one by hand, or let the AI research your school\'s full requirements (Supreme).',
  },
  {
    tab: 'progress',
    icon: '🖥',
    title: 'And on Workday itself…',
    body: 'A floating schedule calendar with conflict + walk-time warnings (click any class for its professor, rating, and room; the Route view maps your day), a capture widget that saves your courses into this planner, and RateMyProfessors ratings next to instructor names. Toggle everything in ⚙ Options.',
  },
  {
    icon: '🧩',
    title: 'Build the perfect schedule',
    body: 'On Find Course Sections, tap ☆ candidate on every section you\'re considering. The calendar\'s Build tab then generates every conflict-free combination, ranked by your preferences — mornings, gaps, ratings, walking. Preview one, save it as a plan, or make it your schedule.',
  },
  {
    icon: '🗂',
    title: 'Plans, exports & backup',
    body: 'The Plans tab compares saved schedules side by side (credits, ratings, walking) and swaps between them safely. Export the calendar as a 📷 image or 📆 .ics for Google/Apple/Outlook, and back up all your data from ⚙ Options. Enjoy! 🎉',
  },
];

interface Props {
  onNavigate: (tab: string) => void;
  /** finished or skipped — persist guideSeen and close */
  onFinish: () => void;
}

export function Guide({ onNavigate, onFinish }: Props) {
  const [i, setI] = useState(0);
  const step = STEPS[i]!;

  // Navigate in the click handler (not an effect) so the tab switch is
  // deterministic and immediate.
  const go = (n: number) => {
    const t = STEPS[n]?.tab;
    if (t) onNavigate(t);
    setI(n);
  };

  const last = i === STEPS.length - 1;

  return (
    <div class="pl-guide">
      <div class="pl-guide-head">
        <span class="pl-guide-icon">{step.icon}</span>
        <b>{step.title}</b>
        <span class="pl-guide-count">
          {i + 1}/{STEPS.length}
        </span>
      </div>
      <p class="pl-guide-body">{step.body}</p>
      <div class="pl-guide-foot">
        <span class="pl-guide-dots">
          {STEPS.map((_, d) => (
            <i class={d === i ? 'on' : ''} onClick={() => go(d)} />
          ))}
        </span>
        <span class="pl-guide-btns">
          {!last && (
            <button class="pl-link-inline" onClick={onFinish}>
              Skip tour
            </button>
          )}
          {i > 0 && (
            <button class="pl-btn secondary" onClick={() => go(i - 1)}>
              ← Back
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
