import { describe, expect, it } from 'vitest';
import { layoutPrereqGraph } from '../src/planner/engine/prereqGraph';
import type { CourseStates } from '../src/planner/engine/requirements';

const states: CourseStates = {
  completed: new Set(['CS 1110']),
  inProgress: new Set(['CS 2110']),
  planned: new Set(['CS 3410']),
};

describe('layoutPrereqGraph', () => {
  it('layers courses by longest chain and colors by status', () => {
    const g = layoutPrereqGraph(
      { 'CS 2110': ['CS 1110'], 'CS 3410': ['CS 2110'], 'CS 4410': ['CS 3410', 'CS 1110'] },
      states,
    );
    const layer = (c: string) => g.nodes.find((n) => n.code === c)!.layer;
    expect(layer('CS 1110')).toBe(0);
    expect(layer('CS 2110')).toBe(1);
    expect(layer('CS 3410')).toBe(2);
    expect(layer('CS 4410')).toBe(3);
    expect(g.layers).toBe(4);
    expect(g.nodes.find((n) => n.code === 'CS 1110')!.state).toBe('completed');
    expect(g.nodes.find((n) => n.code === 'CS 4410')!.state).toBe('none');
    expect(g.edges).toHaveLength(4);
  });

  it('ignores self-references and survives cycles', () => {
    const g = layoutPrereqGraph({ A: ['A', 'B'], B: ['A'] }, states);
    expect(g.nodes.length).toBe(2);
    expect(g.edges.every((e) => e.from !== e.to)).toBe(true);
  });

  it('returns an empty graph with no relationships', () => {
    expect(layoutPrereqGraph({}, states).edges).toHaveLength(0);
  });
});
