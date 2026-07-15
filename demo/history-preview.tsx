import './chromeStub'; // must run before anything touches chrome.*
import { render } from 'preact';
import plannerCss from '../src/planner/planner.css?inline';
import { AiHistory } from '../src/planner/AiHistory';

const style = document.createElement('style');
style.textContent = plannerCss;
document.head.appendChild(style);

// Seed some AI history so the remove / multi-select UI has content to act on.
const now = Date.now();
void chrome.storage.local.set({
  aiHistory: [
    { id: 'h1', at: now - 3 * 60000, feature: 'degree-research', title: 'Researched: B.S. Computer Science @ Cornell', detail: 'B.S. in Computer Science\n7 requirement group(s) · 120 total credits' },
    { id: 'h2', at: now - 20 * 60000, feature: 'chat', title: 'Advisor: Plan my next semester.', detail: "Here's a plan for Fall 2026 (16 credits)…" },
    { id: 'h3', at: now - 90 * 60000, feature: 'prereq-research', title: 'Prereqs for CS 4410 @ Cornell', detail: 'Requires: CS 3410\nCS 3410 must be completed first.' },
    { id: 'h4', at: now - 26 * 3600000, feature: 'transcript-parse', title: 'Parsed transcript — 12 course(s)', detail: 'CS 1110 (A), MATH 1910 (A-), PHYS 1112 (B+)…' },
  ],
});

render(<AiHistory />, document.getElementById('app')!);
