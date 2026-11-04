import type { Commit } from "./api";

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

// Ported from MyGit's Git graph; children must precede their parents.
export function buildGraph(commits: Commit[]): GraphRow[] {
  let previous: { next: string; id: number }[] = [];
  return commits.map((commit) => {
    const current: typeof previous = [],
      lines: GraphLine[] = [];
    const parents = commit.Parents || [],
      first = parents[0];
    let column = -1,
      id = -1,
      found = false;
    previous.forEach((line, j) => {
      if (line.next !== commit.Hash) {
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
      } else lines.push({ id: line.id, top: j, column, bottom: -1 });
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
        if (k >= 0)
          lines.push({ id: current[k].id, top: -1, column, bottom: k });
        else if (current.length < 64) {
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

export function foldCommits(
  commits: Commit[],
  collapsed: Set<string>,
): Map<string, string> {
  const index = new Map(commits.map((commit, i) => [commit.Hash, i]));
  const children: number[][] = commits.map(() => []);
  commits.forEach((commit, i) =>
    (commit.Parents || []).forEach((parent) => {
      const j = index.get(parent);
      if (j !== undefined) children[j].push(i);
    }),
  );
  const hidden = new Map<string, string>();
  commits.forEach((merge, m) => {
    if (
      !collapsed.has(merge.Hash) ||
      (merge.Parents?.length || 0) < 2 ||
      hidden.has(merge.Hash)
    )
      return;
    const marks = new Map<number, number>();
    let pending = 0;
    function mark(hash: string, bit: number) {
      const j = index.get(hash);
      if (j !== undefined && j > m) {
        const old = marks.get(j) || 0;
        if (bit === 2 && !(old & 2)) pending++;
        marks.set(j, old | bit);
      }
    }
    mark(merge.Parents![0], 1);
    merge.Parents!.slice(1).forEach((parent) => mark(parent, 2));
    for (let i = m + 1; i < commits.length && pending > 0; i++) {
      const bits = marks.get(i) || 0;
      if (bits & 2) pending--;
      if (bits & 1)
        (commits[i].Parents || []).forEach((parent) => mark(parent, 1));
      else if (bits & 2) {
        if (
          !children[i].some(
            (child) => child !== m && !hidden.has(commits[child].Hash),
          )
        )
          hidden.set(commits[i].Hash, merge.Hash);
        (commits[i].Parents || []).forEach((parent) => mark(parent, 2));
      }
    }
  });
  return hidden;
}
