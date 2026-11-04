import type { Line } from "./api";

export type SplitLine = {
  left?: Line;
  right?: Line;
  leftIndex?: number;
  rightIndex?: number;
};
export function splitLines(lines: Line[]): SplitLine[] {
  const result: SplitLine[] = [];
  for (let i = 0; i < lines.length;) {
    if (lines[i].Kind === "context") {
      result.push({
        left: lines[i],
        right: lines[i],
        leftIndex: i,
        rightIndex: i,
      });
      i++;
      continue;
    }
    const removed: number[] = [],
      added: number[] = [];
    while (i < lines.length && lines[i].Kind !== "context") {
      (lines[i].Kind === "delete" ? removed : added).push(i);
      i++;
    }
    for (let j = 0; j < Math.max(removed.length, added.length); j++)
      result.push({
        left: removed[j] === undefined ? undefined : lines[removed[j]],
        right: added[j] === undefined ? undefined : lines[added[j]],
        leftIndex: removed[j],
        rightIndex: added[j],
      });
  }
  return result;
}
export function changedRange(
  lines: Line[],
  from: number,
  to: number,
): number[] {
  const result: number[] = [];
  for (
    let i = Math.max(0, Math.min(from, to));
    i <= Math.min(lines.length - 1, Math.max(from, to));
    i++
  )
    if (lines[i].Kind !== "context") result.push(i);
  return result;
}
