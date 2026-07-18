/**
 * Prerequisite chain graph: an SVG DAG of every known prereq relationship
 * (parsed from catalogs + the user's own additions), colored by course status
 * so bottleneck courses that unlock the most are easy to spot.
 */
import { useMemo } from 'preact/hooks';
import type { CourseStates } from './engine/requirements';
import { layoutPrereqGraph } from './engine/prereqGraph';

const NODE_W = 96;
const NODE_H = 26;
const COL_W = 150;
const ROW_H = 40;
const PAD = 14;

const FILL: Record<string, string> = {
  completed: '#dcfce7',
  'in-progress': '#fef9c3',
  planned: '#dbeafe',
  none: '#f1f5f9',
};
const STROKE: Record<string, string> = {
  completed: '#16a34a',
  'in-progress': '#d97706',
  planned: '#2563eb',
  none: '#94a3b8',
};

export function PrereqGraph({
  prereqs,
  states,
}: {
  prereqs: Record<string, string[]>;
  states: CourseStates;
}) {
  const graph = useMemo(() => layoutPrereqGraph(prereqs, states), [prereqs, states]);
  if (graph.edges.length === 0) {
    return (
      <p class="pl-muted">
        🕸 Once prerequisites are known (parsed from an imported degree, or added below), a chain
        graph appears here showing what unlocks what.
      </p>
    );
  }

  const pos = new Map(graph.nodes.map((n) => [n.code, n]));
  const x = (layer: number) => PAD + layer * COL_W;
  const y = (row: number) => PAD + row * ROW_H;
  const width = PAD * 2 + (graph.layers - 1) * COL_W + NODE_W;
  const height = PAD * 2 + (graph.maxRows - 1) * ROW_H + NODE_H;

  return (
    <div class="pl-prereq-graph">
      <h3 style={{ fontSize: '14px', marginBottom: '4px' }}>🕸 Chain graph</h3>
      <p class="pl-muted" style={{ margin: '0 0 6px' }}>
        Arrows read "unlocks": take the left course first. Colors match the progress legend.
      </p>
      <div class="pl-prereq-scroll">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <defs>
            <marker id="pl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0.5 L7.5,4 L0,7.5 z" fill="#94a3b8" />
            </marker>
          </defs>
          {graph.edges.map((e) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            if (!a || !b) return null;
            const x1 = x(a.layer) + NODE_W;
            const y1 = y(a.row) + NODE_H / 2;
            const x2 = x(b.layer) - 2;
            const y2 = y(b.row) + NODE_H / 2;
            const mx = (x1 + x2) / 2;
            return (
              <path
                d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="#cbd5e1"
                stroke-width="1.5"
                marker-end="url(#pl-arrow)"
              />
            );
          })}
          {graph.nodes.map((n) => (
            <g>
              <rect
                x={x(n.layer)}
                y={y(n.row)}
                width={NODE_W}
                height={NODE_H}
                rx="7"
                fill={FILL[n.state]}
                stroke={STROKE[n.state]}
                stroke-width="1.4"
              >
                <title>
                  {n.code} — {n.state === 'none' ? 'not taken' : n.state}
                </title>
              </rect>
              <text
                x={x(n.layer) + NODE_W / 2}
                y={y(n.row) + NODE_H / 2 + 4}
                text-anchor="middle"
                font-size="11"
                font-weight="600"
                fill="#1e293b"
              >
                {n.code}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
