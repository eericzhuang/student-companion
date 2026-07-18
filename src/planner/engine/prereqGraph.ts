/**
 * Layout engine for the prerequisite chain graph: courses become nodes in
 * left-to-right layers (a course sits one layer right of its deepest
 * prerequisite), edges point prereq → course. Pure math; the component
 * renders the result as SVG.
 */
import type { CourseState, CourseStates } from './requirements';
import { stateOf } from './requirements';

export interface GraphNode {
  code: string;
  layer: number;
  /** row index within the layer */
  row: number;
  state: CourseState;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface PrereqGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  layers: number;
  maxRows: number;
}

/**
 * @param prereqs course -> its prerequisites (already normalized codes)
 * @param states  for node coloring
 */
export function layoutPrereqGraph(prereqs: Record<string, string[]>, states: CourseStates): PrereqGraph {
  // Only draw courses that participate in at least one chain.
  const codes = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const [course, reqs] of Object.entries(prereqs)) {
    for (const r of reqs) {
      if (r === course) continue;
      codes.add(course);
      codes.add(r);
      edges.push({ from: r, to: course });
    }
  }

  // layer = longest prerequisite chain below the course (cycle-safe)
  const memo = new Map<string, number>();
  const layerOf = (code: string, seen: Set<string>): number => {
    const cached = memo.get(code);
    if (cached !== undefined) return cached;
    if (seen.has(code)) return 0; // defensive: break cycles
    seen.add(code);
    const reqs = (prereqs[code] ?? []).filter((r) => codes.has(r) && r !== code);
    const layer = reqs.length === 0 ? 0 : 1 + Math.max(...reqs.map((r) => layerOf(r, seen)));
    seen.delete(code);
    memo.set(code, layer);
    return layer;
  };

  const byLayer = new Map<number, string[]>();
  for (const code of [...codes].sort()) {
    const l = layerOf(code, new Set());
    const list = byLayer.get(l);
    if (list) list.push(code);
    else byLayer.set(l, [code]);
  }

  const nodes: GraphNode[] = [];
  let maxRows = 0;
  for (const [layer, list] of byLayer) {
    maxRows = Math.max(maxRows, list.length);
    list.forEach((code, row) => nodes.push({ code, layer, row, state: stateOf(code, states) }));
  }

  return { nodes, edges, layers: byLayer.size === 0 ? 0 : Math.max(...byLayer.keys()) + 1, maxRows };
}
