import { describe, expect, it } from 'vitest';
import { parseTranscriptText } from '../src/shared/transcript';

describe('parseTranscriptText', () => {
  it('parses a term-grouped transcript', () => {
    const text = `
Unofficial Transcript
Fall 2024
CS 1110  Introduction to Computing  4.0  A
MATH 1910  Calculus I  4.0  A-
Spring 2025
CS 2110  Data Structures  4.0  B+
PHYS 1112  Physics I Mechanics  4.0  W
Term GPA: 3.7
`;
    const courses = parseTranscriptText(text);
    const byCode = Object.fromEntries(courses.map((c) => [c.code, c]));
    expect(Object.keys(byCode).sort()).toEqual(['CS 1110', 'CS 2110', 'MATH 1910', 'PHYS 1112']);
    expect(byCode['CS 1110']!.grade).toBe('A');
    expect(byCode['CS 1110']!.term).toBe('Fall 2024');
    expect(byCode['CS 2110']!.term).toBe('Spring 2025');
    expect(byCode['CS 2110']!.status).toBe('completed');
    expect(byCode['PHYS 1112']!.status).toBe('withdrawn');
  });

  it('marks courses with no grade as in-progress', () => {
    const courses = parseTranscriptText('Fall 2025\nCS 3110 Functional Programming');
    expect(courses[0]!.status).toBe('in-progress');
    expect(courses[0]!.grade).toBeNull();
  });

  it('captures credits and titles', () => {
    const courses = parseTranscriptText('Fall 2024\nINFO 2040 Networks 3 A-');
    expect(courses[0]!.credits).toBe(3);
    expect(courses[0]!.title).toMatch(/Networks/);
    expect(courses[0]!.grade).toBe('A-');
  });

  it('handles code variants and dedupes by code+term', () => {
    const courses = parseTranscriptText('Fall 2024\nCS-1110 Intro 4 A\nCS 1110 Intro 4 A');
    expect(courses).toHaveLength(1);
    expect(courses[0]!.code).toBe('CS 1110');
  });

  it('returns empty on non-transcript text', () => {
    expect(parseTranscriptText('This document has no course codes at all.')).toEqual([]);
  });
});

describe('parseTranscriptText — accuracy traps', () => {
  it('a section suffix is not a 1-credit course', () => {
    const c = parseTranscriptText('Fall 2024\nCSE 1302-01 Introduction to Computer Engineering 3.0 A')[0]!;
    expect(c.credits).toBe(3);
    expect(c.grade).toBe('A');
  });

  it('a Roman numeral in the title is not an Incomplete grade', () => {
    const c = parseTranscriptText('Fall 2025\nPHYS 1112 Physics I Mechanics 4.0')[0]!;
    expect(c.grade).toBeNull();
    expect(c.status).toBe('in-progress');
  });

  it('still reads a real trailing P or S grade', () => {
    expect(parseTranscriptText('Fall 2024\nPE 1100 Swimming 1.0 P')[0]!.grade).toBe('P');
    expect(parseTranscriptText('Fall 2024\nRES 2000 Research 2.0 S')[0]!.status).toBe('completed');
  });

  it('rejects implausible credit values', () => {
    // "16.0" here is a term total, not a course credit
    expect(parseTranscriptText('Fall 2024\nCS 1110 Intro 16.0 A')[0]!.credits).toBeNull();
  });

  it('transfer credit counts as completed', () => {
    expect(parseTranscriptText('Transfer Credit\nMATH 1910 Calculus 4.0 TR')[0]!.status).toBe('completed');
  });
});
