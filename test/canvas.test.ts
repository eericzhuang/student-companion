import { describe, expect, it } from 'vitest';
import {
  canvasApiCoursesUrl,
  canvasCourseUrl,
  canvasCoursesUrl,
  matchCanvasCourse,
  normalizeCanvasDomain,
} from '../src/shared/canvas';
import type { CanvasCourse } from '../src/shared/types';

describe('normalizeCanvasDomain', () => {
  it('accepts bare hostnames and strips protocol/path/case', () => {
    expect(normalizeCanvasDomain('canvas.cornell.edu')).toBe('canvas.cornell.edu');
    expect(normalizeCanvasDomain('https://Canvas.Cornell.edu/courses/123?x=1')).toBe('canvas.cornell.edu');
    expect(normalizeCanvasDomain('  myschool.instructure.com  ')).toBe('myschool.instructure.com');
  });

  it('rejects things that are not hostnames', () => {
    expect(normalizeCanvasDomain('')).toBe(null);
    expect(normalizeCanvasDomain(null)).toBe(null);
    expect(normalizeCanvasDomain('canvas')).toBe(null);
    expect(normalizeCanvasDomain('not a domain')).toBe(null);
    expect(normalizeCanvasDomain('bad_host.edu')).toBe(null);
  });
});

describe('canvas URLs', () => {
  it('builds course, list, and API urls', () => {
    expect(canvasCourseUrl('canvas.x.edu', 42)).toBe('https://canvas.x.edu/courses/42');
    expect(canvasCoursesUrl('canvas.x.edu')).toBe('https://canvas.x.edu/courses');
    expect(canvasApiCoursesUrl('canvas.x.edu')).toBe(
      'https://canvas.x.edu/api/v1/courses?enrollment_state=active&per_page=100',
    );
  });
});

describe('matchCanvasCourse', () => {
  const courses: CanvasCourse[] = [
    { id: 1, code: '2026SP-CS-2110-LEC001', name: 'Object-Oriented Programming' },
    { id: 2, code: 'MATH1920', name: 'Multivariable Calculus' },
    { id: 3, code: 'FA26 Sandbox', name: 'PHYS 1112: Mechanics' },
  ];

  it('matches through Canvas term/section junk in the code', () => {
    expect(matchCanvasCourse('CS 2110', courses)?.id).toBe(1);
    expect(matchCanvasCourse('MATH 1920', courses)?.id).toBe(2);
  });

  it('falls back to matching the course name', () => {
    expect(matchCanvasCourse('PHYS 1112', courses)?.id).toBe(3);
  });

  it('returns null for unknown or unparsable codes', () => {
    expect(matchCanvasCourse('CHEM 2090', courses)).toBe(null);
    expect(matchCanvasCourse('???', courses)).toBe(null);
    // CS 211 must not match CS 2110
    expect(matchCanvasCourse('CS 211', courses)).toBe(null);
  });
});
