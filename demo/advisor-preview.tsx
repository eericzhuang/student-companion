// Preview the Pro AI Advisor against mock data + stubbed AI response.
import './chromeStub';
import '../src/planner/planner.css';
import { render } from 'preact';
import { AiAdvisor } from '../src/planner/AiAdvisor';
import { buildCourseStates } from '../src/planner/engine/requirements';
import { mockDegrees, mockHistory, mockSchedule, mockStore } from './mockData';

const states = buildCourseStates(
  mockHistory.courses,
  mockSchedule.map((s) => s.courseCode),
  [],
);

render(
  <AiAdvisor
    degrees={mockDegrees}
    states={states}
    terms={mockStore.settings.terms}
    prereqOverrides={{}}
    courseEquivalents={{}}
    reqOverrides={{}}
    isPro={true}
    isSupreme={true}
  />,
  document.getElementById('app')!,
);

// ?auto=1 plays a canned exchange for store-screenshot capture.
if (new URLSearchParams(location.search).has('auto')) {
  setTimeout(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Plan my next semester'),
    );
    btn?.click();
  }, 400);
}
