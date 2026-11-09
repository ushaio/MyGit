export type GraphLine = {
  id: number;
  top: number;
  column: number;
  bottom: number;
};

export type GraphRow = {
  lines: GraphLine[];
  column: number;
  id: number;
  columns: number;
};

export const graphColors = [
  "#4f7acb",
  "#b47e35",
  "#8a67bf",
  "#3c997e",
  "#c8687e",
  "#6093a6",
  "#a19442",
];

type CommitLike = { hash: string; parents: string[] };

/**
 * Lane graph for a commit log. Children must come before their parents,
 * the same ordering `git log` and MyGit's history view use.
 */
export function buildGraph(commits: CommitLike[]): GraphRow[] {
  // The demo fixtures use short hashes for parents; the real app always
  // passes full hashes. Resolve the short form so lanes actually converge.
  const byShort = new Map<string, string>();
  for (const commit of commits) {
    byShort.set(commit.hash.slice(0, 7), commit.hash);
  }
  const resolve = (hash: string) =>
    byShort.get(hash) ?? byShort.get(hash.slice(0, 7)) ?? hash;

  let previous: { next: string; id: number }[] = [];
  return commits.map((commit) => {
    const current: typeof previous = [];
    const lines: GraphLine[] = [];
    const parents = (commit.parents || []).map(resolve);
    const first = parents[0];
    let column = -1;
    let id = -1;
    let found = false;

    previous.forEach((line, j) => {
      if (line.next !== commit.hash) {
        lines.push({
          id: line.id,
          top: j,
          column: current.length,
          bottom: current.length,
        });
        current.push(line);
      } else if (!found) {
        found = true;
        column = current.length;
        id = line.id;
        lines.push({ id, top: j, column, bottom: first ? column : -1 });
        if (first) current.push({ next: first, id });
      } else {
        lines.push({ id: line.id, top: j, column, bottom: -1 });
      }
    });

    if (current.length < 64) {
      if (!found) {
        column = current.length;
        id = column;
        if (first) {
          current.push({ next: first, id });
          lines.push({ id, top: -1, column, bottom: column });
        }
      }
      for (const parent of parents.slice(1)) {
        const k = current.findIndex((line) => line.next === parent);
        if (k >= 0) {
          lines.push({ id: current[k].id, top: -1, column, bottom: k });
        } else if (current.length < 64) {
          const lane = current.length;
          lines.push({ id: lane, top: -1, column, bottom: lane });
          current.push({ next: parent, id: lane });
        }
      }
    }

    const columns = Math.max(
      1,
      column + 1,
      ...lines.flatMap((line) => [
        line.top + 1,
        line.column + 1,
        line.bottom + 1,
      ]),
    );
    previous = current;
    return { lines, column, id, columns };
  });
}

export function graphWidth(rows: GraphRow[]): number {
  return Math.max(
    30,
    Math.min(196, Math.max(1, ...rows.map((row) => row.columns)) * 12 + 12),
  );
}

export function GraphCell({
  row,
  width,
  height = 32,
  dot = true,
}: {
  row: GraphRow;
  width: number;
  height?: number;
  dot?: boolean;
}) {
  const x = (column: number) => 9 + column * 12;
  const mid = height / 2;
  const color = graphColors[Math.max(row.id, 0) % graphColors.length];
  return (
    <svg
      width={width}
      height={height}
      className="graph-cell"
      aria-hidden="true"
      style={{ flex: "none" }}
    >
      {row.lines.map((line, i) => (
        <path
          key={i}
          d={`${
            line.top >= 0
              ? `M${x(line.top)} 0 C${x(line.top)} ${mid - 6} ${x(line.column)} ${mid - 8} ${x(line.column)} ${mid}`
              : `M${x(line.column)} ${mid}`
          } ${
            line.bottom >= 0
              ? `C${x(line.column)} ${mid + 8} ${x(line.bottom)} ${mid + 6} ${x(line.bottom)} ${height}`
              : ""
          }`}
          fill="none"
          stroke={graphColors[Math.max(line.id, 0) % graphColors.length]}
          strokeWidth={1.6}
        />
      ))}
      {dot && row.column >= 0 && (
        <>
          <circle cx={x(row.column)} cy={mid} r={4.2} fill="var(--app-bg)" />
          <circle cx={x(row.column)} cy={mid} r={3.1} fill={color} />
        </>
      )}
    </svg>
  );
}
