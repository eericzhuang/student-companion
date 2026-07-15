import { describe, expect, it } from 'vitest';
import { heuristicParseDegree } from '../src/background/degreeHeuristic';

describe('heuristicParseDegree (no-API-key fallback)', () => {
  it('groups courses under headings and detects rules', () => {
    const text = `
B.S. in Computer Science
Core Requirements
CS 1110 Introduction to Computing 4 credits
CS 2110 Data Structures 4 credits
Electives: choose two of the following
CS 4780 Machine Learning
CS 4820 Algorithms
CS 4700 Foundations of AI
`;
    const degree = heuristicParseDegree(text);
    expect(degree.name).toMatch(/Computer Science/);
    expect(degree.type).toBe('major');

    const core = degree.groups.find((g) => /core/i.test(g.title));
    expect(core?.rule.kind).toBe('all');
    expect(core?.courses.map((c) => c.code)).toEqual(['CS 1110', 'CS 2110']);

    const electives = degree.groups.find((g) => /elective/i.test(g.title));
    expect(electives?.rule).toEqual({ kind: 'chooseN', n: 2 });
    expect(electives?.courses).toHaveLength(3);
  });

  it('detects a credits rule', () => {
    const degree = heuristicParseDegree(
      'Breadth: 9 credits from the following\nHIST 1200 World History\nECON 1110 Microeconomics',
    );
    const g = degree.groups[0]!;
    expect(g.rule).toEqual({ kind: 'credits', credits: 9 });
  });

  it('detects a minor and falls back to one group when no headings', () => {
    const degree = heuristicParseDegree('Mathematics Minor\nMATH 1910\nMATH 1920\nMATH 2940');
    expect(degree.type).toBe('minor');
    // All codes collected (name line has no code); at least one group with the courses
    const allCodes = degree.groups.flatMap((g) => g.courses.map((c) => c.code));
    expect(allCodes).toEqual(expect.arrayContaining(['MATH 1910', 'MATH 1920', 'MATH 2940']));
  });

  it('never returns zero groups', () => {
    const degree = heuristicParseDegree('this page has no course codes at all');
    expect(degree.groups.length).toBeGreaterThanOrEqual(1);
  });
});
