// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { scrapeAcademicHistory } from '../src/content/scrapers/academicHistory';
import { statusForGrade } from '../src/shared/grades';

/** Build a Workday-ish grid: header row + body rows. */
function grid(headers: string[], rows: string[][]): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = `
    <table>
      <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
  document.body.innerHTML = '';
  document.body.appendChild(host);
  return host;
}

describe('scrapeAcademicHistory — column-aware reading', () => {
  it('reads grade and units from their own columns, not the first lookalike cell', () => {
    // "Grading Basis: S" sits BEFORE the real grade, and "Grade Points 12.0"
    // after the units — both used to win.
    const root = grid(
      ['Course Listing', 'Academic Period', 'Grading Basis', 'Units', 'Grade', 'Grade Points'],
      [['CSE 1302 - Introduction to Computer Engineering', '2024 Fall Semester', 'S', '3', 'A', '12.0']],
    );
    const out = scrapeAcademicHistory(root)!;
    expect(out.courses).toHaveLength(1);
    const c = out.courses[0]!;
    expect(c.code).toBe('CSE 1302');
    expect(c.grade).toBe('A');
    expect(c.credits).toBe(3);
    expect(c.title).toBe('Introduction to Computer Engineering');
    expect(c.status).toBe('completed');
  });

  it('a withdrawn course is never counted as completed', () => {
    const root = grid(
      ['Course', 'Term', 'Units', 'Grade'],
      [['PHYS 1112 - Physics I Mechanics', 'Spring 2025', '4', 'W']],
    );
    expect(scrapeAcademicHistory(root)!.courses[0]!.status).toBe('withdrawn');
  });

  it('in-progress grades stay in progress', () => {
    const root = grid(
      ['Course', 'Term', 'Units', 'Grade'],
      [
        ['CS 3110 - Functional Programming', 'Fall 2026', '4', 'IP'],
        ['CS 4780 - Machine Learning', 'Fall 2026', '4', ''],
      ],
    );
    const out = scrapeAcademicHistory(root)!.courses;
    expect(out.map((c) => c.status)).toEqual(['in-progress', 'in-progress']);
  });

  it('strips Workday junk out of the course title', () => {
    const root = grid(
      ['Course Listing', 'Term', 'Units', 'Grade'],
      [['CSE 1302 - Introduction to Computer EngineeringActionsCSE 1302-01 - Introduction to Computer EngineeringLec', '2024 Fall Semester', '3', 'B+']],
    );
    expect(scrapeAcademicHistory(root)!.courses[0]!.title).toBe('Introduction to Computer Engineering');
  });

  it('falls back sensibly when the grid has no headers', () => {
    const host = document.createElement('div');
    host.innerHTML = `<table><tbody>
      <tr><td>MATH 1920 - Multivariable Calculus</td><td>Fall 2024</td><td>4</td><td>A-</td></tr>
    </tbody></table>`;
    document.body.innerHTML = '';
    document.body.appendChild(host);
    const c = scrapeAcademicHistory(host)!.courses[0]!;
    expect(c.grade).toBe('A-');
    expect(c.credits).toBe(4);
    expect(c.status).toBe('completed');
  });

  it('picks credits over quality points when several numbers share a row', () => {
    const host = document.createElement('div');
    host.innerHTML = `<table><tbody>
      <tr><td>CHEM 2090 - General Chemistry</td><td>Fall 2024</td><td>4</td><td>A</td><td>16.0</td></tr>
    </tbody></table>`;
    document.body.innerHTML = '';
    document.body.appendChild(host);
    expect(scrapeAcademicHistory(host)!.courses[0]!.credits).toBe(4);
  });

  it('ignores rows without a course code', () => {
    const root = grid(
      ['Course', 'Term', 'Units', 'Grade'],
      [['Term GPA', 'Fall 2024', '16', '3.7'], ['CS 1110 - Intro to Computing', 'Fall 2024', '4', 'A']],
    );
    const out = scrapeAcademicHistory(root)!.courses;
    expect(out).toHaveLength(1);
    expect(out[0]!.code).toBe('CS 1110');
  });
});

describe('statusForGrade', () => {
  it('maps the whole grade vocabulary consistently', () => {
    expect(statusForGrade('A')).toBe('completed');
    expect(statusForGrade('F')).toBe('completed'); // failed, but finished
    expect(statusForGrade('TR')).toBe('completed'); // transfer credit
    expect(statusForGrade('CR')).toBe('completed');
    expect(statusForGrade('W')).toBe('withdrawn');
    expect(statusForGrade('IP')).toBe('in-progress');
    expect(statusForGrade('AU')).toBe('in-progress'); // audit earns nothing
    expect(statusForGrade(null)).toBe('in-progress');
  });
});
