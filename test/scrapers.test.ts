// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { extractHistoryCourses, extractSections } from '../src/content/scrapers/workdayJson';
import { scrapeAcademicHistory } from '../src/content/scrapers/academicHistory';
import { extractReadableText } from '../src/planner/DegreeImport';

describe('extractSections (intercepted JSON)', () => {
  it('finds sections in a Workday-like widget tree', () => {
    const payload = {
      body: {
        children: [
          {
            widget: 'grid',
            rows: [
              {
                cells: [
                  { label: 'Course Section', value: 'CS 2110-001 - Object-Oriented Programming' },
                  { label: 'Meeting Patterns', value: 'MWF | 10:00 AM - 10:50 AM | Hollister 110' },
                  { label: 'Instructor', value: 'Anne Bracy' },
                  { label: 'Credits', value: '4' },
                ],
              },
              {
                cells: [
                  { label: 'Course Section', value: 'MATH 1920-002 - Multivariable Calculus' },
                  { label: 'Meeting Patterns', value: 'TTh | 1:25 PM - 2:40 PM' },
                ],
              },
            ],
          },
        ],
      },
    };
    const sections = extractSections(payload);
    const codes = sections.map((s) => s.courseCode).sort();
    expect(codes).toEqual(['CS 2110', 'MATH 1920']);
    const cs = sections.find((s) => s.courseCode === 'CS 2110')!;
    expect(cs.sectionId).toBe('CS 2110-001');
    expect(cs.instructor).toBe('Anne Bracy');
    expect(cs.meetings[0]!.startMin).toBe(600);
    expect(cs.credits).toBe(4);
  });

  it('ignores payloads without meeting patterns', () => {
    expect(extractSections({ text: 'CS 2110 is a nice course' })).toHaveLength(0);
  });
});

describe('extractHistoryCourses', () => {
  it('finds graded courses', () => {
    const payload = {
      rows: [
        { cells: ['CS 1110 - Intro to Computing', 'Fall 2024', '4', 'A'] },
        { cells: ['MATH 1910 - Calculus', 'Fall 2024', '4', 'B+'] },
        { cells: ['Random text no grade'] },
      ],
    };
    const courses = extractHistoryCourses(payload);
    expect(courses.map((c) => c.code).sort()).toEqual(['CS 1110', 'MATH 1910']);
    expect(courses[0]!.status).toBe('completed');
  });
});

describe('scrapeAcademicHistory (DOM fallback)', () => {
  it('parses a transcript-like table', () => {
    document.body.innerHTML = `
      <table data-automation-id="table">
        <tbody>
          <tr><td>CS 1110 - Intro to Computing</td><td>Fall 2024</td><td>4</td><td>A</td></tr>
          <tr><td>PHYS 1112 - Mechanics</td><td>Spring 2025</td><td>4</td><td>B</td></tr>
          <tr><td>Header junk</td><td>no course here</td></tr>
        </tbody>
      </table>`;
    const history = scrapeAcademicHistory(document);
    expect(history).not.toBeNull();
    expect(history!.courses.map((c) => c.code).sort()).toEqual(['CS 1110', 'PHYS 1112']);
    expect(history!.courses[0]!.grade).toBe('A');
  });
});

describe('extractReadableText', () => {
  it('strips nav/script and keeps main content', () => {
    const html = `<html><head><script>evil()</script></head><body>
      <nav>Home About</nav>
      <main><h1>BS in Computer Science</h1><p>Required: CS 1110, CS 2110.</p></main>
      <footer>© school</footer></body></html>`;
    const text = extractReadableText(html);
    expect(text).toContain('CS 2110');
    expect(text).not.toContain('evil');
    expect(text).not.toContain('Home About');
  });
});
