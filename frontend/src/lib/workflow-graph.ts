import type { WorkflowJob } from "@/lib/api";

export type WorkflowGraphDefinition = {
  ID: string;
  Name: string;
  Needs: string[] | null;
};

export type WorkflowGraphNode = {
  id: string;
  name: string;
  jobs: WorkflowJob[];
  needs: string[];
  x: number;
  y: number;
  width: number;
  height: number;
};

const NODE_WIDTH = 248;
const COLUMN_GAP = 72;
const ROW_GAP = 24;
const PADDING = 28;

// Runtime jobs only expose display names, not YAML job IDs. Match unique names
// conservatively; ambiguous and reusable-workflow jobs remain separate nodes.
function matchesName(name: string, definition: WorkflowGraphDefinition): boolean {
  const template = definition.Name || definition.ID;
  const escaped = template
    .split(/\$\{\{.*?\}\}/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".+?");
  return new RegExp(`^${escaped}(?: \\(.*\\))?$`).test(name);
}

export function buildWorkflowGraph(
  jobs: WorkflowJob[],
  definitions: WorkflowGraphDefinition[] = [],
) {
  const nodes: WorkflowGraphNode[] = definitions.map((definition) => ({
    id: `definition:${definition.ID}`,
    name: definition.Name || definition.ID,
    jobs: [],
    needs: (definition.Needs ?? []).map((id) => `definition:${id}`),
    x: 0,
    y: 0,
    width: NODE_WIDTH,
    height: 76,
  }));
  let incomplete = false;
  for (const job of jobs) {
    const exact = definitions.filter(
      (definition) => job.Name === (definition.Name || definition.ID),
    );
    const candidates = exact.length
      ? exact
      : definitions.filter((definition) => matchesName(job.Name, definition));
    if (candidates.length === 1) {
      nodes[definitions.indexOf(candidates[0])].jobs.push(job);
    } else {
      incomplete ||= definitions.length > 0;
      nodes.push({
        id: `job:${job.ID}`,
        name: job.Name,
        jobs: [job],
        needs: [],
        x: 0,
        y: 0,
        width: NODE_WIDTH,
        height: 76,
      });
    }
  }

  const byID = new Map(nodes.map((node) => [node.id, node]));
  const ranks = new Map<string, number>();
  const unresolved = new Set(nodes);
  // Each pass resolves at least one DAG layer. Cycles are displayed unconnected
  // instead of recursing indefinitely or inventing an execution order.
  while (unresolved.size) {
    let advanced = false;
    for (const node of unresolved) {
      const dependencies = node.needs.filter((id) => byID.has(id));
      incomplete ||= dependencies.length !== node.needs.length;
      if (dependencies.some((id) => !ranks.has(id))) continue;
      ranks.set(
        node.id,
        dependencies.reduce((rank, id) => Math.max(rank, ranks.get(id)! + 1), 0),
      );
      unresolved.delete(node);
      advanced = true;
    }
    if (!advanced) {
      incomplete = true;
      for (const node of unresolved) ranks.set(node.id, 0);
      break;
    }
  }

  const columns: WorkflowGraphNode[][] = [];
  for (const node of nodes) {
    node.height = node.jobs.length > 1 ? 34 + node.jobs.length * 64 : 76;
    const rank = ranks.get(node.id) ?? 0;
    (columns[rank] ??= []).push(node);
  }
  const columnHeights = columns.map((column) =>
    column.reduce((height, node) => height + node.height + ROW_GAP, -ROW_GAP),
  );
  const contentHeight = Math.max(76, ...columnHeights);
  columns.forEach((column, rank) => {
    let y = PADDING + (contentHeight - columnHeights[rank]) / 2;
    for (const node of column) {
      node.x = PADDING + rank * (NODE_WIDTH + COLUMN_GAP);
      node.y = y;
      y += node.height + ROW_GAP;
    }
  });

  const edges = nodes.flatMap((target) =>
    [...new Set(target.needs)].flatMap((id) => {
      const source = byID.get(id);
      if (!source || source.x >= target.x) return [];
      const x1 = source.x + source.width;
      const y1 = source.y + source.height / 2;
      const x2 = target.x;
      const y2 = target.y + target.height / 2;
      const bend = (x1 + x2) / 2;
      return [{
        id: `${source.id}:${target.id}`,
        source,
        target,
        path: `M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}`,
      }];
    }),
  );
  return {
    nodes,
    edges,
    incomplete,
    width: PADDING * 2 + Math.max(1, columns.length) * (NODE_WIDTH + COLUMN_GAP) - COLUMN_GAP,
    height: PADDING * 2 + contentHeight,
  };
}

export type GraphViewport = { x: number; y: number; zoom: number };

export function fitWorkflowGraph(
  graph: { width: number; height: number },
  viewport: { width: number; height: number },
): GraphViewport {
  const zoom = Math.min(1, viewport.width / graph.width, viewport.height / graph.height);
  return {
    zoom,
    x: (viewport.width - graph.width * zoom) / 2,
    y: (viewport.height - graph.height * zoom) / 2,
  };
}

export function zoomWorkflowGraph(
  view: GraphViewport,
  zoom: number,
  origin: { x: number; y: number },
): GraphViewport {
  const nextZoom = Math.min(1.5, Math.max(0.2, zoom));
  const ratio = nextZoom / view.zoom;
  return {
    zoom: nextZoom,
    x: origin.x - (origin.x - view.x) * ratio,
    y: origin.y - (origin.y - view.y) * ratio,
  };
}
